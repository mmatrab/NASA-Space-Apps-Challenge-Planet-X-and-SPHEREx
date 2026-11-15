/** Parsing and formatting of sky coordinates (ICRS). */

export interface SkyPosition {
  ra: number; // degrees
  dec: number; // degrees
}

/**
 * Parses right ascension: decimal degrees ("133.795"), or sexagesimal hours
 * ("08h55m10.831s", "08:55:10.831", "08 55 10.831").
 */
export function parseRa(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const sexa = s.match(/^(\d{1,2})[h:\s]+(\d{1,2})[m:\s]+(\d{1,2}(?:\.\d+)?)s?$/);
  if (sexa) {
    const [h, m, sec] = sexa.slice(1).map(Number);
    if (h >= 24 || m >= 60 || sec >= 60) return null;
    return (h + m / 60 + sec / 3600) * 15;
  }
  const deg = s.replace(/d(eg)?$/, '');
  if (/^[+]?\d+(\.\d+)?$/.test(deg)) {
    const v = Number(deg);
    return v >= 0 && v < 360 ? v : null;
  }
  return null;
}

/**
 * Parses declination: decimal degrees ("-7.245"), or sexagesimal degrees
 * ("-7d14m42.53s", "-07:14:42.53", "-07 14 42.53", "−7°14′42.53″").
 */
export function parseDec(input: string): number | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[−–]/g, '-')
    .replace(/[°]/g, 'd')
    .replace(/[′']/g, 'm')
    .replace(/[″"]/g, 's');
  if (!s) return null;
  const sexa = s.match(/^([+-]?)(\d{1,2})[d:\s]+(\d{1,2})[m:\s]+(\d{1,2}(?:\.\d+)?)s?$/);
  if (sexa) {
    const sign = sexa[1] === '-' ? -1 : 1;
    const [d, m, sec] = sexa.slice(2).map(Number);
    if (d > 90 || m >= 60 || sec >= 60) return null;
    const v = sign * (d + m / 60 + sec / 3600);
    return Math.abs(v) <= 90 ? v : null;
  }
  const deg = s.replace(/d(eg)?$/, '');
  if (/^[+-]?\d+(\.\d+)?$/.test(deg)) {
    const v = Number(deg);
    return Math.abs(v) <= 90 ? v : null;
  }
  return null;
}

const pad = (n: number, w: number, d = 0) => n.toFixed(d).padStart(w + (d ? d + 1 : 0), '0');

export function formatRa(ra: number): string {
  let t = ((ra % 360) + 360) % 360 / 15;
  let h = Math.floor(t);
  t = (t - h) * 60;
  let m = Math.floor(t);
  let s = Math.round((t - m) * 60 * 100) / 100;
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; h = (h + 1) % 24; }
  return `${pad(h, 2)}h${pad(m, 2)}m${pad(s, 2, 2)}s`;
}

export function formatDec(dec: number): string {
  const sign = dec < 0 ? '−' : '+';
  let t = Math.abs(dec);
  let d = Math.floor(t);
  t = (t - d) * 60;
  let m = Math.floor(t);
  let s = Math.round((t - m) * 60 * 10) / 10;
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }
  return `${sign}${pad(d, 2)}°${pad(m, 2)}′${pad(s, 2, 1)}″`;
}

/**
 * Moves a star along its proper motion (ignores parallax and radial velocity, which are below a
 * SPHEREx pixel for this use). pmra is mu_alpha* (includes cos dec), mas/yr; epochs in Julian years.
 */
export function propagate(
  ra: number,
  dec: number,
  pmraMasYr: number,
  pmdecMasYr: number,
  fromYear: number,
  toYear: number
): SkyPosition {
  const dt = toYear - fromYear;
  const dDec = (pmdecMasYr * dt) / 3.6e6;
  const dRa = (pmraMasYr * dt) / 3.6e6 / Math.cos((dec * Math.PI) / 180);
  return { ra: (((ra + dRa) % 360) + 360) % 360, dec: dec + dDec };
}

/** MJD (UTC) to Julian year, e.g. Gaia DR3 reference epoch J2016.0 = MJD 57388.5. */
export function mjdToJulianYear(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25;
}

/**
 * Reads "RA Dec" typed in one field: "133.795 -7.245", "08h55m10.8s -7d14m42s",
 * "08:55:10.8, -07:14:42", "08 55 10.8 -07 14 42". Returns null when the text is not a position
 * (it is then treated as an object name).
 */
export function parsePosition(text: string): SkyPosition | null {
  const s = text.trim().replace(/[−–]/g, '-');
  if (!s) return null;
  const tryPair = (a: string, b: string) => {
    const ra = parseRa(a);
    const dec = parseDec(b);
    return ra !== null && dec !== null ? { ra, dec } : null;
  };
  if (s.includes(',')) {
    const [a, b, ...rest] = s.split(',');
    return rest.length ? null : tryPair(a, b ?? '');
  }
  const t = s.split(/\s+/);
  if (t.length === 2) return tryPair(t[0], t[1]);
  if (t.length === 6) return tryPair(t.slice(0, 3).join(' '), t.slice(3).join(' '));
  return null;
}
