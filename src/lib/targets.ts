/**
 * Starting points for visitors who do not know where to look: the five test targets named by the
 * challenge. Positions come from CDS Sesame at click time, except WISE 0855, whose coordinates the
 * challenge text gives explicitly.
 */
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
  coordsSource?: string;
}

export const TEST_TARGETS: Target[] = [
  {
    id: 'barnard',
    label: "Barnard's Star",
    what: 'The star that crosses our sky fastest.',
    lookFor: 'It shifts between the six-month visits.',
    kind: 'moving',
    resolve: "Barnard's Star",
  },
  {
    id: 'wise0855',
    label: 'WISE 0855',
    what: 'A very cold brown dwarf near the Sun.',
    lookFor: 'A faint dot that moves, brightest at long wavelengths.',
    kind: 'moving',
    ra: (8 + 55 / 60 + 10.831 / 3600) * 15,
    dec: -(7 + 14 / 60 + 42.53 / 3600),
    coordsSource: 'challenge text (RA 08h55m10.831s, Dec −7°14′42.53″)',
  },
  {
    id: 'epsind',
    label: 'Epsilon Indi B',
    what: 'Two brown dwarfs orbiting a nearby star.',
    lookFor: 'The pair moving across the sky together.',
    kind: 'moving',
    resolve: 'eps Ind B',
  },
  {
    id: 'rwaur',
    label: 'RW Aurigae',
    what: 'A young star whose brightness changes.',
    lookFor: 'Click the star and compare the visits in its spectrum.',
    kind: 'variable',
    resolve: 'RW Aur',
  },
  {
    id: 'rdra',
    label: 'R Draconis',
    what: 'A pulsating star that brightens and fades.',
    lookFor: 'A brightness change from one visit to the next.',
    kind: 'variable',
    resolve: 'R Dra',
  },
];

/** The one example image path printed in the SPHEREx archive user guide (cutout section). */
export const ARCHIVE_EXAMPLE = {
  label: 'Archive guide example',
  path: 'ibe/data/spherex/qr3/level2/2026W21_2A/l2b-v27-2026-268/1/level2_2026W21_2A_0001_2D1_spx_l2b-v27-2026-268.fits',
  ra: 337.8783221,
  dec: -5.1891588,
};
