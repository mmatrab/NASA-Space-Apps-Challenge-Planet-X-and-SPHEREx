/**
 * Celestial WCS for SPHEREx spectral images: gnomonic (TAN) projection with SIP distortion
 * (Shupe et al. 2005), as written in the IMAGE header (CTYPE = RA---TAN-SIP / DEC--TAN-SIP,
 * CRPIX, CRVAL, CDELT, PC, A/B forward and AP/BP inverse polynomials).
 * Pixel coordinates here are FITS 1-based.
 */
import { num, str, type Header } from './fits.ts';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

type Poly = { order: number; c: Map<string, number> };

function readPoly(h: Header, prefix: string): Poly | null {
  const order = h.get(`${prefix}_ORDER`);
  if (typeof order !== 'number') return null;
  const c = new Map<string, number>();
  for (let p = 0; p <= order; p++)
    for (let q = 0; p + q <= order; q++) {
      const v = h.get(`${prefix}_${p}_${q}`);
      if (typeof v === 'number' && v !== 0) c.set(`${p}_${q}`, v);
    }
  return { order, c };
}

function evalPoly(poly: Poly | null, u: number, v: number): number {
  if (!poly) return 0;
  let s = 0;
  for (const [k, coef] of poly.c) {
    const [p, q] = k.split('_').map(Number);
    s += coef * u ** p * v ** q;
  }
  return s;
}

export interface CelestialWcs {
  crpix: [number, number];
  crval: [number, number];
  /** CD = CDELT * PC, degrees per pixel. */
  cd: [[number, number], [number, number]];
  cdInv: [[number, number], [number, number]];
  a: Poly | null;
  b: Poly | null;
  ap: Poly | null;
  bp: Poly | null;
}

export function readCelestialWcs(h: Header): CelestialWcs {
  const ctype1 = str(h, 'CTYPE1') ?? '';
  if (!ctype1.startsWith('RA---TAN')) throw new Error(`Unsupported projection ${ctype1}`);
  const cdelt1 = num(h, 'CDELT1', 1);
  const cdelt2 = num(h, 'CDELT2', 1);
  let cd: [[number, number], [number, number]];
  if (h.has('CD1_1')) {
    cd = [
      [num(h, 'CD1_1'), num(h, 'CD1_2', 0)],
      [num(h, 'CD2_1', 0), num(h, 'CD2_2')],
    ];
  } else {
    cd = [
      [cdelt1 * num(h, 'PC1_1', 1), cdelt1 * num(h, 'PC1_2', 0)],
      [cdelt2 * num(h, 'PC2_1', 0), cdelt2 * num(h, 'PC2_2', 1)],
    ];
  }
  const det = cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0];
  const cdInv: [[number, number], [number, number]] = [
    [cd[1][1] / det, -cd[0][1] / det],
    [-cd[1][0] / det, cd[0][0] / det],
  ];
  const sip = ctype1.endsWith('-SIP');
  return {
    crpix: [num(h, 'CRPIX1'), num(h, 'CRPIX2')],
    crval: [num(h, 'CRVAL1'), num(h, 'CRVAL2')],
    cd,
    cdInv,
    a: sip ? readPoly(h, 'A') : null,
    b: sip ? readPoly(h, 'B') : null,
    ap: sip ? readPoly(h, 'AP') : null,
    bp: sip ? readPoly(h, 'BP') : null,
  };
}

/** Pixel scale in arcseconds per pixel (geometric mean of the CD matrix). */
export function pixelScaleArcsec(w: CelestialWcs): number {
  const det = Math.abs(w.cd[0][0] * w.cd[1][1] - w.cd[0][1] * w.cd[1][0]);
  return Math.sqrt(det) * 3600;
}

/** FITS 1-based pixel -> (RA, Dec) in degrees. */
export function pixToSky(w: CelestialWcs, x: number, y: number): [number, number] {
  const u = x - w.crpix[0];
  const v = y - w.crpix[1];
  const uu = u + evalPoly(w.a, u, v);
  const vv = v + evalPoly(w.b, u, v);
  const xi = (w.cd[0][0] * uu + w.cd[0][1] * vv) * D2R;
  const eta = (w.cd[1][0] * uu + w.cd[1][1] * vv) * D2R;
  const a0 = w.crval[0] * D2R;
  const d0 = w.crval[1] * D2R;
  const denom = Math.cos(d0) - eta * Math.sin(d0);
  const ra = a0 + Math.atan2(xi, denom);
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.sqrt(xi * xi + denom * denom));
  return [(((ra * R2D) % 360) + 360) % 360, dec * R2D];
}

/** (RA, Dec) in degrees -> FITS 1-based pixel. Uses AP/BP when present, then refines with Newton steps on A/B. */
export function skyToPix(w: CelestialWcs, ra: number, dec: number): [number, number] {
  const a = ra * D2R;
  const d = dec * D2R;
  const a0 = w.crval[0] * D2R;
  const d0 = w.crval[1] * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  if (cosc <= 0) return [NaN, NaN];
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc * R2D;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc * R2D;
  const U = w.cdInv[0][0] * xi + w.cdInv[0][1] * eta;
  const V = w.cdInv[1][0] * xi + w.cdInv[1][1] * eta;
  let u = U + evalPoly(w.ap, U, V);
  let v = V + evalPoly(w.bp, U, V);
  if (w.a || w.b) {
    // Newton refinement so that u + A(u,v) = U and v + B(u,v) = V to well below a pixel.
    for (let i = 0; i < 6; i++) {
      const fu = u + evalPoly(w.a, u, v) - U;
      const fv = v + evalPoly(w.b, u, v) - V;
      if (Math.abs(fu) < 1e-6 && Math.abs(fv) < 1e-6) break;
      const h = 1e-3;
      const dfu_du = 1 + (evalPoly(w.a, u + h, v) - evalPoly(w.a, u - h, v)) / (2 * h);
      const dfu_dv = (evalPoly(w.a, u, v + h) - evalPoly(w.a, u, v - h)) / (2 * h);
      const dfv_du = (evalPoly(w.b, u + h, v) - evalPoly(w.b, u - h, v)) / (2 * h);
      const dfv_dv = 1 + (evalPoly(w.b, u, v + h) - evalPoly(w.b, u, v - h)) / (2 * h);
      const det = dfu_du * dfv_dv - dfu_dv * dfv_du;
      u -= (fu * dfv_dv - fv * dfu_dv) / det;
      v -= (fv * dfu_du - fu * dfv_du) / det;
    }
  }
  return [u + w.crpix[0], v + w.crpix[1]];
}

/**
 * SPHEREx per-pixel wavelength from the WCS-WAVE lookup table (FITS Paper III -TAB, bilinear),
 * as documented in the SPHEREx archive user guide. Header keys use the alternate WCS "W":
 * psi = CRVALiW + CDELTiW * (p - CRPIXiW), then bilinear interpolation over the X/Y control points.
 */
export interface WaveLookup {
  crpix: [number, number];
  crval: [number, number];
  cdelt: [number, number];
  x: number[];
  y: number[];
  /** values[iy][ix] = [central wavelength um, bandwidth um] */
  values: [number, number][][];
}

export function readWaveLookup(imageHeader: Header, table: { columns: Map<string, number[][]> }): WaveLookup {
  const x = table.columns.get('X')?.[0];
  const y = table.columns.get('Y')?.[0];
  const flat = table.columns.get('VALUES')?.[0];
  if (!x || !y || !flat) throw new Error('WCS-WAVE table is missing X, Y or VALUES');
  const values: [number, number][][] = [];
  for (let iy = 0; iy < y.length; iy++) {
    const row: [number, number][] = [];
    for (let ix = 0; ix < x.length; ix++) {
      const k = (iy * x.length + ix) * 2; // TDIM (2, nx, ny): fastest axis first
      row.push([flat[k], flat[k + 1]]);
    }
    values.push(row);
  }
  return {
    crpix: [num(imageHeader, 'CRPIX1W'), num(imageHeader, 'CRPIX2W')],
    crval: [num(imageHeader, 'CRVAL1W', 1), num(imageHeader, 'CRVAL2W', 1)],
    cdelt: [num(imageHeader, 'CDELT1W', 1), num(imageHeader, 'CDELT2W', 1)],
    x,
    y,
    values,
  };
}

function bracket(a: number[], v: number): [number, number] {
  let j = 0;
  while (j < a.length - 2 && v >= a[j + 1]) j++;
  return [j, (v - a[j]) / (a[j + 1] - a[j])];
}

/** Central wavelength and bandwidth (micrometres) at FITS 1-based pixel (px, py). */
export function wavelengthAt(w: WaveLookup, px: number, py: number): { wavelength: number; bandwidth: number } {
  const psi1 = w.crval[0] + w.cdelt[0] * (px - w.crpix[0]);
  const psi2 = w.crval[1] + w.cdelt[1] * (py - w.crpix[1]);
  const [jx, tx] = bracket(w.x, psi1);
  const [jy, ty] = bracket(w.y, psi2);
  const out = [0, 0];
  for (const k of [0, 1]) {
    out[k] =
      w.values[jy][jx][k] * (1 - tx) * (1 - ty) +
      w.values[jy][jx + 1][k] * tx * (1 - ty) +
      w.values[jy + 1][jx][k] * (1 - tx) * ty +
      w.values[jy + 1][jx + 1][k] * tx * ty;
  }
  return { wavelength: out[0], bandwidth: out[1] };
}

/** Angular separation in arcseconds. */
export function separationArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d1 = dec1 * D2R;
  const d2 = dec2 * D2R;
  const dra = (ra2 - ra1) * D2R;
  const s =
    Math.sin((d2 - d1) / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin(dra / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) * R2D * 3600;
}
