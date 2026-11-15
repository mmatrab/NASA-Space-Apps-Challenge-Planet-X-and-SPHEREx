/** Pieces used by both Explore and Compare. */
import { useState } from 'react';
import { resolveName, type ImageRecord } from '../lib/api.ts';
import { flagNames } from '../lib/flags.ts';
import { formatDec, formatRa, parsePosition } from '../lib/coords.ts';
import { sampleAt } from '../lib/frames.ts';
import { ARCHIVE_EXAMPLE, type Target } from '../lib/targets.ts';
import type { SpectrumPoint } from '../components/Spectrum.tsx';
import type { Position, Sky } from '../useSky.ts';

/** Turns what the visitor typed (or a suggested target) into a position. */
export async function findPosition(text: string, target?: Target): Promise<Position> {
  if (target?.ra !== undefined && target.dec !== undefined) {
    return { ra: target.ra, dec: target.dec, label: target.label, source: target.coordsSource ?? '' };
  }
  const typed = target ? null : parsePosition(text);
  if (typed) return { ...typed, label: `RA ${formatRa(typed.ra)} Dec ${formatDec(typed.dec)}`, source: 'typed coordinates' };
  const r = await resolveName(target?.resolve ?? text);
  return { ra: r.ra, dec: r.dec, label: target?.label ?? text, source: `CDS Sesame${r.name ? ` (${r.name})` : ''}` };
}

export function SearchBox({ onFind, compact }: { onFind: (text: string) => void; compact?: boolean }) {
  const [text, setText] = useState('');
  return (
    <form
      className="flex gap-2 items-stretch min-w-0 max-w-full"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onFind(text.trim());
      }}
    >
      <label className="sr-only" htmlFor={compact ? 'q2' : 'q'}>Object name, or RA and Dec</label>
      <input
        id={compact ? 'q2' : 'q'}
        className="input"
        style={{ width: compact ? 260 : 340, flex: '1 1 auto' }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Name, or RA Dec (08:55:10.8 -07:14:42)"
      />
      <button type="submit" className="btn k">Go</button>
    </form>
  );
}

/** Load state: progress, archive errors with a retry and the archive's own example image. */
export function LoadStatus({ sky }: { sky: Sky }) {
  const { progress, loadError, position, searchInfo } = sky;
  if (loadError) {
    return (
      <div className="alert" role="alert">
        <p className="m-0"><b>No image list from IRSA right now.</b> <span className="mut">{loadError}</span></p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" className="btn" onClick={() => position && void sky.go(position)}>Retry</button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void sky.go(
                { ra: ARCHIVE_EXAMPLE.ra, dec: ARCHIVE_EXAMPLE.dec, label: ARCHIVE_EXAMPLE.label, source: 'SPHEREx archive user guide' },
                [{ path: ARCHIVE_EXAMPLE.path, obsId: null, detector: 1, mjd: null, bandpass: null, release: 'qr3', version: 27 } satisfies ImageRecord]
              )
            }
          >
            Open the archive's example image
          </button>
        </div>
      </div>
    );
  }
  if (!progress) return position ? <p className="mut">Asking IRSA which SPHEREx images cover this spot…</p> : null;
  if (progress.total === 0) return <p className="mut">No SPHEREx image covers this spot with the selected detectors yet.</p>;
  return (
    <div aria-live="polite">
      <div className="bar-progress"><i style={{ width: `${(100 * progress.done) / progress.total}%` }} /></div>
      <p className="lbl mt-1.5">
        {progress.done} / {progress.total} images loaded{progress.failed ? ` · ${progress.failed} failed` : ''}{searchInfo ? ` · ${searchInfo}` : ''}
      </p>
    </div>
  );
}

/** One point per exposure at the picked sky position, each at its own wavelength. */
export function spectrumAt(sky: Sky, picked: { ra: number; dec: number } | null): SpectrumPoint[] {
  if (!picked) return [];
  const out: SpectrumPoint[] = [];
  for (const g of sky.gridFrames) {
    const s = sampleAt(g.source, picked.ra, picked.dec, { subtractZodi: sky.subtractZodi, maskBad: sky.maskBad });
    if (!s || s.wavelength === null) continue;
    out.push({
      wavelength: s.wavelength,
      bandwidth: s.bandwidth,
      value: s.value,
      error: s.error,
      epoch: sky.visitOf(g),
      detector: g.source.detector,
      dateIso: g.source.dateIso,
      flags: flagNames(s.flags),
    });
  }
  return out;
}

export function Pill({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="pill" aria-pressed={on} onClick={onClick} disabled={disabled} style={disabled ? { opacity: 0.4 } : undefined}>
      {children}
    </button>
  );
}
