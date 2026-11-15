/**
 * Small API in front of public archives. The browser cannot call IRSA's cutout service directly
 * (no CORS header), and a server lets us strip the large PSF table from each cutout, cache, and
 * report archive outages honestly. Only fixed hosts are contacted; user input never picks a host.
 *
 *   GET /api/health
 *   GET /api/images?ra=&dec=            SPHEREx spectral images covering a position (IRSA TAP, SIA2 fallback)
 *   GET /api/cutout?path=&ra=&dec=&size= cutout of one image (IRSA cutout service), PSF table removed
 *   GET /api/resolve?name=              object name -> position (CDS Sesame)
 *   GET /api/gaia?ra=&dec=&radius=      Gaia DR3 stars with proper motions (ESA Gaia archive)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { hduRanges } from '../src/lib/fits.ts';
import { propagate } from '../src/lib/coords.ts';

const IRSA = 'https://irsa.ipac.caltech.edu';
const IRSA_TAP = `${IRSA}/TAP/sync`;
const IRSA_SIA = `${IRSA}/SIA`;
const SESAME = 'https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp/SNV';
/** Official VizieR mirror at the Center for Astrophysics (Harvard & Smithsonian), used when CDS is down. */
const SESAME_CFA = 'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV';
const GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';
const VIZIER_CFA_ASU = 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv';
const UA = 'SPHEREx-Sky-Motion/0.1 (NASA Space Apps 2026 entry)';

export interface ImageRecord {
  /** IRSA path of the full spectral image, e.g. ibe/data/spherex/qr3/level2/.../level2_..._spx_l2b-v27-2026-268.fits */
  path: string;
  obsId: string | null;
  detector: number | null;
  /** Observation start, MJD (from the archive); exact mid-time comes from each file's header. */
  mjd: number | null;
  bandpass: string | null;
  release: string | null;
  version: number | null;
}

// ---------------------------------------------------------------------------
// Parsing helpers (exported for tests)
// ---------------------------------------------------------------------------

const PATH_RE = /^ibe\/data\/spherex\/[A-Za-z0-9_.\-/]+\.fits$/;

export function isAllowedImagePath(p: string): boolean {
  return PATH_RE.test(p) && !p.includes('..');
}

/** Pulls observation ID, detector, release and pipeline version out of a SPHEREx file path. */
export function describePath(path: string): Pick<ImageRecord, 'obsId' | 'detector' | 'release' | 'version'> {
  const file = path.split('/').pop() ?? '';
  const m = file.match(/^level2_(.+)D(\d)_spx_l2b-v(\d+)-/);
  const rel = path.match(/^ibe\/data\/spherex\/([a-z0-9_]+)\//);
  return {
    obsId: m ? m[1] : null,
    detector: m ? Number(m[2]) : null,
    version: m ? Number(m[3]) : null,
    release: rel ? rel[1] : null,
  };
}

/** One record per exposure and detector: the newest pipeline version wins when releases overlap. */
export function dedupeImages(records: ImageRecord[]): ImageRecord[] {
  const best = new Map<string, ImageRecord>();
  for (const r of records) {
    const key = r.obsId && r.detector ? `${r.obsId}|${r.detector}` : r.path;
    const prev = best.get(key);
    if (!prev || (r.version ?? 0) > (prev.version ?? 0)) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => (a.mjd ?? 0) - (b.mjd ?? 0));
}

/** Minimal RFC 4180 CSV parser (quoted fields, embedded commas and quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** VOTable TABLEDATA -> rows keyed by FIELD name (what IRSA SIA2 returns). */
export function parseVoTable(xml: string): Record<string, string>[] {
  const fields = [...xml.matchAll(/<FIELD\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  const decode = (s: string) =>
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
  const rows: Record<string, string>[] = [];
  for (const tr of xml.matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/g)) {
    const tds = [...tr[1].matchAll(/<TD\b[^>]*\/>|<TD\b[^>]*>([\s\S]*?)<\/TD>/g)].map((m) => decode(m[1] ?? ''));
    rows.push(Object.fromEntries(fields.map((f, i) => [f, tds[i] ?? ''])));
  }
  return rows;
}

export function parseSesame(xml: string): { name: string; ra: number; dec: number; pmra: number | null; pmdec: number | null } | null {
  const pick = (tag: string) => xml.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`))?.[1] ?? null;
  const ra = Number(pick('jradeg'));
  const dec = Number(pick('jdedeg'));
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || pick('jradeg') === null) return null;
  const pmra = xml.match(/<pmRA>\s*(?:<v>\s*)?([^<\s]+)/)?.[1] ?? null;
  const pmdec = xml.match(/<pmDE>\s*(?:<v>\s*)?([^<\s]+)/)?.[1] ?? null;
  return {
    name: pick('oname') ?? '',
    ra,
    dec,
    pmra: pmra !== null && Number.isFinite(Number(pmra)) ? Number(pmra) : null,
    pmdec: pmdec !== null && Number.isFinite(Number(pmdec)) ? Number(pmdec) : null,
  };
}

/** VizieR ASU tab-separated output: comment lines (#), a header, a units line and a dashes line. */
export function parseVizierTsv(tsv: string): Record<string, string>[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 3) return [];
  const head = lines[0].split('\t').map((h) => h.trim());
  return lines
    .slice(1)
    .filter((l) => !/^[-\t ]+$/.test(l) && !/^\s*(deg|mas|mag|"|\t)/.test(l.split('\t')[1] ?? '') )
    .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v.trim()])))
    .filter((r) => r[head[0]] !== '' && /^-?\d/.test(r[head[1]] ?? ''));
}

/** ISO date or MJD string -> MJD. */
export function toMjd(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(v.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isFinite(t) ? t / 86400000 + 40587 : null;
}

// ---------------------------------------------------------------------------
// Upstream calls
// ---------------------------------------------------------------------------

class Upstream extends Error {
  service: string;
  status: number;
  constructor(service: string, status: number, detail: string) {
    super(`${service} answered ${status}${detail ? `: ${detail}` : ''}`);
    this.service = service;
    this.status = status;
  }
}

async function get(url: string, service: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Upstream(service, 0, err instanceof Error ? err.message : 'network error');
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160);
    throw new Upstream(service, res.status, text);
  }
  return res;
}

const num = (v: string | null, name: string, lo: number, hi: number): number => {
  const n = Number(v);
  if (v === null || v === '' || !Number.isFinite(n) || n < lo || n > hi) throw new BadRequest(`${name} must be a number between ${lo} and ${hi}`);
  return n;
};
class BadRequest extends Error {}

async function listImagesTap(ra: number, dec: number, timeoutMs = 60_000): Promise<ImageRecord[]> {
  // Query from IRSA's SPHEREx cutouts tutorial (spherex.artifact JOIN spherex.plane); covers DR1 and QR3.
  const query = `SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)
ORDER BY p.time_bounds_lower`;
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query });
  const res = await get(IRSA_TAP, 'IRSA TAP', timeoutMs, { method: 'POST', body });
  return parseCsv(await res.text())
    .filter((r) => r.uri)
    .map((r) => {
      const path = r.uri.replace(/^\/+/, '');
      return { path, mjd: toMjd(r.time_bounds_lower), bandpass: r.energy_bandpassname || null, ...describePath(path) };
    });
}

async function listImagesSia(ra: number, dec: number, timeoutMs = 60_000): Promise<ImageRecord[]> {
  const out: ImageRecord[] = [];
  for (const collection of ['spherex_dr1', 'spherex_qr3']) {
    const url = `${IRSA_SIA}?COLLECTION=${collection}&POS=CIRCLE+${ra}+${dec}+0.0003&RESPONSEFORMAT=VOTABLE`;
    const res = await get(url, 'IRSA SIA2', timeoutMs);
    for (const r of parseVoTable(await res.text())) {
      const access = r.access_url ?? '';
      const path = access.replace(/^https?:\/\/irsa\.ipac\.caltech\.edu\//, '').split('?')[0];
      if (!isAllowedImagePath(path)) continue;
      out.push({ path, mjd: toMjd(r.t_min), bandpass: r.energy_bandpassname || null, ...describePath(path) });
    }
  }
  return out;
}

const cutoutCache = new Map<string, Buffer>();
const CACHE_MAX = 600;

/** Cutouts are also kept on disk (data/cache, not committed): a target viewed once reloads instantly. */
const CACHE_DIR = path.resolve(process.cwd(), 'data', 'cache', 'cutouts');

async function cutout(path: string, ra: number, dec: number, size: number): Promise<Buffer> {
  const key = `${path}|${ra.toFixed(6)}|${dec.toFixed(6)}|${size}`;
  const hit = cutoutCache.get(key);
  if (hit) return hit;
  const file = `${CACHE_DIR}/${createHash('sha1').update(key).digest('hex')}.fits`;
  const onDisk = await readFile(file).catch(() => null);
  if (onDisk) {
    cutoutCache.set(key, onDisk);
    return onDisk;
  }
  const url = `${IRSA}/${path}?center=${ra},${dec}d&size=${size}`;
  const res = await get(url, 'IRSA cutout service', 120_000);
  const raw = Buffer.from(await res.arrayBuffer());
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  // Drop the PSF table (~4 MB): the viewer does not use it. Every other HDU is kept byte for byte.
  const keep = hduRanges(ab).filter((r) => r.name !== 'EPSF' && r.name !== 'PSF');
  const slim = Buffer.concat(keep.map((r) => raw.subarray(r.start, r.end)));
  cutoutCache.set(key, slim);
  if (cutoutCache.size > CACHE_MAX) cutoutCache.delete(cutoutCache.keys().next().value!);
  await mkdir(CACHE_DIR, { recursive: true }).then(() => writeFile(file, slim)).catch(() => undefined);
  return slim;
}

// ---------------------------------------------------------------------------
// Offline index (scripts/build-target-index.ts): used only when IRSA's search fails
// ---------------------------------------------------------------------------

interface IndexFile {
  generatedAtUtc: string;
  source: string;
  targets: Record<string, {
    name: string;
    position: { ra: number; dec: number; epoch: number; pmra: number; pmdec: number };
    images: { path: string; detector: number; obsId: string; mjd: number; release: string; version: number }[];
  }>;
}

let indexCache: { mtimeMs: number; data: IndexFile | null } | null = null;
/** Reads the index, again whenever the file changes (a rebuild does not need a server restart). */
async function loadIndex(): Promise<IndexFile | null> {
  const file = path.resolve(process.cwd(), 'data', 'index', 'spherex-test-targets.json');
  const st = await stat(file).catch(() => null);
  if (!st) return null;
  if (indexCache?.mtimeMs !== st.mtimeMs) {
    const data = await readFile(file, 'utf8').then((t) => JSON.parse(t) as IndexFile).catch(() => null);
    indexCache = { mtimeMs: st.mtimeMs, data };
  }
  return indexCache.data;
}

const sepDeg = (ra1: number, d1: number, ra2: number, d2: number) => {
  const r = Math.PI / 180;
  const c = Math.sin(d1 * r) * Math.sin(d2 * r) + Math.cos(d1 * r) * Math.cos(d2 * r) * Math.cos((ra1 - ra2) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
};

/** Images of an indexed target whose position (moved to 2026.0) is within 0.15° of the request. */
export function fromIndex(index: IndexFile, ra: number, dec: number): { name: string; images: ImageRecord[] } | null {
  for (const t of Object.values(index.targets)) {
    const p = propagate(t.position.ra, t.position.dec, t.position.pmra, t.position.pmdec, t.position.epoch, 2026.0);
    if (sepDeg(p.ra, p.dec, ra, dec) > 0.15) continue;
    return {
      name: t.name,
      images: t.images.map((im) => ({ path: im.path, obsId: im.obsId, detector: im.detector, mjd: im.mjd, bandpass: null, release: im.release, version: im.version })),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP handler (works as a Vite middleware and in server/index.ts)
// ---------------------------------------------------------------------------

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=3600' : 'no-store');
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as Buffer));
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, next?: () => void): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  if (!url.pathname.startsWith('/api/')) {
    next?.();
    return;
  }
  const q = url.searchParams;
  try {
    switch (url.pathname) {
      case '/api/health':
        return send(res, 200, { ok: true, service: 'spherex-sky-motion' });

      case '/api/images': {
        const ra = num(q.get('ra'), 'ra', 0, 360);
        const dec = num(q.get('dec'), 'dec', -90, 90);
        // TAP and SIA2 are asked at the same time; the first good answer wins. For targets in our
        // offline index, IRSA gets 10 s before the index is used (it sometimes hangs instead of failing).
        const index = await loadIndex();
        const hit = index ? fromIndex(index, ra, dec) : null;
        const budget = hit ? 10_000 : 60_000;
        let records: ImageRecord[] | null = null;
        let via = '';
        const errors: string[] = [];
        try {
          [records, via] = await Promise.any([
            listImagesTap(ra, dec, budget).then((r) => [r, 'IRSA TAP'] as const),
            listImagesSia(ra, dec, budget).then((r) => [r, 'IRSA SIA2'] as const),
          ]).then(([r, v]) => [r, v]);
        } catch (err) {
          for (const e of (err as AggregateError).errors ?? [err]) errors.push(e instanceof Error ? e.message : String(e));
        }
        if (!records) {
          if (!hit) return send(res, 503, { error: 'IRSA image search is unavailable right now.', details: errors });
          records = hit.images;
          via = `our index of ${hit.name}, built ${index!.generatedAtUtc.slice(0, 10)} from NASA's SPHEREx bucket on AWS (IRSA search unavailable)`;
        }
        const images = dedupeImages(records.filter((r) => isAllowedImagePath(r.path)));
        return send(res, 200, { via, count: images.length, images, retrievedAtUtc: new Date().toISOString() });
      }

      case '/api/cutout': {
        const path = q.get('path') ?? '';
        if (!isAllowedImagePath(path)) throw new BadRequest('path must be a SPHEREx image path under ibe/data/spherex/');
        const ra = num(q.get('ra'), 'ra', 0, 360);
        const dec = num(q.get('dec'), 'dec', -90, 90);
        const size = num(q.get('size'), 'size', 0.005, 0.5);
        return send(res, 200, await cutout(path, ra, dec, size), 'application/fits');
      }

      case '/api/resolve': {
        const name = (q.get('name') ?? '').trim();
        if (!name || name.length > 100) throw new BadRequest('name is required (up to 100 characters)');
        let xml: string;
        let source = 'CDS Sesame (SIMBAD/NED/VizieR)';
        try {
          xml = await (await get(`${SESAME}?${encodeURIComponent(name)}`, 'CDS Sesame', 20_000)).text();
        } catch {
          xml = await (await get(`${SESAME_CFA}?${encodeURIComponent(name)}`, 'CDS Sesame (CfA mirror)', 30_000)).text();
          source = 'CDS Sesame, CfA mirror (SIMBAD/NED/VizieR)';
        }
        const found = parseSesame(xml);
        if (!found) return send(res, 404, { error: `No object named "${name}" was found by CDS Sesame.` });
        // Sesame positions are ICRS at epoch J2000.0; proper motions in mas/yr.
        return send(res, 200, { ...found, epoch: 2000.0, query: name, source });
      }

      case '/api/gaia': {
        const ra = num(q.get('ra'), 'ra', 0, 360);
        const dec = num(q.get('dec'), 'dec', -90, 90);
        const radius = num(q.get('radius'), 'radius', 0.001, 0.3);
        // Stars that can move by more than the search radius are caught by widening it with the
        // largest proper motions (Barnard's Star ~10.4"/yr): 30" covers 3 years at that speed.
        const query = `SELECT TOP 400 source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag, ref_epoch
FROM gaiadr3.gaia_source
WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${radius + 30 / 3600}))
ORDER BY phot_g_mean_mag`;
        const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query });
        let rows: Record<string, string>[];
        let source = 'Gaia DR3 (gaiadr3.gaia_source), ESA Gaia archive';
        try {
          rows = parseCsv(await (await get(GAIA_TAP, 'ESA Gaia archive', 30_000, { method: 'POST', body })).text());
        } catch {
          // Same catalogue (VizieR I/355/gaiadr3) from the CfA VizieR mirror; positions at epoch J2016.0.
          const q = new URLSearchParams({
            '-source': 'I/355/gaiadr3',
            '-c': `${ra} ${dec}`,
            '-c.rs': String(Math.round((radius + 30 / 3600) * 3600)),
            '-out': 'Source,RA_ICRS,DE_ICRS,pmRA,pmDE,Plx,Gmag',
            '-out.max': '400',
            '-sort': 'Gmag',
          });
          const tsv = await (await get(`${VIZIER_CFA_ASU}?${q}`, 'Gaia DR3 via CfA VizieR mirror', 60_000)).text();
          rows = parseVizierTsv(tsv).map((r) => ({
            source_id: r.Source, ra: r.RA_ICRS, dec: r.DE_ICRS, pmra: r.pmRA, pmdec: r.pmDE, parallax: r.Plx, phot_g_mean_mag: r.Gmag, ref_epoch: '2016.0',
          }));
          source = 'Gaia DR3 (VizieR I/355/gaiadr3), CfA VizieR mirror';
        }
        const stars = rows.map((s) => ({
          id: s.source_id,
          ra: Number(s.ra),
          dec: Number(s.dec),
          pmra: s.pmra === '' ? null : Number(s.pmra),
          pmdec: s.pmdec === '' ? null : Number(s.pmdec),
          parallax: s.parallax === '' ? null : Number(s.parallax),
          g: s.phot_g_mean_mag === '' ? null : Number(s.phot_g_mean_mag),
          refEpoch: Number(s.ref_epoch),
        }));
        return send(res, 200, { count: stars.length, stars, source });
      }

      default:
        return send(res, 404, { error: 'Unknown endpoint' });
    }
  } catch (err) {
    if (err instanceof BadRequest) return send(res, 400, { error: err.message });
    if (err instanceof Upstream) return send(res, 502, { error: err.message, service: err.service, upstreamStatus: err.status });
    return send(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
  }
}
