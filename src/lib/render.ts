/** Display stretch: limits from percentiles shared by all frames, so blinking never flickers. */
export interface Stretch {
  lo: number;
  hi: number;
  kind: 'asinh' | 'linear';
}

export function percentiles(arrays: Float32Array[], pLo: number, pHi: number): [number, number] {
  const vals: number[] = [];
  for (const a of arrays) for (const v of a) if (Number.isFinite(v)) vals.push(v);
  if (!vals.length) return [0, 1];
  vals.sort((x, y) => x - y);
  const at = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round((p / 100) * (vals.length - 1))))];
  const lo = at(pLo);
  const hi = at(pHi);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** Symmetric limits for difference images (zero stays mid-grey). */
export function symmetricLimit(arrays: Float32Array[], p: number): number {
  const vals: number[] = [];
  for (const a of arrays) for (const v of a) if (Number.isFinite(v)) vals.push(Math.abs(v));
  if (!vals.length) return 1;
  vals.sort((x, y) => x - y);
  return vals[Math.min(vals.length - 1, Math.round((p / 100) * (vals.length - 1)))] || 1;
}

export function toLevel(v: number, s: Stretch): number {
  let t = (v - s.lo) / (s.hi - s.lo);
  t = Math.min(1, Math.max(0, t));
  if (s.kind === 'asinh') t = Math.asinh(10 * t) / Math.asinh(10);
  return t;
}

/**
 * Paints a size x size grid into RGBA. Missing data (NaN) is drawn in a distinct dark blue so it is
 * never mistaken for empty sky. diverging=true draws differences: dark = fainter, white = brighter.
 */
export function paint(
  data: Float32Array,
  size: number,
  s: Stretch,
  opts: { diverging?: boolean; flags?: Uint32Array; flagMask?: number } = {}
): ImageData {
  const img = new ImageData(size, size);
  for (let k = 0; k < size * size; k++) {
    const v = data[k];
    const o = k * 4;
    if (!Number.isFinite(v)) {
      img.data[o] = 22; img.data[o + 1] = 30; img.data[o + 2] = 60; img.data[o + 3] = 255;
      continue;
    }
    const t = toLevel(v, s);
    const g = Math.round(t * 255);
    img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = g; img.data[o + 3] = 255;
    if (opts.flags && opts.flagMask && (opts.flags[k] & opts.flagMask)) {
      img.data[o] = Math.min(255, g * 0.5 + 140); img.data[o + 1] = g * 0.5; img.data[o + 2] = g * 0.5;
    }
  }
  return img;
}
