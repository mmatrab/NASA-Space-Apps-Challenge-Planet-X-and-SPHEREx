/**
 * Starting points for visitors who do not know where to look: the five test targets named by the
 * challenge. Positions and proper motions: SIMBAD, retrieved on 15 November 2026 through the CDS
 * Sesame service (CfA mirror); ICRS at epoch J2000.0, proper motions in mas/yr. The app moves them
 * to the SPHEREx dates, which matters: Barnard's Star has moved about 4.5′ since 2000.
 */
const SIMBAD = 'SIMBAD via CDS Sesame (CfA mirror), retrieved 2026-11-15';

export interface Target {
  id: string;
  label: string;
  /** One line: what the object is. */
  what: string;
  /** One line: what to look for in SPHEREx. */
  lookFor: string;
  /** Moving objects open in "change since first visit"; variable stars open on the images. */
  kind: 'moving' | 'variable';
  resolve?: string;
  ra?: number;
  dec?: number;
  /** Epoch of ra/dec (Julian year) and proper motion (mas/yr, pmra includes cos dec). */
  epoch?: number;
  pmra?: number;
  pmdec?: number;
  coordsSource?: string;
}

export const TEST_TARGETS: Target[] = [
  {
    id: 'barnard',
    label: "Barnard's Star",
    what: 'The star that crosses our sky fastest.',
    lookFor: 'It shifts between the six-month visits.',
    kind: 'moving',
    ra: 269.45207696, dec: 4.69336497, epoch: 2000.0, pmra: -801.551, pmdec: 10362.394,
    coordsSource: SIMBAD,
  },
  {
    id: 'wise0855',
    label: 'WISE 0855',
    what: 'A very cold brown dwarf near the Sun.',
    lookFor: 'A faint dot that moves, brightest at long wavelengths.',
    kind: 'moving',
    // The challenge gives RA 08h55m10.831s, Dec −7°14′42.53″ (an earlier epoch); at ~8″/yr the
    // brown dwarf is about 2′ west of that by 2026, so we use SIMBAD's position and proper motion.
    ra: 133.81890825, dec: -7.247048, epoch: 2000.0, pmra: -8123.7, pmdec: 673.2,
    coordsSource: `${SIMBAD} (WISEA J085510.74-071442.5)`,
  },
  {
    id: 'epsind',
    label: 'Epsilon Indi B',
    what: 'Two brown dwarfs orbiting a nearby star.',
    lookFor: 'The pair moving across the sky together.',
    kind: 'moving',
    ra: 331.04414659, dec: -56.7828442, epoch: 2000.0, pmra: 3981.977, pmdec: -2466.832,
    coordsSource: SIMBAD,
  },
  {
    id: 'rwaur',
    label: 'RW Aurigae',
    what: 'A young star whose brightness changes.',
    lookFor: 'Click the star and compare the visits in its spectrum.',
    kind: 'variable',
    ra: 76.95652603, dec: 30.40143817, epoch: 2000.0, pmra: 7.23, pmdec: -20.33,
    coordsSource: SIMBAD,
  },
  {
    id: 'rdra',
    label: 'R Draconis',
    what: 'A pulsating star that brightens and fades.',
    lookFor: 'A brightness change from one visit to the next.',
    kind: 'variable',
    ra: 248.16761083, dec: 66.75497942, epoch: 2000.0, pmra: -20.643, pmdec: 6.149,
    coordsSource: SIMBAD,
  },
];

/** The one example image path printed in the SPHEREx archive user guide (cutout section). */
export const ARCHIVE_EXAMPLE = {
  label: 'Archive guide example',
  path: 'ibe/data/spherex/qr3/level2/2026W21_2A/l2b-v27-2026-268/1/level2_2026W21_2A_0001_2D1_spx_l2b-v27-2026-268.fits',
  ra: 337.8783221,
  dec: -5.1891588,
};

/** Middle of the SPHEREx data so far (May 2025 to late 2026): where moving targets are centred. */
export const VIEW_EPOCH = 2026.0;
