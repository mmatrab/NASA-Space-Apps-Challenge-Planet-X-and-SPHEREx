/** Browser-side PNG and animated GIF export of what the viewer shows. */
import { renderCaptioned, type SkyCanvasProps } from '../components/SkyCanvas.tsx';
import { encodeGif } from './gif.ts';

export interface ExportFrame {
  props: SkyCanvasProps;
  caption: string[];
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const fileStem = (label: string) => `spherex_${label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

export function savePng(frame: ExportFrame, name: string) {
  renderCaptioned(frame.props, frame.caption).toBlob((b) => b && download(b, `${name}.png`));
}

/** Encodes every frame (same size, same stretch) into a looping GIF and downloads it. */
export async function saveGif(frames: ExportFrame[], delayMs: number, name: string): Promise<number> {
  const rgba = frames.map((f) => {
    const cv = renderCaptioned(f.props, f.caption);
    return { rgba: cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data, width: cv.width, height: cv.height, delayMs };
  });
  await new Promise((r) => setTimeout(r, 0)); // let the button show its busy state
  const bytes = encodeGif(rgba);
  download(new Blob([bytes as BlobPart], { type: 'image/gif' }), `${name}.gif`);
  return bytes.length;
}
