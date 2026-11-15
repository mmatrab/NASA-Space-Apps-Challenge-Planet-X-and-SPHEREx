import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFits, hduRanges } from '../src/lib/fits.ts';
import { pixToSky, skyToPix, pixelScaleArcsec, wavelengthAt, separationArcsec } from '../src/lib/wcs.ts';
import { BAD_PIXEL_MASK, FLAG_BITS, flagNames, isBad } from '../src/lib/flags.ts';
import { frameFromFits, makeGrid, toGrid, gridToSky, skyToGrid, sampleAt, groupEpochs, stack, median, mjdToIso } from '../src/lib/frames.ts';

// Real SPHEREx QR3 cutout (detector 1) from IRSA, EPSF table removed. Requested centre:
// RA 337.8783221, Dec -5.1891588, size 0.1 deg (example in the SPHEREx archive user guide).
const buf = readFileSync(path.join(import.meta.dirname, 'fixtures', 'spherex-qr3-d1-cutout.fits'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const CENTER = { ra: 337.8783221, dec: -5.1891588 };

describe('FITS reader on a real SPHEREx cutout', () => {
  const hdus = parseFits(ab);
  it('finds the documented extensions', () => {
    expect(hdus.map((h) => h.name)).toEqual(['PRIMARY', 'IMAGE', 'FLAGS', 'VARIANCE', 'ZODI', 'WCS-WAVE']);
    expect(hduRanges(ab).at(-1)!.end).toBe(buf.byteLength);
  });
  it('reads image data as finite surface brightness values', () => {
    const img = hdus[1];
    if (img.kind !== 'image') throw new Error('not an image');
    expect([img.width, img.height]).toEqual([58, 59]);
    const finite = Array.from(img.data).filter(Number.isFinite);
    expect(finite.length).toBeGreaterThan(0.9 * img.data.length);
  });
});

describe('frame metadata, WCS and wavelength', () => {
  const f = frameFromFits(ab, 'test');
  it('reads time, detector and observation ID from the header', () => {
    expect(f.detector).toBe(1);
    expect(f.obsId).toBe('2026W21_2A_0001_2');
    expect(f.dateIso.startsWith('2026-05-21T12:09')).toBe(true);
    expect(mjdToIso(f.mjd).startsWith('2026-05-21T12:09')).toBe(true);
  });
  it('has SPHEREx pixels of about 6.2 arcsec', () => {
    expect(pixelScaleArcsec(f.wcs)).toBeGreaterThan(6.0);
    expect(pixelScaleArcsec(f.wcs)).toBeLessThan(6.4);
  });
  it('maps the requested cutout centre close to the middle of the cutout, and back', () => {
    const [x, y] = skyToPix(f.wcs, CENTER.ra, CENTER.dec);
    expect(Math.abs(x - (f.width + 1) / 2)).toBeLessThan(2);
    expect(Math.abs(y - (f.height + 1) / 2)).toBeLessThan(2);
    const [ra, dec] = pixToSky(f.wcs, x, y);
    expect(separationArcsec(ra, dec, CENTER.ra, CENTER.dec)).toBeLessThan(0.01);
  });
  it('gives a detector-1 wavelength (0.75–1.09 um) that changes across the filter', () => {
    const mid = wavelengthAt(f.wave!, 29, 30);
    expect(mid.wavelength).toBeCloseTo(0.8688, 3);
    expect(mid.wavelength).toBeGreaterThan(0.75);
    expect(mid.wavelength).toBeLessThan(1.09);
    expect(wavelengthAt(f.wave!, 1, 1).wavelength).not.toBeCloseTo(wavelengthAt(f.wave!, 58, 59).wavelength, 3);
  });
});

describe('flags (Explanatory Supplement Table 16)', () => {
  it('decodes bits and applies the documented bad-pixel mask', () => {
    expect(flagNames((1 << FLAG_BITS.SOURCE) | (1 << FLAG_BITS.TRANSIENT))).toEqual(['TRANSIENT', 'SOURCE']);
    expect(isBad(1 << FLAG_BITS.SOURCE)).toBe(false);
    expect(isBad(1 << FLAG_BITS.OVERFLOW)).toBe(false);
    expect(isBad(1 << FLAG_BITS.HOT)).toBe(true);
    expect(BAD_PIXEL_MASK & (1 << FLAG_BITS.OUTLIER)).toBe(0);
  });
});

describe('common grid', () => {
  const f = frameFromFits(ab, 'test');
  const g = makeGrid(CENTER.ra, CENTER.dec, 3, 6.2);
  it('is north-up and east-left, centred on the target', () => {
    const c = (g.size - 1) / 2;
    const [ra0, dec0] = gridToSky(g, c, c);
    expect(separationArcsec(ra0, dec0, CENTER.ra, CENTER.dec)).toBeLessThan(0.01);
    const [, decUp] = gridToSky(g, c, c - 10);
    expect(decUp).toBeGreaterThan(dec0);
    const [raLeft] = gridToSky(g, c - 10, c);
    expect(raLeft).toBeGreaterThan(ra0);
    const [i, j] = skyToGrid(g, ra0, dec0);
    expect(i).toBeCloseTo(c, 6);
    expect(j).toBeCloseTo(c, 6);
  });
  it('resamples real pixels without inventing values', () => {
    const gf = toGrid(f, g, { subtractZodi: false, maskBad: false });
    const values = new Set(Array.from(f.image));
    for (const v of gf.data) if (Number.isFinite(v)) expect(values.has(v)).toBe(true);
    expect(gf.coverage).toBeGreaterThan(0.9);
    expect(gf.centerWavelength).toBeGreaterThan(0.75);
  });
  it('subtracts the zodiacal light model when asked', () => {
    const raw = sampleAt(f, CENTER.ra, CENTER.dec, { subtractZodi: false, maskBad: false })!;
    const sub = sampleAt(f, CENTER.ra, CENTER.dec, { subtractZodi: true, maskBad: false })!;
    expect(raw.value - sub.value).toBeGreaterThan(0);
    expect(sub.wavelength).toBeCloseTo(raw.wavelength!, 9);
    expect(sub.error).toBeGreaterThan(0);
  });
});

describe('epochs, stacking and differences', () => {
  it('splits frames into survey epochs on gaps longer than 30 days', () => {
    const e = groupEpochs([61000, 61001, 61010, 61190, 61192, 61370], (m) => m);
    expect(e.map((x) => x.items.length)).toEqual([3, 2, 1]);
  });
  it('stacks and takes medians ignoring missing pixels', () => {
    const a = Float32Array.from([1, NaN, 3]);
    const b = Float32Array.from([3, 2, NaN]);
    const c = Float32Array.from([2, 4, NaN]);
    expect(Array.from(stack([a, b], 3))).toEqual([2, 2, 3]);
    expect(Array.from(median([a, b, c], 3))).toEqual([2, 3, 3]);
  });
});
