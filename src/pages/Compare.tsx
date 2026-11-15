import { useEffect, useMemo, useState } from 'react';
import { formatDec, formatRa } from '../lib/coords.ts';
import { difference } from '../lib/frames.ts';
import { percentiles, symmetricLimit, type Stretch } from '../lib/render.ts';
import { TEST_TARGETS, type Target } from '../lib/targets.ts';
import { SkyCanvas } from '../components/SkyCanvas.tsx';
import { Spectrum } from '../components/Spectrum.tsx';
import type { Sky } from '../useSky.ts';
import { FindStatus, LoadStatus, SearchBox, spectrumAt } from './shared.tsx';
import { fileStem, saveGif } from '../lib/exportMedia.ts';

type View = 'side' | 'blink' | 'diff';

export function Compare({ sky, onFind, finding, findError }: { sky: Sky; onFind: (text: string, target?: Target) => void; finding: string | null; findError: string | null }) {
  const { grid, visits, position } = sky;
  const [a, setA] = useState(0);
  const [b, setB] = useState(1);
  const [view, setView] = useState<View>('side');
  const [blinkOn, setBlinkOn] = useState(false);
  const [showGaia, setShowGaia] = useState(true);
  const [picked, setPicked] = useState<{ ra: number; dec: number } | null>(null);

  useEffect(() => { setA(0); setB(Math.max(0, visits.length - 1)); }, [visits.length]);
  useEffect(() => { setPicked(position ? { ra: position.ra, dec: position.dec } : null); }, [position]);
  useEffect(() => {
    if (view !== 'blink') return;
    const t = window.setInterval(() => setBlinkOn((x) => !x), 700);
    return () => window.clearInterval(t);
  }, [view]);

  const va = visits[Math.min(a, visits.length - 1)];
  const vb = visits[Math.min(b, visits.length - 1)];

  const stretch: Stretch = useMemo(() => {
    if (!va || !vb) return { lo: 0, hi: 1, kind: 'asinh' };
    if (view === 'diff') {
      const L = symmetricLimit([difference(vb.data, va.data)], 99);
      return { lo: -L, hi: L, kind: 'linear' };
    }
    const [lo, hi] = percentiles([va.data, vb.data], 1, 99.7);
    return { lo, hi, kind: 'asinh' };
  }, [va, vb, view]);

  const spectrum = useMemo(() => spectrumAt(sky, picked), [sky, picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const [gifBusy, setGifBusy] = useState(false);
  const [gifNote, setGifNote] = useState<string | null>(null);

  /** Blink GIF: visit A, then visit B, looping, same stretch for both. */
  const onSaveGif = async () => {
    if (!grid || !position || !va || !vb) return;
    setGifBusy(true);
    setGifNote(null);
    try {
      const frame = (v: typeof va, n: number) => ({
        props: { grid, data: v.data, stretch, mjd: v.midMjd, label: `Visit ${n}`, stars: sky.stars, showGaia, picked },
        caption: [
          `${position.label} · RA ${formatRa(position.ra)} Dec ${formatDec(position.dec)} · ${sky.fov}′`,
          `Visit ${n} · ${sky.visitRange(v)} · ${v.members.length} image${v.members.length > 1 ? 's' : ''}`,
          'NASA SPHEREx data via IRSA · SPHEREx Sky Motion',
        ],
      });
      const size = await saveGif([frame(va, a + 1), frame(vb, b + 1)], 700, `${fileStem(position.label)}_visit${a + 1}-${b + 1}`);
      setGifNote(`Blink GIF saved (${(size / 1024).toFixed(0)} KB).`);
    } catch (e) {
      setGifNote(`Could not make the GIF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGifBusy(false);
    }
  };

  const pane = (v: typeof va, label: string) =>
    grid && v ? (
      <figure className="m-0">
        <SkyCanvas grid={grid} data={v.data} stretch={stretch} mjd={v.midMjd} label={`${label}, ${sky.visitRange(v)}`} stars={sky.stars} showGaia={showGaia} picked={picked} onPick={setPicked} />
        <figcaption className="flex justify-between mt-2"><b>{label}</b><span className="lbl">{sky.visitRange(v)}</span></figcaption>
      </figure>
    ) : null;

  const select = (value: number, set: (n: number) => void, id: string) => (
    <select id={id} className="input" style={{ padding: '6px 8px' }} value={value} onChange={(e) => set(Number(e.target.value))}>
      {visits.map((v) => <option key={v.index} value={v.index}>Visit {v.index + 1} · {v.label}</option>)}
    </select>
  );

  return (
    <div>
      <div className="wrap flex flex-wrap items-end gap-6 py-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <div>
          <p className="lbl m-0">Target</p>
          <h1 className="m-0 text-[34px] leading-tight tracking-tight">{position?.label ?? 'No target yet'}</h1>
          {position && <p className="mut m-0">{formatRa(position.ra)} {formatDec(position.dec)} · {sky.fov}′ field</p>}
        </div>
        <div className="ml-auto flex flex-wrap gap-2 items-center">
          {TEST_TARGETS.map((t) => (
            <button key={t.id} type="button" className="pill" onClick={() => onFind(t.label, t)}>{t.label}</button>
          ))}
          <SearchBox compact onFind={(q) => onFind(q)} />
        </div>
      </div>

      <div className="wrap py-6">
        <FindStatus finding={finding} findError={findError} />
        {position && <div className="mb-4"><LoadStatus sky={sky} /></div>}
        {!position && <div className="ph">Pick a target above. Comparing needs two visits of the same spot, six months apart.</div>}
        {grid && visits.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,320px)]">
            <div>
              {visits.length < 2 && <p className="alert mb-4">Only one visit is loaded for this spot, so there is nothing to compare yet.</p>}
              {view === 'side' && <div className="grid grid-cols-2 gap-5">{pane(va, `Visit ${a + 1}`)}{pane(vb, `Visit ${b + 1}`)}</div>}
              {view === 'blink' && <div className="max-w-[560px]">{blinkOn ? pane(vb, `Visit ${b + 1}`) : pane(va, `Visit ${a + 1}`)}</div>}
              {view === 'diff' && grid && va && vb && (
                <figure className="m-0 max-w-[560px]">
                  <SkyCanvas grid={grid} data={difference(vb.data, va.data)} stretch={stretch} mjd={vb.midMjd} label={`Visit ${b + 1} minus visit ${a + 1}`} stars={sky.stars} showGaia={showGaia} picked={picked} onPick={setPicked} />
                  <figcaption className="flex justify-between mt-2"><b>Visit {b + 1} − visit {a + 1}</b><span className="lbl">white: brighter now · black: fainter now</span></figcaption>
                </figure>
              )}
            </div>
            <aside className="flex flex-col gap-6">
              <div>
                <h2 className="text-[17px] m-0 mb-2">Mode</h2>
                <div className="seg">
                  <button type="button" aria-pressed={view === 'side'} onClick={() => setView('side')}>Side by side</button>
                  <button type="button" aria-pressed={view === 'blink'} onClick={() => setView('blink')}>Blink</button>
                  <button type="button" aria-pressed={view === 'diff'} onClick={() => setView('diff')}>Difference</button>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-2 items-center mt-3">
                  <label className="lbl" htmlFor="va">From</label>{select(a, setA, 'va')}
                  <label className="lbl" htmlFor="vb">To</label>{select(b, setB, 'vb')}
                </div>
                <label className="flex gap-2 mt-3 text-[14px]"><input type="checkbox" checked={showGaia} onChange={(e) => setShowGaia(e.target.checked)} /> Gaia stars at each date</label>
                <label className="flex gap-2 mt-1 text-[14px]"><input type="checkbox" checked={sky.maskBad} onChange={(e) => sky.setMaskBad(e.target.checked)} /> Hide flagged pixels</label>
                <button type="button" className="btn k mt-3" onClick={() => void onSaveGif()} disabled={gifBusy}>{gifBusy ? 'Making GIF…' : 'Save blink GIF'}</button>
                {gifNote && <p className="mut text-[13px] mt-1" role="status">{gifNote}</p>}
              </div>
              <div>
                <h2 className="text-[17px] m-0 mb-2">Spectrum</h2>
                <Spectrum points={spectrum} epochLabels={visits.map((v) => v.label)} />
              </div>
              <div>
                <h2 className="text-[17px] m-0 mb-2">Visits</h2>
                <table className="t">
                  <thead><tr><th>Visit</th><th>Dates</th><th>Img.</th><th>Det.</th></tr></thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr key={v.index}><td>{v.index + 1}</td><td>{sky.visitRange(v)}</td><td>{v.members.length}</td><td>{v.detectors.map((d) => `D${d}`).join(' ')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
