import { describe, expect, it } from 'vitest';
import { formatDec, formatRa, mjdToJulianYear, parseDec, parseRa, propagate } from '../src/lib/coords.ts';

describe('coordinates', () => {
  it('parses the WISE 0855 position given by the challenge', () => {
    expect(parseRa('08h55m10.831s')).toBeCloseTo(133.795129, 6);
    expect(parseDec('-7d14m42.53s')).toBeCloseTo(-7.245147, 6);
    expect(parseRa('08:55:10.831')).toBeCloseTo(133.795129, 6);
    expect(parseDec('−07°14′42.53″')).toBeCloseTo(-7.245147, 6);
    expect(parseRa('133.795')).toBe(133.795);
    expect(parseDec('-7.245')).toBe(-7.245);
  });
  it('rejects impossible values instead of guessing', () => {
    expect(parseRa('25h00m00s')).toBeNull();
    expect(parseRa('361')).toBeNull();
    expect(parseDec('+91')).toBeNull();
    expect(parseDec('abc')).toBeNull();
  });
  it('formats back to sexagesimal', () => {
    expect(formatRa(133.795129)).toBe('08h55m10.83s');
    expect(formatDec(-7.245147)).toBe('−07°14′42.5″');
  });
  it('moves a star along its proper motion', () => {
    // 1000 mas/yr north for 10 years = 10 arcsec.
    const p = propagate(10, 0, 0, 1000, 2016, 2026);
    expect((p.dec - 0) * 3600).toBeCloseTo(10, 9);
    expect(mjdToJulianYear(57388.5)).toBeCloseTo(2016.0, 9);
  });
});
