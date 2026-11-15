/**
 * SPHEREx Level 2 pixel flags: SPHEREx Explanatory Supplement v2.1 (2026-11-10), Table 16.
 * BAD_PIXEL_MASK lists the flags the Supplement's own mosaic tool sets to NaN (Sect. 3.4.3).
 */
export const FLAG_BITS: Record<string, number> = {
  TRANSIENT: 0,
  OVERFLOW: 1,
  SUR_ERROR: 2,
  NONFUNC: 6,
  DICHROIC: 7,
  MISSING_DATA: 9,
  HOT: 10,
  COLD: 11,
  FULLSAMPLE: 12,
  PHANMISS: 14,
  NONLINEAR: 15,
  PERSIST: 17,
  OUTLIER: 19,
  CROSSTALK: 20,
  SOURCE: 21,
  GHOST: 22,
  GHOST_FPA: 23,
  GHOST_EXT: 24,
  STREAK: 25,
  BLOOM: 26,
  SNOWBALL: 27,
  HALO: 28,
  SATELLITE_HALO: 29,
};

const BAD = [
  'TRANSIENT', 'SUR_ERROR', 'NONFUNC', 'DICHROIC', 'MISSING_DATA',
  'HOT', 'COLD', 'PHANMISS', 'NONLINEAR', 'PERSIST',
  'CROSSTALK', 'GHOST', 'GHOST_FPA', 'GHOST_EXT',
  'STREAK', 'BLOOM', 'SNOWBALL', 'HALO', 'SATELLITE_HALO',
];

export const BAD_PIXEL_MASK = BAD.reduce((m, name) => m | (1 << FLAG_BITS[name]), 0);

/** Names of the flags set in a pixel's flag value. */
export function flagNames(value: number): string[] {
  return Object.entries(FLAG_BITS)
    .filter(([, bit]) => (value >>> 0) & (1 << bit))
    .map(([name]) => name);
}

export function isBad(value: number): boolean {
  return ((value >>> 0) & BAD_PIXEL_MASK) !== 0;
}

/** Plain-language meaning of the flags a visitor is most likely to meet. */
export const FLAG_PLAIN: Record<string, string> = {
  TRANSIENT: 'brief hit, e.g. a cosmic ray',
  OVERFLOW: 'very bright, near saturation',
  SOURCE: 'a known source sits here',
  OUTLIER: 'value unlike its neighbours',
  NONFUNC: 'dead pixel',
  HOT: 'noisy pixel',
  PERSIST: 'afterglow from an earlier bright source',
  GHOST: 'optical ghost',
  STREAK: 'streak (e.g. satellite)',
  HALO: 'halo of a bright star',
  SATELLITE_HALO: 'halo of a satellite',
  NONLINEAR: 'brightness correction unreliable',
};
