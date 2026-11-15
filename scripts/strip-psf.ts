/**
 * Writes a copy of a SPHEREx cutout without its EPSF/PSF table (the bulk of the file),
 * keeping every other HDU byte for byte. Used for the test fixture.
 *   node scripts/strip-psf.ts in.fits out.fits
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { hduRanges } from '../src/lib/fits.ts';

const [input, output] = process.argv.slice(2);
const buf = readFileSync(input);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const keep = hduRanges(ab).filter((r) => r.name !== 'EPSF' && r.name !== 'PSF');
writeFileSync(output, Buffer.concat(keep.map((r) => buf.subarray(r.start, r.end))));
console.log(`kept ${keep.map((r) => r.name).join(', ')}`);
