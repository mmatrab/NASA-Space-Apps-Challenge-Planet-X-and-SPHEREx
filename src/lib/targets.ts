/** Test targets named by the challenge. Positions come from CDS Sesame at click time, except
 * WISE 0855, whose coordinates the challenge text gives explicitly. */
export interface Target {
  id: string;
  label: string;
  why: string;
  /** Name sent to CDS Sesame. */
  resolve?: string;
  ra?: number;
  dec?: number;
  coordsSource?: string;
}

export const TEST_TARGETS: Target[] = [
  { id: 'barnard', label: "Barnard's Star", why: 'fastest-moving star on our sky', resolve: "Barnard's Star" },
  { id: 'epsind', label: 'Epsilon Indi B', why: 'pair of brown dwarfs orbiting a star', resolve: 'eps Ind B' },
  {
    id: 'wise0855',
    label: 'WISE 0855',
    why: 'fast-moving, very cold brown dwarf',
    ra: (8 + 55 / 60 + 10.831 / 3600) * 15,
    dec: -(7 + 14 / 60 + 42.53 / 3600),
    coordsSource: 'challenge text: RA 08h55m10.831s, Dec −7°14′42.53″',
  },
  { id: 'rwaur', label: 'RW Aurigae', why: 'variable young star', resolve: 'RW Aur' },
  { id: 'rdra', label: 'R Draconis', why: 'pulsating variable star', resolve: 'R Dra' },
];

/** The one example image path printed in the SPHEREx archive user guide (cutout section). */
export const ARCHIVE_EXAMPLE = {
  label: 'Archive guide example (1 exposure)',
  path: 'ibe/data/spherex/qr3/level2/2026W21_2A/l2b-v27-2026-268/1/level2_2026W21_2A_0001_2D1_spx_l2b-v27-2026-268.fits',
  ra: 337.8783221,
  dec: -5.1891588,
};
