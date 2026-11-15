import { useEffect, useRef } from 'react';
import type { GaiaStar } from '../lib/api.ts';
import { mjdToJulianYear, propagate } from '../lib/coords.ts';
import { BAD_PIXEL_MASK } from '../lib/flags.ts';
import { gridToSky, skyToGrid, type Grid } from '../lib/frames.ts';
import { paint, type Stretch } from '../lib/render.ts';

const VIEW = 512;

export interface SkyCanvasProps {
  grid: Grid;
  data: Float32Array;
  stretch: Stretch;
  mjd: number;
  label: string;
  flags?: Uint32Array;
  showFlags?: boolean;
  stars?: GaiaStar[] | null;
  showGaia?: boolean;
  picked?: { ra: number; dec: number } | null;
  onPick?: (p: { ra: number; dec: number }) => void;
}

/** Draws one frame (image, Gaia stars at the frame's date, target, picked pixel, scale bar). */
export function drawSky(ctx: CanvasRenderingContext2D, p: SkyCanvasProps): void {
  const { grid } = p;
  const off = document.createElement('canvas');
  off.width = grid.size;
  off.height = grid.size;
  off.getContext('2d')!.putImageData(
    paint(p.data, grid.size, p.stretch, { flags: p.showFlags ? p.flags : undefined, flagMask: BAD_PIXEL_MASK }),
    0,
    0
  );
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, VIEW, VIEW);
  ctx.drawImage(off, 0, 0, VIEW, VIEW);
  const k = VIEW / grid.size;
  const at = (ra: number, dec: number) => {
    const [i, j] = skyToGrid(grid, ra, dec);
    return [(i + 0.5) * k, (j + 0.5) * k];
  };
  if (p.showGaia && p.stars) {
    const year = mjdToJulianYear(p.mjd);
    for (const s of p.stars) {
      const moving = s.pmra !== null && s.pmdec !== null;
      const pos = moving ? propagate(s.ra, s.dec, s.pmra!, s.pmdec!, s.refEpoch, year) : s;
      const [x, y] = at(pos.ra, pos.dec);
      if (x < -10 || y < -10 || x > VIEW + 10 || y > VIEW + 10) continue;
      const fast = moving && Math.hypot(s.pmra!, s.pmdec!) > 500;
      ctx.strokeStyle = fast ? '#ffb020' : 'rgba(120,190,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, fast ? 10 : 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const [cx, cy] = at(grid.ra, grid.dec);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * 14, cy + dy * 14);
    ctx.lineTo(cx + dx * 26, cy + dy * 26);
    ctx.stroke();
  }
  if (p.picked) {
    const [px, py] = at(p.picked.ra, p.picked.dec);
    ctx.strokeStyle = '#e03c31';
    ctx.lineWidth = 2;
    ctx.strokeRect(px - k / 2 - 2, py - k / 2 - 2, k + 4, k + 4);
  }
  const bar = (60 / grid.scaleArcsec) * k;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(12, VIEW - 18, bar, 3);
  ctx.font = '12px Helvetica, Arial, sans-serif';
  ctx.fillText('1′', 12, VIEW - 24);
  ctx.fillText('N ↑  E ←', VIEW - 70, VIEW - 12);
}

const CAPTION_LINE = 17;

/** A frame with a white caption band underneath, as saved in PNG and GIF exports. */
export function renderCaptioned(p: SkyCanvasProps, lines: string[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = VIEW;
  out.height = VIEW + 14 + lines.length * CAPTION_LINE;
  const g = out.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, out.width, out.height);
  const sky = document.createElement('canvas');
  sky.width = VIEW;
  sky.height = VIEW;
  drawSky(sky.getContext('2d')!, p);
  g.drawImage(sky, 0, 0);
  g.fillStyle = '#0b0b0b';
  g.font = '13px Helvetica, Arial, sans-serif';
  lines.forEach((l, i) => g.fillText(l.slice(0, 80), 8, VIEW + 18 + i * CAPTION_LINE));
  return out;
}

/** One SPHEREx frame on the common grid, north up, with Gaia stars moved to the frame's date. */
export function SkyCanvas(p: SkyCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (ref.current) drawSky(ref.current.getContext('2d')!, p);
  }, [p.grid, p.data, p.stretch, p.mjd, p.flags, p.showFlags, p.stars, p.showGaia, p.picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!p.onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width) * p.grid.size);
    const j = Math.floor(((e.clientY - r.top) / r.height) * p.grid.size);
    const [ra, dec] = gridToSky(p.grid, i, j);
    p.onPick({ ra, dec });
  };

  return (
    <canvas
      ref={ref}
      width={VIEW}
      height={VIEW}
      onClick={onClick}
      className="sky pixelated"
      aria-label={`SPHEREx image, ${p.label}.${p.onPick ? ' Click a pixel to see its spectrum.' : ''}`}
    />
  );
}

/** Canvas of this component, for PNG export. */
export const SKY_VIEW = VIEW;
