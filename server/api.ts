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
import { hduRanges } from '../src/lib/fits.ts';

const IRSA = 'https://irsa.ipac.caltech.edu';
const IRSA_TAP = `${IRSA}/TAP/sync`;
const IRSA_SIA = `${IRSA}/SIA`;
const SESAME = 'https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp/SNV';
const GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';
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
  const pmra = xml.match(/<pmRA>\s*<v>\s*([^<]+)<\/v>/)?.[1] ?? null;
  const pmdec = xml.match(/<pmDE>\s*<v>\s*([^<]+)<\/v>/)?.[1] ?? null;
  return {
    name: pick('oname') ?? '',
    ra,
    dec,
    pmra: pmra !== null && Number.isFinite(Number(pmra)) ? Number(pmra) : null,
    pmdec: pmdec !== null && Number.isFinite(Number(pmdec)) ? Number(pmdec) : null,
  };
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

async function listImagesTap(ra: number, dec: number): Promise<ImageRecord[]> {
  // Query from IRSA's SPHEREx cutouts tutorial (spherex.artifact JOIN spherex.plane); covers DR1 and QR3.
  const query = `SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)
ORDER BY p.time_bounds_lower`;
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query });
  const res = await get(IRSA_TAP, 'IRSA TAP', 90_000, { method: 'POST', body });
  return parseCsv(await res.text())
    .filter((r) => r.uri)
    .map((r) => {
      const path = r.uri.replace(/^\/+/, '');
      return { path, mjd: toMjd(r.time_bounds_lower), bandpass: r.energy_bandpassname || null, ...describePath(path) };
    });
}

async function listImagesSia(ra: number, dec: number): Promise<ImageRecord[]> {
  const out: ImageRecord[] = [];
  for (const collection of ['spherex_dr1', 'spherex_qr3']) {
    const url = `${IRSA_SIA}?COLLECTION=${collection}&POS=CIRCLE+${ra}+${dec}+0.0003&RESPONSEFORMAT=VOTABLE`;
    const res = await get(url, 'IRSA SIA2', 90_000);
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

async function cutout(path: string, ra: number, dec: number, size: number): Promise<Buffer> {
  const key = `${path}|${ra.toFixed(6)}|${dec.toFixed(6)}|${size}`;
  const hit = cutoutCache.get(key);
  if (hit) return hit;
  const url = `${IRSA}/${path}?center=${ra},${dec}d&size=${size}`;
  const res = await get(url, 'IRSA cutout service', 120_000);
  const raw = Buffer.from(await res.arrayBuffer());
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  // Drop the PSF table (~4 MB): the viewer does not use it. Every other HDU is kept byte for byte.
  const keep = hduRanges(ab).filter((r) => r.name !== 'EPSF' && r.name !== 'PSF');
  const slim = Buffer.concat(keep.map((r) => raw.subarray(r.start, r.end)));
  cutoutCache.set(key, slim);
  if (cutoutCache.size > CACHE_MAX) cutoutCache.delete(cutoutCache.keys().next().value!);
  return slim;
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
        const errors: string[] = [];
        let records: ImageRecord[] | null = null;
        let via = '';
        for (const [name, fn] of [['IRSA TAP', listImagesTap], ['IRSA SIA2', listImagesSia]] as const) {
          try {
            records = await fn(ra, dec);
            via = name;
            break;
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
        if (!records) return send(res, 503, { error: 'IRSA image search is unavailable right now.', details: errors });
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
        const r = await get(`${SESAME}?${encodeURIComponent(name)}`, 'CDS Sesame', 30_000);
        const found = parseSesame(await r.text());
        if (!found) return send(res, 404, { error: `No object named "${name}" was found by CDS Sesame.` });
        return send(res, 200, { ...found, query: name, source: 'CDS Sesame (SIMBAD/NED/VizieR)' });
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
        const r = await get(GAIA_TAP, 'ESA Gaia archive', 60_000, { method: 'POST', body });
        const stars = parseCsv(await r.text()).map((s) => ({
          id: s.source_id,
          ra: Number(s.ra),
          dec: Number(s.dec),
          pmra: s.pmra === '' ? null : Number(s.pmra),
          pmdec: s.pmdec === '' ? null : Number(s.pmdec),
          parallax: s.parallax === '' ? null : Number(s.parallax),
          g: s.phot_g_mean_mag === '' ? null : Number(s.phot_g_mean_mag),
          refEpoch: Number(s.ref_epoch),
        }));
        return send(res, 200, { count: stars.length, stars, source: 'Gaia DR3 (gaiadr3.gaia_source), ESA' });
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
