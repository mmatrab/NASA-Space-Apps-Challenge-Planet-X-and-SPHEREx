import { useEffect, useMemo, useRef, useState } from 'react';
import { irsaFileUrl } from '../lib/api.ts';
import { formatDec, formatRa } from '../lib/coords.ts';
import { difference, median } from '../lib/frames.ts';
import { percentiles, symmetricLimit, type Stretch } from '../lib/render.ts';
import { TEST_TARGETS, type Target } from '../lib/targets.ts';
import { SkyCanvas, SKY_VIEW } from '../components/SkyCanvas.tsx';
import { Spectrum } from '../components/Spectrum.tsx';
import { DETECTOR_RANGES, FOVS, type Sky } from '../useSky.ts';
import { LoadStatus, Pill, SearchBox, spectrumAt } from './shared.tsx';

type Mode = 'visits' | 'exposures';
type Show = 'image' | 'diff-median' | 'diff-first';

interface Frame {
  key: string;
  data: Float32Array;
  flags?: Uint32Array;
  mjd: number;
  caption: string;
  members: Sky['gridFrames'];
}

export function Explore({ sky, onFind, onCompare, activeTarget }: {
  sky: Sky;
  onFind: (text: string, target?: Target) => void;
  onCompare: () => void;
  activeTarget: string | null;
}) {
  const [mode, setMode] = useState<Mode>('visits');
  const [show, setShow] = useState<Show>('image');
  const [showGaia, setShowGaia] = useState(true);
  const [showFlags, setShowFlags] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(1.5);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<{ ra: number; dec: number } | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const { grid, visits, gridFrames, position } = sky;
  useEffect(() => { setPicked(position ? { ra: position.ra, dec: position.dec } : null); setIndex(0); }, [position]);

  const frames: Frame[] = useMemo(() => {
    if (!grid) return [];
    const n = grid.size * grid.size;
    const base: Frame[] =
      mode === 'visits'
        ? visits.map((v) => ({
            key: `v${v.index}`,
            data: v.data,
            mjd: v.midMjd,
            caption: `Visit ${v.index + 1} of ${visits.length} · ${sky.visitRange(v)} · ${v.members.length} image${v.members.length > 1 ? 's' : ''}`,
            members: v.members,
          }))
        : gridFrames.map((g, i) => ({
            key: `x${i}`,
            data: g.data,
            flags: g.flags,
            mjd: g.source.mjd,
            caption: `${g.source.dateIso.slice(0, 16).replace('T', ' ')} UTC · D${g.source.detector}${g.centerWavelength ? ` · ${g.centerWavelength.toFixed(3)} µm` : ''}`,
            members: [g],
          }));
    if (show === 'image' || base.length < 2) return base;
    const ref = show === 'diff-median' ? median(base.map((b) => b.data), n) : base[0].data;
    return base.map((b) => ({ ...b, data: difference(b.data, ref) }));
  }, [grid, mode, show, visits, gridFrames]); // eslint-disable-line react-hooks/exhaustive-deps

  const stretch: Stretch = useMemo(() => {
    const arrays = frames.map((f) => f.data);
    if (show !== 'image' && frames.length > 1) {
      const L = symmetricLimit(arrays, 99);
      return { lo: -L, hi: L, kind: 'linear' };
    }
    const [lo, hi] = percentiles(arrays, 1, 99.7);
    return { lo, hi, kind: 'asinh' };
  }, [frames, show]);

  const current = frames.length ? frames[Math.min(index, frames.length - 1)] : null;

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % frames.length), 1000 / fps);
    return () => window.clearInterval(t);
  }, [playing, fps, frames.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ' && frames.length) { e.preventDefault(); setPlaying((p) => !p); }
      if (e.key === 'ArrowRight') { setPlaying(false); setIndex((i) => (i + 1) % Math.max(1, frames.length)); }
      if (e.key === 'ArrowLeft') { setPlaying(false); setIndex((i) => (i - 1 + frames.length) % Math.max(1, frames.length)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frames.length]);

  const spectrum = useMemo(() => spectrumAt(sky, picked), [sky, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePng = () => {
    const cv = viewerRef.current?.querySelector('canvas');
    if (!cv || !current || !position) return;
    const out = document.createElement('canvas');
    out.width = SKY_VIEW;
    out.height = SKY_VIEW + 64;
    const g = out.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(cv, 0, 0);
    g.fillStyle = '#0b0b0b';
    g.font = '13px Helvetica, Arial, sans-serif';
    [`${position.label} · RA ${formatRa(position.ra)} Dec ${formatDec(position.dec)}`, current.caption, 'NASA SPHEREx data via IRSA · SPHEREx Sky Motion'].forEach((l, i) =>
      g.fillText(l.slice(0, 80), 8, SKY_VIEW + 18 + i * 17)
    );
    out.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `spherex_${position.label.replace(/[^A-Za-z0-9]+/g, '_')}_${current.key}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };

  const toggleDetector = (d: number) => {
    const next = sky.detectors.includes(d) ? sky.detectors.filter((x) => x !== d) : [...sky.detectors, d].sort();
    if (!next.length) return;
    sky.setDetectors(next);
    if (position) void sky.load(position, { fov: sky.fov, detectors: next });
  };

  return (
    <div className="wrap">
      <section className="step" aria-labelledby="s1">
        <div className="n">1</div>
        <div>
          <h2 id="s1">Choose a target</h2>
          <p className="lbl mb-2">Not sure? Start with one of these</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))' }}>
            {TEST_TARGETS.map((t) => (
              <button key={t.id} type="button" className="card" aria-pressed={activeTarget === t.id} onClick={() => onFind(t.label, t)}>
                <b>{t.label}</b>
                <span className="text-[14px]">{t.what}</span>
                <span className="text-[13px] mut">Look for: {t.lookFor}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <span className="lbl">Or type</span>
            <SearchBox onFind={(q) => onFind(q)} />
            <label className="flex items-center gap-2">
              <span className="lbl">Field</span>
              <select className="input" style={{ padding: '7px 8px' }} value={sky.fov} onChange={(e) => { const f = Number(e.target.value); sky.setFov(f); if (position) void sky.load(position, { fov: f, detectors: sky.detectors }); }}>
                {FOVS.map((f) => <option key={f} value={f}>{f}′</option>)}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="step" aria-labelledby="s2">
        <div className="n">2</div>
        <div>
          <h2 id="s2">Play the visits{position ? <span className="mut font-normal"> · {position.label}</span> : null}</h2>
          {!position && <div className="ph">Choose a target above.</div>}
          {position && <div className="mb-3"><LoadStatus sky={sky} /></div>}
          {grid && current && (
            <div className="grid gap-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(240px,1fr)]">
              <div ref={viewerRef}>
                <SkyCanvas
                  grid={grid}
                  data={current.data}
                  flags={current.flags}
                  showFlags={showFlags}
                  stretch={stretch}
                  mjd={current.mjd}
                  label={current.caption}
                  stars={sky.stars}
                  showGaia={showGaia}
                  picked={picked}
                  onPick={setPicked}
                />
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button type="button" className="btn r" onClick={() => setPlaying((p) => !p)} disabled={frames.length < 2}>{playing && frames.length > 1 ? 'Pause' : 'Play'}</button>
                  <button type="button" className="btn" aria-label="Previous" onClick={() => { setPlaying(false); setIndex((i) => (i - 1 + frames.length) % frames.length); }}>‹</button>
                  <button type="button" className="btn" aria-label="Next" onClick={() => { setPlaying(false); setIndex((i) => (i + 1) % frames.length); }}>›</button>
                  <label className="flex items-center gap-2 lbl">
                    Speed <input type="range" min={0.5} max={8} step={0.5} value={fps} onChange={(e) => setFps(Number(e.target.value))} />
                  </label>
                  <button type="button" className="btn ml-auto" onClick={savePng}>Save PNG</button>
                </div>
                <p className="lbl mt-2">{current.caption}</p>
              </div>

              <div className="flex flex-col gap-5">
                <div>
                  <p className="lbl mb-2">Show</p>
                  <div className="flex flex-wrap gap-2">
                    <Pill on={show === 'image'} onClick={() => setShow('image')}>Image</Pill>
                    <Pill on={show === 'diff-median'} onClick={() => setShow('diff-median')} disabled={frames.length < 2}>Change vs. usual sky</Pill>
                    <Pill on={show === 'diff-first'} onClick={() => setShow('diff-first')} disabled={frames.length < 2}>Change since first</Pill>
                  </div>
                </div>
                <div>
                  <p className="lbl mb-2">Frames</p>
                  <div className="flex flex-wrap gap-2">
                    <Pill on={mode === 'visits'} onClick={() => { setMode('visits'); setIndex(0); }}>One per visit ({visits.length})</Pill>
                    <Pill on={mode === 'exposures'} onClick={() => { setMode('exposures'); setIndex(0); }}>Every image ({gridFrames.length})</Pill>
                  </div>
                  {visits.length > 1 && <button type="button" className="mt-2 underline text-[14px] bg-transparent border-0 p-0 cursor-pointer" onClick={onCompare}>Compare two visits side by side →</button>}
                </div>
                <div>
                  <p className="lbl mb-2">Layers</p>
                  <div className="flex flex-wrap gap-2">
                    <Pill on={showGaia} onClick={() => setShowGaia((v) => !v)}>Gaia stars</Pill>
                    <Pill on={sky.maskBad} onClick={() => sky.setMaskBad(!sky.maskBad)}>Hide flagged pixels</Pill>
                    <Pill on={sky.subtractZodi} onClick={() => sky.setSubtractZodi(!sky.subtractZodi)}>Remove zodiacal glow</Pill>
                    <Pill on={showFlags} onClick={() => setShowFlags((v) => !v)} disabled={mode === 'visits'}>Mark flagged in red</Pill>
                  </div>
                  <p className="lbl mt-2 normal-case tracking-normal">{sky.gaiaNote ?? 'Gaia DR3…'}</p>
                </div>
                <div>
                  <p className="lbl mb-2">Detectors <span className="u">(µm)</span></p>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6].map((d) => (
                      <Pill key={d} on={sky.detectors.includes(d)} onClick={() => toggleDetector(d)}>
                        <span title={`${DETECTOR_RANGES[d - 1]} µm`}>D{d}</span>
                      </Pill>
                    ))}
                  </div>
                  <p className="lbl mt-2 normal-case tracking-normal">{sky.detectors.map((d) => `D${d} ${DETECTOR_RANGES[d - 1]}`).join(' · ')}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="step" aria-labelledby="s3" style={{ borderBottom: 0 }}>
        <div className="n">3</div>
        <div>
          <h2 id="s3">Inspect a pixel</h2>
          {!grid && <div className="ph">Click any pixel of the image to see its spectrum.</div>}
          {grid && (
            <div className="grid gap-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(240px,1fr)]">
              <div>
                {picked && <p className="lbl mb-2">RA {formatRa(picked.ra)} · Dec {formatDec(picked.dec)} · one point per image</p>}
                <Spectrum points={spectrum} epochLabels={visits.map((v) => v.label)} />
              </div>
              <div>
                <p className="lbl mb-2">Images in this frame</p>
                <div className="max-h-80 overflow-auto">
                  <table className="t">
                    <thead><tr><th>Date (UTC)</th><th>Det.</th><th><span className="u">µm</span></th><th>File</th></tr></thead>
                    <tbody>
                      {current?.members.map((g, i) => (
                        <tr key={i}>
                          <td>{g.source.dateIso.slice(0, 16).replace('T', ' ')}</td>
                          <td>D{g.source.detector}</td>
                          <td>{g.centerWavelength?.toFixed(3) ?? '—'}</td>
                          <td><a href={irsaFileUrl(g.source.sourceUrl)} target="_blank" rel="noreferrer">IRSA</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
