import { describe, expect, it } from 'vitest';
import { dedupeImages, describePath, isAllowedImagePath, parseCsv, parseSesame, parseVoTable, toMjd, type ImageRecord } from '../server/api.ts';

const EXAMPLE = 'ibe/data/spherex/qr3/level2/2026W21_2A/l2b-v27-2026-268/1/level2_2026W21_2A_0001_2D1_spx_l2b-v27-2026-268.fits';

describe('image paths', () => {
  it('reads observation, detector, release and version from the documented file name format', () => {
    expect(describePath(EXAMPLE)).toEqual({ obsId: '2026W21_2A_0001_2', detector: 1, version: 27, release: 'qr3' });
  });
  it('only lets SPHEREx archive paths through to IRSA', () => {
    expect(isAllowedImagePath(EXAMPLE)).toBe(true);
    expect(isAllowedImagePath('ibe/data/wise/x.fits')).toBe(false);
    expect(isAllowedImagePath('ibe/data/spherex/../../etc/passwd.fits')).toBe(false);
    expect(isAllowedImagePath('https://evil.example/ibe/data/spherex/a.fits')).toBe(false);
  });
  it('keeps one record per exposure and detector, newest pipeline version first, sorted by time', () => {
    const r = (path: string, mjd: number): ImageRecord => ({ path, mjd, bandpass: null, ...describePath(path) });
    const a = r('ibe/data/spherex/qr3/level2/W/l2b-v12-2025-1/1/level2_OBS1D1_spx_l2b-v12-2025-1.fits', 61000);
    const b = r('ibe/data/spherex/dr1/level2/W/l2b-v27-2026-1/1/level2_OBS1D1_spx_l2b-v27-2026-1.fits', 61000);
    const c = r('ibe/data/spherex/dr1/level2/W/l2b-v27-2026-1/2/level2_OBS0D2_spx_l2b-v27-2026-1.fits', 60990);
    expect(dedupeImages([a, b, c]).map((x) => x.path)).toEqual([c.path, b.path]);
  });
});

describe('archive response parsers', () => {
  it('parses TAP CSV with quoted fields', () => {
    const rows = parseCsv('uri,time_bounds_lower,energy_bandpassname\n"ibe/a,b.fits",61181.5,SPHEREx-D1\r\nibe/c.fits,61182,SPHEREx-D2\n');
    expect(rows).toEqual([
      { uri: 'ibe/a,b.fits', time_bounds_lower: '61181.5', energy_bandpassname: 'SPHEREx-D1' },
      { uri: 'ibe/c.fits', time_bounds_lower: '61182', energy_bandpassname: 'SPHEREx-D2' },
    ]);
  });
  it('parses SIA2 VOTable TABLEDATA by field name', () => {
    const xml = `<VOTABLE><RESOURCE><TABLE><FIELD name="access_url" datatype="char"/><FIELD name="t_min" datatype="double"/><DATA><TABLEDATA>
<TR><TD>https://irsa.ipac.caltech.edu/${EXAMPLE}?a=1&amp;b=2</TD><TD>61181.506</TD></TR><TR><TD/><TD>1</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
    const rows = parseVoTable(xml);
    expect(rows[0].access_url).toBe(`https://irsa.ipac.caltech.edu/${EXAMPLE}?a=1&b=2`);
    expect(rows[0].t_min).toBe('61181.506');
    expect(rows[1].access_url).toBe('');
  });
  it('parses CDS Sesame XML, and returns null when nothing is found', () => {
    const xml = '<Sesame><Target><Resolver><oname>* R Dra</oname><jradeg>246.6</jradeg><jdedeg>66.75</jdedeg><pmRA><v>-12.3</v></pmRA><pmDE><v>4.5</v></pmDE></Resolver></Target></Sesame>';
    expect(parseSesame(xml)).toEqual({ name: '* R Dra', ra: 246.6, dec: 66.75, pmra: -12.3, pmdec: 4.5 });
    expect(parseSesame('<Sesame><Target><INFO>*** Nothing found ***</INFO></Target></Sesame>')).toBeNull();
  });
  it('converts archive times to MJD', () => {
    expect(toMjd('61181.506')).toBe(61181.506);
    expect(toMjd('2026-05-21T12:00:00')).toBeCloseTo(61181.5, 6);
    expect(toMjd('')).toBeNull();
  });
});
