/** Animated GIF of the frames being played, for demos and sharing. Encoder: gifenc (MIT, ~5 KB). */
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export interface RgbaFrame {
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  delayMs: number;
}

/** Encodes frames into a looping GIF (each frame gets its own 256-colour palette). */
export function encodeGif(frames: RgbaFrame[]): Uint8Array {
  if (!frames.length) throw new Error('No frames to encode');
  const gif = GIFEncoder();
  for (const f of frames) {
    const palette = quantize(f.rgba, 256);
    gif.writeFrame(applyPalette(f.rgba, palette), f.width, f.height, { palette, delay: f.delayMs, repeat: 0 });
  }
  gif.finish();
  return gif.bytes();
}

/** Number of image frames in a GIF (counts Graphic Control Extensions), used by tests. */
export function countGifFrames(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) n++;
  return n;
}
