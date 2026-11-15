/**
 * Turns SPHEREx cutouts into frames on one common sky grid, so they can be played as a video,
 * subtracted or stacked. Nothing is interpolated in time or invented: a sky pixel with no data
 * in a frame stays NaN.
 */
import { parseFits, num, str, type ImageHDU, type TableHDU, type Header } from './fits.ts';
import { isBad } from './flags.ts';
import {
  pixToSky,
  pixelScaleArcsec,
  readCelestialWcs,
  readWaveLookup,
  skyToPix,
  wavelengthAt,
  type CelestialWcs,
  type WaveLookup,
} from './wcs.ts';

export interface SourceFrame {
  /** Observation ID from the header (OBSID), e.g. "2026W21_2A_0001_2". */
  obsId: string;
  detector: number;
  mjd: number;
  dateIso: string;
  exposureS: number | null;
  pipelineVersion: string | null;
  dqa: string | null;
  sourceUrl: string;
  width: number;
  height: number;
  image: Float32Array;
  zodi: Float32Array | null;
  variance: Float32Array | null;
  flags: Float32Array | null;
  wcs: CelestialWcs;
  wave: WaveLookup | null;
  header: Header;
}

export function frameFromFits(buffer: ArrayBuffer, sourceUrl: string): SourceFrame {
  const hdus = parseFits(buffer, { skip: ['EPSF', 'PSF'] });
  const find = (n: string) => hdus.find((h) => h.name === n);
  const img = find('IMAGE') as ImageHDU | undefined;
  if (!img || img.kind !== 'image') throw new Error('No IMAGE extension in this file');
  const h = img.header;
  const zodi = find('ZODI');
  const variance = find('VARIANCE');
  const flags = find('FLAGS');
  const waveTable = find('WCS-WAVE');
  const primary = hdus[0]?.header;
  let wave: WaveLookup | null = null;
  try {
    wave = waveTable && waveTable.kind === 'table' ? readWaveLookup(h, waveTable as TableHDU) : null;
  } catch {
    wave = null;
  }
  const mjd = num(h, 'MJD-AVG', num(h, 'MJD-OBS', NaN));
  return {
    obsId: (str(h, 'OBSID') ?? '').trim(),
    detector: num(h, 'DETECTOR', NaN),
    mjd,
    dateIso: (str(h, 'DATE-AVG') ?? str(h, 'DATE-OBS') ?? '').trim(),
    exposureS: typeof h.get('XPOSURE') === 'number' ? (h.get('XPOSURE') as number) : null,
    pipelineVersion: primary ? str(primary, 'VERSION')?.trim() ?? null : null,
    dqa: str(h, 'L2DQAFLG')?.trim() ?? null,
    sourceUrl,
    width: img.width,
    height: img.height,
    image: img.data,
    zodi: zodi && zodi.kind === 'image' ? zodi.data : null,
    variance: variance && variance.kind === 'image' ? variance.data : null,
    flags: flags && flags.kind === 'image' ? flags.data : null,
    wcs: readCelestialWcs(h),
    wave,
    header: h,
  };
}

/** A north-up, east-left tangent-plane grid centred on the target. */
export interface Grid {
  ra: number;
  dec: number;
  size: number; // pixels per side
  scaleArcsec: number;
}

export function makeGrid(ra: number, dec: number, fovArcmin: number, scaleArcsec: number): Grid {
  const size = Math.max(8, Math.round((fovArcmin * 60) / scaleArcsec));
  return { ra, dec, size, scaleArcsec };
}

/** Sky position of the centre of output pixel (i, j); i to the right (east is left), j downwards. */
export function gridToSky(g: Grid, i: number, j: number): [number, number] {
  const D2R = Math.PI / 180;
  const c = (g.size - 1) / 2;
  const xi = -(i - c) * (g.scaleArcsec / 3600) * D2R; // east to the left
  const eta = (c - j) * (g.scaleArcsec / 3600) * D2R; // north up
  const a0 = g.ra * D2R;
  const d0 = g.dec * D2R;
  const denom = Math.cos(d0) - eta * Math.sin(d0);
  const ra = a0 + Math.atan2(xi, denom);
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.sqrt(xi * xi + denom * denom));
  return [((((ra * 180) / Math.PI) % 360) + 360) % 360, (dec * 180) / Math.PI];
}

/** Inverse of gridToSky. */
export function skyToGrid(g: Grid, ra: number, dec: number): [number, number] {
  const D2R = Math.PI / 180;
  const a = ra * D2R;
  const d = dec * D2R;
  const a0 = g.ra * D2R;
  const d0 = g.dec * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  const c = (g.size - 1) / 2;
  const k = g.scaleArcsec / 3600 * D2R;
  return [c - xi / k, c - eta / k];
}

export interface GridFrame {
  source: SourceFrame;
  /** Surface brightness on the grid, MJy/sr (zodiacal light subtracted if requested); NaN = no data or masked. */
  data: Float32Array;
  /** Raw flag values on the grid (0 where no data). */
  flags: Uint32Array;
  /** Central wavelength (um) at the grid centre, from WCS-WAVE; null if unavailable. */
  centerWavelength: number | null;
  centerBandwidth: number | null;
  /** Fraction of grid pixels with valid data. */
  coverage: number;
}

/** Nearest-pixel resampling: keeps real pixel values unchanged (no smoothing) and flags exact. */
export function toGrid(f: SourceFrame, g: Grid, opts: { subtractZodi: boolean; maskBad: boolean }): GridFrame {
  const n = g.size * g.size;
  const data = new Float32Array(n).fill(NaN);
  const flags = new Uint32Array(n);
  let valid = 0;
  for (let j = 0; j < g.size; j++)
    for (let i = 0; i < g.size; i++) {
      const [ra, dec] = gridToSky(g, i, j);
      const [px, py] = skyToPix(f.wcs, ra, dec);
      const x = Math.round(px) - 1;
      const y = Math.round(py) - 1;
      if (!(x >= 0 && y >= 0 && x < f.width && y < f.height)) continue;
      const k = y * f.width + x;
      const fl = f.flags ? f.flags[k] >>> 0 : 0;
      let v = f.image[k];
      if (opts.subtractZodi && f.zodi) v -= f.zodi[k];
      if (opts.maskBad && isBad(fl)) v = NaN;
      data[j * g.size + i] = v;
      flags[j * g.size + i] = fl;
      if (Number.isFinite(v)) valid++;
    }
  let centerWavelength: number | null = null;
  let centerBandwidth: number | null = null;
  if (f.wave) {
    const [px, py] = skyToPix(f.wcs, g.ra, g.dec);
    if (Number.isFinite(px)) {
      const w = wavelengthAt(f.wave, px, py);
      centerWavelength = w.wavelength;
      centerBandwidth = w.bandwidth;
    }
  }
  return { source: f, data, flags, centerWavelength, centerBandwidth, coverage: valid / n };
}

/** Native pixel scale of a frame, for choosing the grid scale. */
export function frameScale(f: SourceFrame): number {
  return pixelScaleArcsec(f.wcs);
}

/** Value and wavelength of a frame at a sky position, for spectra. Null when outside or masked. */
export function sampleAt(
  f: SourceFrame,
  ra: number,
  dec: number,
  opts: { subtractZodi: boolean; maskBad: boolean }
): { value: number; error: number | null; wavelength: number | null; bandwidth: number | null; flags: number } | null {
  const [px, py] = skyToPix(f.wcs, ra, dec);
  const x = Math.round(px) - 1;
  const y = Math.round(py) - 1;
  if (!(x >= 0 && y >= 0 && x < f.width && y < f.height)) return null;
  const k = y * f.width + x;
  const fl = f.flags ? f.flags[k] >>> 0 : 0;
  if (opts.maskBad && isBad(fl)) return null;
  let v = f.image[k];
  if (opts.subtractZodi && f.zodi) v -= f.zodi[k];
  if (!Number.isFinite(v)) return null;
  const w = f.wave ? wavelengthAt(f.wave, px, py) : null;
  const variance = f.variance ? f.variance[k] : NaN;
  return {
    value: v,
    error: Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : null,
    wavelength: w?.wavelength ?? null,
    bandwidth: w?.bandwidth ?? null,
    flags: fl,
  };
}

// ---------------------------------------------------------------------------
// Epochs: SPHEREx maps the whole sky every ~6 months, so frames cluster in time.
// ---------------------------------------------------------------------------

export interface Epoch<T> {
  index: number;
  startMjd: number;
  endMjd: number;
  midMjd: number;
  items: T[];
}

/**
 * Groups items into visits: a new visit starts after a gap longer than gapDays (30), or when a visit
 * would span more than maxSpanDays (31). The second rule matters near the ecliptic poles, where
 * SPHEREx looks almost continuously (R Draconis): there each visit becomes about one month.
 */
export function groupEpochs<T>(items: T[], mjdOf: (t: T) => number, gapDays = 30, maxSpanDays = 31): Epoch<T>[] {
  const sorted = [...items].filter((t) => Number.isFinite(mjdOf(t))).sort((a, b) => mjdOf(a) - mjdOf(b));
  const epochs: Epoch<T>[] = [];
  for (const t of sorted) {
    const m = mjdOf(t);
    const last = epochs[epochs.length - 1];
    if (last && m - last.endMjd <= gapDays && m - last.startMjd <= maxSpanDays) {
      last.items.push(t);
      last.endMjd = m;
    } else {
      epochs.push({ index: epochs.length, startMjd: m, endMjd: m, midMjd: m, items: [t] });
    }
  }
  for (const e of epochs) e.midMjd = e.items.reduce((s, t) => s + mjdOf(t), 0) / e.items.length;
  return epochs;
}

/**
 * Mean of several grid frames, pixel by pixel, ignoring NaN. Used to stack the frames of one epoch
 * (the challenge's suggestion to add frames for signal-to-noise). Frames at different wavelengths are
 * averaged as broadband surface brightness; the caption says which detectors went in.
 */
export function stack(frames: Float32Array[], n: number): Float32Array {
  const sum = new Float64Array(n);
  const count = new Uint16Array(n);
  for (const f of frames)
    for (let k = 0; k < n; k++) {
      const v = f[k];
      if (Number.isFinite(v)) {
        sum[k] += v;
        count[k]++;
      }
    }
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = count[k] ? sum[k] / count[k] : NaN;
  return out;
}

/** a - b, NaN where either is missing. */
export function difference(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] - b[k];
  return out;
}

/** Pixel-wise median of frames (ignoring NaN): a "static sky" reference for difference images. */
export function median(frames: Float32Array[], n: number): Float32Array {
  const out = new Float32Array(n);
  const buf: number[] = [];
  for (let k = 0; k < n; k++) {
    buf.length = 0;
    for (const f of frames) if (Number.isFinite(f[k])) buf.push(f[k]);
    if (!buf.length) {
      out[k] = NaN;
      continue;
    }
    buf.sort((x, y) => x - y);
    const m = buf.length >> 1;
    out[k] = buf.length % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2;
  }
  return out;
}

/** Converts an MJD (UTC) to an ISO date string. */
export function mjdToIso(mjd: number): string {
  return new Date((mjd - 40587) * 86400000).toISOString();
}

export { pixToSky };
