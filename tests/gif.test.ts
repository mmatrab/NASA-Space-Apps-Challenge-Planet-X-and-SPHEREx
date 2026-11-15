import { describe, expect, it } from 'vitest';
import { countGifFrames, encodeGif } from '../src/lib/gif.ts';

const frame = (grey: number, delayMs = 500) => {
  const rgba = new Uint8ClampedArray(16 * 16 * 4);
  for (let k = 0; k < 256; k++) rgba.set([grey, grey, grey, 255], k * 4);
  return { rgba, width: 16, height: 16, delayMs };
};

describe('animated GIF export', () => {
  it('writes a looping GIF89a with one image per frame', () => {
    const bytes = encodeGif([frame(0), frame(128), frame(255)]);
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes[bytes.length - 1]).toBe(0x3b);
    expect(new TextDecoder().decode(bytes)).toContain('NETSCAPE2.0');
    expect(countGifFrames(bytes)).toBe(3);
  });
  it('refuses to make an empty GIF', () => {
    expect(() => encodeGif([])).toThrow();
  });
});
