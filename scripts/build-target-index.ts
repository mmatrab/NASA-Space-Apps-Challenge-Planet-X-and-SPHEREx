/**
 * Builds a dated index of the SPHEREx spectral images that contain each challenge test target,
 * by reading file headers in NASA/IRSA's public SPHEREx bucket on AWS (s3://nasa-irsa-spherex).
 * Used by the API as a fallback when IRSA's image search (TAP/SIA) is unavailable.
 *
 *   node scripts/build-target-index.ts            (behind a proxy: NODE_USE_ENV_PROXY=1)
 *   node scripts/build-target-index.ts --only=barnard --weeks=dr1/2025W35_1A,qr3/2026W34_1A
 *       rescans one target in the given weekly folders and updates its entry in the existing file
 *
 * How it works, for each target:
 *  1. Target position (SIMBAD via the CDS Sesame service, CfA mirror) moved along its proper motion.
 *  2. Survey map from the data itself: 16 exposures per weekly folder are read to learn which
 *     ecliptic longitudes SPHEREx covered that week (it scans great circles through the ecliptic
 *     poles, which drift with the Sun). Weeks that came within 10° of ecliptic longitude, or 25° on
 *     the sky, of a target are scanned. This only narrows the search; step 3 decides.
 *  3. In those folders, file headers are read with HTTP range requests (first 40 KB: primary header
 *     and IMAGE header with the full TAN-SIP WCS and the observation time). Every 4th exposure is
 *     sampled; exposures near a sample whose pointing is within 15° of the target are all checked.
 *  4. An image is kept only if the target, at that image's date, falls inside its 2040 × 2040 pixels.
 * Nothing is guessed: every path in the output was read from the bucket and its WCS checked.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseHeader, num, str } from '../src/lib/fits.ts';
import { readCelestialWcs, skyToPix } from '../src/lib/wcs.ts';
import { mjdToJulianYear, propagate } from '../src/lib/coords.ts';

const BUCKET = 'https://nasa-irsa-spherex.s3.amazonaws.com';
const SESAME = 'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV';
const RELEASES = ['dr1', 'qr3'];
const HEADER_BYTES = 40320;
const CONCURRENCY = 24;
const SAMPLE_STRIDE = 4;
const NEAR_DEG = 15;
const WEEK_SAMPLES = 16;
const NEAR_LON_DEG = 10;
const NEAR_SKY_DEG = 25;

interface TargetSpec { id: string; name: string; resolve: string }
const TARGETS: TargetSpec[] = [
  { id: 'barnard', name: "Barnard's Star", resolve: "Barnard's Star" },
  { id: 'wise0855', name: 'WISE 0855', resolve: 'WISE J085510.83-071442.5' },
  { id: 'epsind', name: 'Epsilon Indi B', resolve: 'eps Ind B' },
  { id: 'rwaur', name: 'RW Aurigae', resolve: 'RW Aur' },
  { id: 'rdra', name: 'R Draconis', resolve: 'R Dra' },
];

const D2R = Math.PI / 180;

async function text(url: string, init?: RequestInit, tries = 3): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.text();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

async function resolve(t: TargetSpec) {
  const xml = await text(`${SESAME}?${encodeURIComponent(t.resolve)}`);
  const pick = (re: RegExp) => { const m = xml.match(re); return m ? Number(m[1]) : NaN; };
  const ra = pick(/<jradeg>\s*([^<]+)</);
  const dec = pick(/<jdedeg>\s*([^<]+)</);
  const pmra = pick(/<pmRA>\s*([^<]+)</);
  const pmdec = pick(/<pmDE>\s*([^<]+)</);
  const oname = xml.match(/<oname>\s*([^<]+)</)?.[1] ?? t.resolve;
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) throw new Error(`Sesame could not resolve ${t.resolve}`);
  return {
    ra, dec, epoch: 2000.0,
    pmra: Number.isFinite(pmra) ? pmra : 0,
    pmdec: Number.isFinite(pmdec) ? pmdec : 0,
    source: `SIMBAD via CDS Sesame (CfA mirror), object "${oname}"; ICRS position at epoch J2000.0, proper motion in mas/yr`,
  };
}

/** S3 ListObjectsV2 with pagination. */
async function list(prefix: string, delimiter = true): Promise<{ prefixes: string[]; keys: string[] }> {
  const prefixes: string[] = [];
  const keys: string[] = [];
  let token = '';
  do {
    const q = new URLSearchParams({ 'list-type': '2', prefix, ...(delimiter ? { delimiter: '/' } : {}), ...(token ? { 'continuation-token': token } : {}) });
    const xml = await text(`${BUCKET}/?${q}`);
    for (const m of xml.matchAll(/<CommonPrefixes><Prefix>([^<]+)<\/Prefix>/g)) prefixes.push(m[1]);
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    token = xml.match(/<NextContinuationToken>([^<]+)</)?.[1] ?? '';
  } while (token);
  return { prefixes, keys };
}

/** "2025W18_1B" -> MJD of the middle of ISO week 18 of 2025. */
function weekMjd(folder: string): number | null {
  const m = folder.match(/(\d{4})W(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  const monday = jan4 - jan4Dow * 86400000 + (week - 1) * 7 * 86400000;
  return (monday + 3.5 * 86400000) / 86400000 + 40587;
}

/** Ecliptic longitude and latitude (degrees) of an equatorial position. */
function ecliptic(ra: number, dec: number): [number, number] {
  const e = 23.4393 * D2R;
  const a = ra * D2R;
  const d = dec * D2R;
  const lon = Math.atan2(Math.sin(a) * Math.cos(e) + Math.tan(d) * Math.sin(e), Math.cos(a));
  const lat = Math.asin(Math.sin(d) * Math.cos(e) - Math.cos(d) * Math.sin(e) * Math.sin(a));
  return [((lon / D2R) % 360 + 360) % 360, lat / D2R];
}
const dLon = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

const headerCache = new Map<string, Promise<HeaderInfo | null>>();
interface HeaderInfo { key: string; mjd: number; detector: number; obsId: string; wcs: ReturnType<typeof readCelestialWcs>; ra0: number; dec0: number; width: number; height: number }

function readHeader(key: string): Promise<HeaderInfo | null> {
  let p = headerCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(`${BUCKET}/${key}`, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` }, signal: AbortSignal.timeout(60_000) });
        if (!r.ok && r.status !== 206) return null;
        const bytes = new Uint8Array(await r.arrayBuffer());
        const primary = parseHeader(bytes, 0);
        const img = parseHeader(bytes, primary.dataOffset);
        const h = img.header;
        return {
          key,
          mjd: num(h, 'MJD-AVG', num(h, 'MJD-OBS', NaN)),
          detector: num(h, 'DETECTOR', NaN),
          obsId: (str(h, 'OBSID') ?? '').trim(),
          wcs: readCelestialWcs(h),
          ra0: num(h, 'CRVAL1'),
          dec0: num(h, 'CRVAL2'),
          width: num(h, 'NAXIS1'),
          height: num(h, 'NAXIS2'),
        };
      } catch {
        return null;
      }
    })();
    headerCache.set(key, p);
  }
  return p;
}

async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const sepDeg = (ra1: number, d1: number, ra2: number, d2: number) => {
  const c = Math.sin(d1 * D2R) * Math.sin(d2 * D2R) + Math.cos(d1 * D2R) * Math.cos(d2 * D2R) * Math.cos((ra1 - ra2) * D2R);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D2R;
};

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const ONLY = arg('only')?.split(',');
const WEEKS = arg('weeks')?.split(',');
const OUT_FILE = path.resolve(import.meta.dirname, '..', 'data', 'index', 'spherex-test-targets.json');

async function main() {
  const startedAt = new Date().toISOString();
  // All weekly folders with their newest processing version.
  const folders: { release: string; week: string; prefix: string; mjd: number }[] = [];
  for (const rel of RELEASES) {
    const weeks = (await list(`${rel}/level2/`)).prefixes;
    for (const w of weeks) {
      const versions = (await list(w)).prefixes.filter((p) => /l2b-v\d+/.test(p)).sort((a, b) => Number(a.match(/l2b-v(\d+)/)![1]) - Number(b.match(/l2b-v(\d+)/)![1]));
      const mjd = weekMjd(w);
      const week = w.split('/').at(-2)!;
      if (WEEKS && !WEEKS.includes(`${rel}/${week}`)) continue;
      if (versions.length && mjd) folders.push({ release: rel, week, prefix: versions.at(-1)!, mjd });
    }
  }
  console.log(`${folders.length} weekly folders in ${RELEASES.join(', ')}`);

  // Survey map: list each folder once and read a few headers to see where SPHEREx pointed that week.
  const folderKeys = new Map<string, Map<string, Map<number, string>>>();
  const folderPoints = new Map<string, { ra: number; dec: number; lon: number; mjd: number }[]>();
  await pool(folders, async (f) => {
    const byObs = new Map<string, Map<number, string>>();
    for (let d = 1; d <= 6; d++) {
      for (const key of (await list(`${f.prefix}${d}/`, false)).keys) {
        const m = key.match(/level2_(.+)D(\d)_spx_/);
        if (!m) continue;
        if (!byObs.has(m[1])) byObs.set(m[1], new Map());
        byObs.get(m[1])!.set(Number(m[2]), key);
      }
    }
    folderKeys.set(f.prefix, byObs);
    const obs = [...byObs.keys()].sort();
    const picks = Array.from({ length: Math.min(WEEK_SAMPLES, obs.length) }, (_, i) => obs[Math.floor((i * obs.length) / Math.min(WEEK_SAMPLES, obs.length))]);
    const pts: { ra: number; dec: number; lon: number; mjd: number }[] = [];
    for (const o of picks) {
      const k = byObs.get(o)!;
      for (const d of [1, 2, 3]) {
        const key = k.get(d);
        if (!key) continue;
        const h = await readHeader(key);
        if (h) pts.push({ ra: h.ra0, dec: h.dec0, lon: ecliptic(h.ra0, h.dec0)[0], mjd: h.mjd });
      }
    }
    folderPoints.set(f.prefix, pts);
  });
  console.log(`Survey map: ${[...folderPoints.values()].reduce((s, p) => s + p.length, 0)} pointings read`);

  let previous: { targets?: Record<string, unknown> } = {};
  try { previous = JSON.parse(await (await import('node:fs/promises')).readFile(OUT_FILE, 'utf8')); } catch { /* first run */ }
  const results: Record<string, unknown> = { ...(previous.targets ?? {}) };
  const write = async () => {
    const out = {
      generatedAtUtc: new Date().toISOString(),
      startedAtUtc: startedAt,
      source: 'NASA/IRSA SPHEREx public bucket s3://nasa-irsa-spherex (Level 2 spectral images), file headers read directly',
      method: "See scripts/build-target-index.ts: weekly folders chosen from a survey map read from the data, headers sampled every 4th exposure, containment checked with each file's TAN-SIP WCS at its own date.",
      releases: RELEASES,
      targets: results,
    };
    await mkdir(path.dirname(OUT_FILE), { recursive: true });
    await writeFile(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
  };
  for (const t of TARGETS.filter((x) => !ONLY || ONLY.includes(x.id))) {
    const pos = await resolve(t);
    const at = (mjd: number) => propagate(pos.ra, pos.dec, pos.pmra, pos.pmdec, pos.epoch, mjdToJulianYear(mjd));
    const candidates = WEEKS ? folders : folders.filter((f) =>
      (folderPoints.get(f.prefix) ?? []).some((pt) => {
        const p = at(pt.mjd);
        return dLon(pt.lon, ecliptic(p.ra, p.dec)[0]) <= NEAR_LON_DEG || sepDeg(pt.ra, pt.dec, p.ra, p.dec) <= NEAR_SKY_DEG;
      })
    );
    console.log(`\n${t.name}: ${candidates.length} candidate weeks (${candidates.map((c) => `${c.release}/${c.week}`).join(' ')})`);
    const found: { path: string; detector: number; obsId: string; mjd: number; release: string; version: number; x: number; y: number }[] = [];
    const scanned: string[] = [];
    for (const f of candidates) {
      const byObs = folderKeys.get(f.prefix)!;
      const obs = [...byObs.keys()].sort();
      const sampleIdx = obs.map((_, i) => i).filter((i) => i % SAMPLE_STRIDE === 0);
      const samples = await pool(sampleIdx, (i) => { const k = byObs.get(obs[i])!; return readHeader(k.get(1) ?? k.get(2) ?? k.get(3) ?? [...k.values()][0]); });
      const near = new Set<number>();
      samples.forEach((h, n) => {
        if (!h) return;
        const p = at(h.mjd);
        if (sepDeg(h.ra0, h.dec0, p.ra, p.dec) <= NEAR_DEG) {
          for (let j = sampleIdx[n] - SAMPLE_STRIDE; j <= sampleIdx[n] + SAMPLE_STRIDE; j++) if (j >= 0 && j < obs.length) near.add(j);
        }
      });
      const keys = [...near].flatMap((j) => [...byObs.get(obs[j])!.values()]);
      const heads = await pool(keys, readHeader);
      let n = 0;
      for (const h of heads) {
        if (!h) continue;
        const p = at(h.mjd);
        const [x, y] = skyToPix(h.wcs, p.ra, p.dec);
        if (x >= 0.5 && y >= 0.5 && x <= h.width + 0.5 && y <= h.height + 0.5) {
          const v = h.key.match(/l2b-v(\d+)/);
          found.push({ path: `ibe/data/spherex/${h.key}`, detector: h.detector, obsId: h.obsId, mjd: h.mjd, release: f.release, version: v ? Number(v[1]) : 0, x: Math.round(x), y: Math.round(y) });
          n++;
        }
      }
      scanned.push(`${f.release}/${f.week}`);
      console.log(`  ${f.release}/${f.week}: ${obs.length} exposures, ${sampleIdx.length} sampled, ${keys.length} checked, ${n} contain the target`);
    }
    found.sort((a, b) => a.mjd - b.mjd);
    results[t.id] = { name: t.name, position: pos, weeksScanned: scanned, count: found.length, images: found };
    await write(); // after every target, so a long run can be used before it ends
    console.log(`Saved ${t.name}: ${found.length} images`);
  }
  console.log(`\nWrote ${OUT_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
