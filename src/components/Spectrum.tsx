import { useState } from 'react';

export interface SpectrumPoint {
  wavelength: number; // um
  bandwidth: number | null;
  value: number; // MJy/sr
  error: number | null;
  epoch: number;
  detector: number;
  dateIso: string;
  flags: string[];
}

/** Colour per survey visit on a white background; the first three are colour-blind-safe as a set. */
export const EPOCH_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#e87ba4', '#eda100', '#6250d6'];

const W = 560;
const H = 260;
const PAD = { l: 58, r: 14, t: 14, b: 40 };

export function Spectrum({ points, epochLabels }: { points: SpectrumPoint[]; epochLabels: string[] }) {
  const [table, setTable] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const shown = points.filter((p) => !hidden.has(p.epoch));
  if (!points.length) {
    return (
      <p className="mut">
        No usable pixel here: it is flagged in every loaded image (often because a bright star saturates it). Click next to it, or
        turn off “Hide flagged pixels” to see the raw values.
      </p>
    );
  }
  const xs = [0.7, 5.1];
  const vals = shown.flatMap((p) => [p.value - (p.error ?? 0), p.value + (p.error ?? 0)]);
  let lo = Math.min(...vals, 0);
  let hi = Math.max(...vals, 0.001);
  const padY = (hi - lo) * 0.08 || 1;
  lo -= padY;
  hi += padY;
  const x = (w: number) => PAD.l + ((w - xs[0]) / (xs[1] - xs[0])) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const yTicks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const epochs = [...new Set(points.map((p) => p.epoch))].sort((a, b) => a - b);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {epochs.map((e) => (
          <button
            key={e}
            type="button"
            className="pill"
            aria-pressed={!hidden.has(e)}
            onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n; })}
            style={{ opacity: hidden.has(e) ? 0.45 : 1, background: '#fff', color: '#000' }}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: EPOCH_COLOURS[e % EPOCH_COLOURS.length] }} />
            {epochLabels[e] ?? `Visit ${e + 1}`} ({points.filter((p) => p.epoch === e).length})
          </button>
        ))}
        <button type="button" className="btn ml-auto" onClick={() => setTable((t) => !t)}>
          {table ? 'Show plot' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="t">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th className="p-1">Wavelength (µm)</th><th className="p-1">Value (MJy/sr)</th><th className="p-1">± (MJy/sr)</th>
                <th className="p-1">Detector</th><th className="p-1">Date (UTC)</th><th className="p-1">Flags</th>
              </tr>
            </thead>
            <tbody>
              {[...shown].sort((a, b) => a.wavelength - b.wavelength).map((p, i) => (
                <tr key={i}>
                  <td className="p-1">{p.wavelength.toFixed(4)}</td>
                  <td className="p-1">{p.value.toPrecision(4)}</td>
                  <td className="p-1">{p.error === null ? '—' : p.error.toPrecision(2)}</td>
                  <td className="p-1">D{p.detector}</td>
                  <td className="p-1">{p.dateIso.slice(0, 16).replace('T', ' ')}</td>
                  <td className="p-1">{p.flags.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Spectrum: ${shown.length} measurements between 0.7 and 5.1 micrometres. Use Show table for the values.`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e6e6e6" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#626262">{t.toPrecision(3)}</text>
            </g>
          ))}
          {lo < 0 && hi > 0 && <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#999" />}
          {[1, 2, 3, 4, 5].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={H - PAD.b} y2={H - PAD.b + 4} stroke="#626262" />
              <text x={x(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize={11} fill="#626262">{t}</text>
            </g>
          ))}
          <text x={(W + PAD.l) / 2} y={H - 6} textAnchor="middle" fontSize={12} fill="#0b0b0b">Wavelength (µm, near-infrared)</text>
          <text x={14} y={H / 2} textAnchor="middle" fontSize={12} fill="#0b0b0b" transform={`rotate(-90 14 ${H / 2})`}>MJy/sr</text>
          {shown.map((p, i) => {
            const c = EPOCH_COLOURS[p.epoch % EPOCH_COLOURS.length];
            return (
              <g key={i}>
                {p.error !== null && <line x1={x(p.wavelength)} x2={x(p.wavelength)} y1={y(p.value - p.error)} y2={y(p.value + p.error)} stroke={c} strokeOpacity={0.5} />}
                <circle cx={x(p.wavelength)} cy={y(p.value)} r={3} fill={c}>
                  <title>{`${p.wavelength.toFixed(3)} µm · ${p.value.toPrecision(4)} MJy/sr · D${p.detector} · ${p.dateIso.slice(0, 10)}`}</title>
                </circle>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
