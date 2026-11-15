import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCutout, gaiaStars, irsaFileUrl, listImages, resolveName, type GaiaStar, type ImageRecord } from './lib/api.ts';
import { formatDec, formatRa, mjdToJulianYear, parseDec, parseRa, propagate } from './lib/coords.ts';
import { BAD_PIXEL_MASK, flagNames } from './lib/flags.ts';
import {
  difference,
  frameFromFits,
  frameScale,
  gridToSky,
  groupEpochs,
  makeGrid,
  median,
  mjdToIso,
  sampleAt,
  skyToGrid,
  stack,
  toGrid,
  type GridFrame,
  type SourceFrame,
} from './lib/frames.ts';
import { paint, percentiles, symmetricLimit, type Stretch } from './lib/render.ts';
import { ARCHIVE_EXAMPLE, TEST_TARGETS, type Target } from './lib/targets.ts';
import { Spectrum, type SpectrumPoint } from './components/Spectrum.tsx';

const FOVS = [1, 2, 3, 5, 8]; // arcmin
const MAX_FRAMES = 300;
const CONCURRENCY = 6;
const DETECTOR_RANGES = ['0.75–1.09', '1.10–1.62', '1.63–2.41', '2.42–3.82', '3.83–4.41', '4.42–5.00'];

interface Position {
  ra: number;
  dec: number;
  label: string;
  source: string;
}

interface Playable {
  key: string;
  data: Float32Array;
  flags?: Uint32Array;
  midMjd: number;
  title: string;
  detail: string;
  epoch: number;
  members: GridFrame[];
}

type Mode = 'epochs' | 'exposures';
type Display = 'image' | 'diff-median' | 'diff-first';

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const ra = p.get('ra');
  const dec = p.get('dec');
  const det = p.get('det');
  return {
    ra: ra !== null ? parseRa(ra) : null,
    dec: dec !== null ? parseDec(dec) : null,
    name: p.get('name') ?? '',
    fov: FOVS.includes(Number(p.get('fov'))) ? Number(p.get('fov')) : 3,
    detectors: det ? det.split(',').map(Number).filter((d) => d >= 1 && d <= 6) : [1, 2, 3, 4, 5, 6],
    mode: (p.get('mode') === 'exposures' ? 'exposures' : 'epochs') as Mode,
  };
}

const fmtDate = (mjd: number) => mjdToIso(mjd).slice(0, 10);

export function App() {
  const initial = useMemo(readUrl, []);
  const [raText, setRaText] = useState(initial.ra !== null ? formatRa(initial.ra) : '08h55m10.831s');
  const [decText, setDecText] = useState(initial.dec !== null ? formatDec(initial.dec) : '-7d14m42.53s');
  const [nameText, setNameText] = useState(initial.name);
  const [fov, setFov] = useState(initial.fov);
  const [detectors, setDetectors] = useState<number[]>(initial.detectors);
  const [position, setPosition] = useState<Position | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [images, setImages] = useState<ImageRecord[] | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [frames, setFrames] = useState<SourceFrame[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stars, setStars] = useState<GaiaStar[] | null>(null);
  const [gaiaNote, setGaiaNote] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>(initial.mode);
  const [display, setDisplay] = useState<Display>('image');
  const [subtractZodi, setSubtractZodi] = useState(true);
  const [maskBad, setMaskBad] = useState(true);
  const [showGaia, setShowGaia] = useState(true);
  const [showFlags, setShowFlags] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [fps, setFps] = useState(2);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<{ ra: number; dec: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ------------------------------------------------------------------ loading
  const load = useCallback(
    async (pos: Position, fovArcmin: number, dets: number[], only?: ImageRecord[]) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPosition(pos);
      setRaText(formatRa(pos.ra));
      setDecText(formatDec(pos.dec));
      setFrames([]);
      setImages(null);
      setLoadError(null);
      setSearchInfo(null);
      setProgress(null);
      setPicked({ ra: pos.ra, dec: pos.dec });
      setIndex(0);
      setStars(null);
      setGaiaNote(null);

      const url = new URL(window.location.href);
      url.searchParams.set('ra', pos.ra.toFixed(6));
      url.searchParams.set('dec', pos.dec.toFixed(6));
      url.searchParams.set('fov', String(fovArcmin));
      url.searchParams.set('det', dets.join(','));
      if (pos.label && !pos.label.startsWith('RA ')) url.searchParams.set('name', pos.label);
      else url.searchParams.delete('name');
      window.history.replaceState(null, '', url);

      const sizeDeg = Math.min(0.5, (fovArcmin * 1.5) / 60); // a margin so rotated frames still fill the view
      gaiaStars(pos.ra, pos.dec, (fovArcmin / 60) * 0.75, ac.signal)
        .then((r) => { setStars(r.stars); setGaiaNote(`${r.count} Gaia DR3 stars`); })
        .catch((e) => { if (!ac.signal.aborted) setGaiaNote(`Gaia overlay unavailable: ${e.message}`); });

      let list: ImageRecord[];
      try {
        if (only) list = only;
        else {
          const r = await listImages(pos.ra, pos.dec, ac.signal);
          list = r.images;
          setSearchInfo(`${r.count} SPHEREx images cover this position (via ${r.via}, ${r.retrievedAtUtc.slice(0, 16).replace('T', ' ')} UTC)`);
        }
      } catch (e) {
        if (!ac.signal.aborted) setLoadError(e instanceof Error ? e.message : String(e));
        return;
      }
      let chosen = list.filter((im) => im.detector === null || dets.includes(im.detector));
      if (chosen.length > MAX_FRAMES) {
        const step = chosen.length / MAX_FRAMES;
        chosen = Array.from({ length: MAX_FRAMES }, (_, i) => chosen[Math.floor(i * step)]);
      }
      setImages(chosen);
      setProgress({ done: 0, total: chosen.length, failed: 0 });
      let next = 0;
      let failed = 0;
      let done = 0;
      const buffer: SourceFrame[] = [];
      const flush = () => { const add = buffer.splice(0); if (add.length) setFrames((f) => [...f, ...add]); };
      const timer = window.setInterval(flush, 400);
      const worker = async () => {
        while (next < chosen.length && !ac.signal.aborted) {
          const im = chosen[next++];
          try {
            const buf = await fetchCutout(im.path, pos.ra, pos.dec, sizeDeg, ac.signal);
            buffer.push(frameFromFits(buf, im.path));
          } catch {
            if (!ac.signal.aborted) failed++;
          }
          done++;
          setProgress({ done, total: chosen.length, failed });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      window.clearInterval(timer);
      if (!ac.signal.aborted) flush();
    },
    []
  );

  const goCoords = (e?: React.FormEvent) => {
    e?.preventDefault();
    const ra = parseRa(raText);
    const dec = parseDec(decText);
    if (ra === null || dec === null) {
      setFormError('Enter RA as 08h55m10.8s, 08:55:10.8 or degrees (0–360), and Dec as −7d14m42s, −07:14:42 or degrees (−90 to 90).');
      return;
    }
    setFormError(null);
    void load({ ra, dec, label: `RA ${formatRa(ra)} Dec ${formatDec(dec)}`, source: 'coordinates entered' }, fov, detectors);
  };

  const goName = async (name: string, preset?: Target) => {
    setFormError(null);
    if (preset?.ra !== undefined && preset.dec !== undefined) {
      setRaText(formatRa(preset.ra));
      setDecText(formatDec(preset.dec));
      void load({ ra: preset.ra, dec: preset.dec, label: preset.label, source: preset.coordsSource ?? '' }, fov, detectors);
      return;
    }
    try {
      const r = await resolveName(preset?.resolve ?? name);
      setRaText(formatRa(r.ra));
      setDecText(formatDec(r.dec));
      void load({ ra: r.ra, dec: r.dec, label: preset?.label ?? name, source: `${r.source}${r.name ? `: ${r.name}` : ''}` }, fov, detectors);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  };

  // Start from the URL (embeddable links), otherwise from WISE 0855.
  useEffect(() => {
    if (initial.ra !== null && initial.dec !== null) {
      void load({ ra: initial.ra, dec: initial.dec, label: initial.name || `RA ${formatRa(initial.ra)} Dec ${formatDec(initial.dec)}`, source: 'link' }, initial.fov, initial.detectors);
    }
    return () => abortRef.current?.abort();
  }, [initial, load]);

  // ------------------------------------------------------------------ derived frames
  const grid = useMemo(() => {
    if (!position || !frames.length) return null;
    return makeGrid(position.ra, position.dec, fov, frameScale(frames[0]));
  }, [position, frames.length > 0, fov]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridFrames = useMemo(() => {
    if (!grid) return [];
    return frames
      .map((f) => toGrid(f, grid, { subtractZodi, maskBad }))
      .filter((g) => g.coverage > 0.05)
      .sort((a, b) => a.source.mjd - b.source.mjd);
  }, [frames, grid, subtractZodi, maskBad]);

  const epochs = useMemo(() => groupEpochs(gridFrames, (g) => g.source.mjd), [gridFrames]);
  const epochOf = useCallback(
    (g: GridFrame) => epochs.findIndex((e) => e.items.includes(g)),
    [epochs]
  );
  const epochLabels = epochs.map((e) => (fmtDate(e.startMjd) === fmtDate(e.endMjd) ? fmtDate(e.startMjd) : `${fmtDate(e.startMjd)} → ${fmtDate(e.endMjd)}`));

  const playable: Playable[] = useMemo(() => {
    if (!grid) return [];
    const n = grid.size * grid.size;
    let base: Playable[];
    if (mode === 'epochs') {
      base = epochs.map((e, i) => {
        const dets = [...new Set(e.items.map((g) => g.source.detector))].sort();
        return {
          key: `e${i}`,
          data: stack(e.items.map((g) => g.data), n),
          midMjd: e.midMjd,
          title: `Epoch ${i + 1} · ${epochLabels[i]}`,
          detail: `Average of ${e.items.length} exposure${e.items.length > 1 ? 's' : ''} · detectors ${dets.map((d) => `D${d}`).join(', ')}`,
          epoch: i,
          members: e.items,
        };
      });
    } else {
      base = gridFrames.map((g, i) => ({
        key: `x${i}`,
        data: g.data,
        flags: g.flags,
        midMjd: g.source.mjd,
        title: `${g.source.dateIso.slice(0, 19).replace('T', ' ')} UTC`,
        detail: `Detector D${g.source.detector}${g.centerWavelength ? ` · ${g.centerWavelength.toFixed(3)} µm at centre` : ''} · ${g.source.obsId}`,
        epoch: epochOf(g),
        members: [g],
      }));
    }
    if (display === 'image' || base.length < 2) return base;
    const ref = display === 'diff-median' ? median(base.map((b) => b.data), n) : base[0].data;
    return base.map((b) => ({ ...b, data: difference(b.data, ref) }));
  }, [grid, mode, display, epochs, gridFrames, epochOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const stretch: Stretch = useMemo(() => {
    const arrays = playable.map((p) => p.data);
    if (display !== 'image' && playable.length > 1) {
      const L = symmetricLimit(arrays, 99);
      return { lo: -L, hi: L, kind: 'linear' };
    }
    const [lo, hi] = percentiles(arrays, 1, 99.7);
    return { lo, hi, kind: 'asinh' };
  }, [playable, display]);

  const current = playable.length ? playable[Math.min(index, playable.length - 1)] : null;

  // ------------------------------------------------------------------ playback
  useEffect(() => {
    if (!playing || playable.length < 2) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % playable.length), 1000 / fps);
    return () => window.clearInterval(t);
  }, [playing, fps, playable.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      if (e.key === 'ArrowRight') { setPlaying(false); setIndex((i) => (i + 1) % Math.max(1, playable.length)); }
      if (e.key === 'ArrowLeft') { setPlaying(false); setIndex((i) => (i - 1 + playable.length) % Math.max(1, playable.length)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playable.length]);

  // ------------------------------------------------------------------ drawing
  const VIEW = 512;
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !grid || !current) return;
    const ctx = cv.getContext('2d')!;
    const off = document.createElement('canvas');
    off.width = grid.size;
    off.height = grid.size;
    off.getContext('2d')!.putImageData(
      paint(current.data, grid.size, stretch, { flags: showFlags ? current.flags : undefined, flagMask: BAD_PIXEL_MASK }),
      0,
      0
    );
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.drawImage(off, 0, 0, VIEW, VIEW);
    const k = VIEW / grid.size;
    const toCanvas = (ra: number, dec: number) => {
      const [i, j] = skyToGrid(grid, ra, dec);
      return [(i + 0.5) * k, (j + 0.5) * k];
    };
    // Gaia DR3 stars moved to this frame's date along their proper motion.
    if (showGaia && stars) {
      const year = mjdToJulianYear(current.midMjd);
      ctx.lineWidth = 1.5;
      for (const s of stars) {
        const p = s.pmra !== null && s.pmdec !== null ? propagate(s.ra, s.dec, s.pmra, s.pmdec, s.refEpoch, year) : { ra: s.ra, dec: s.dec };
        const [x, y] = toCanvas(p.ra, p.dec);
        if (x < -10 || y < -10 || x > VIEW + 10 || y > VIEW + 10) continue;
        const fast = s.pmra !== null && s.pmdec !== null && Math.hypot(s.pmra, s.pmdec) > 500;
        ctx.strokeStyle = fast ? '#f2b84b' : 'rgba(124,196,255,0.75)';
        ctx.beginPath();
        ctx.arc(x, y, fast ? 10 : 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Target crosshair.
    const [cx, cy] = toCanvas(grid.ra, grid.dec);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * 14, cy + dy * 14);
      ctx.lineTo(cx + dx * 26, cy + dy * 26);
      ctx.stroke();
    }
    if (picked) {
      const [px, py] = toCanvas(picked.ra, picked.dec);
      ctx.strokeStyle = '#ff6b9a';
      ctx.lineWidth = 2;
      ctx.strokeRect(px - k / 2 - 2, py - k / 2 - 2, k + 4, k + 4);
    }
    // Scale bar: 1 arcminute.
    const bar = (60 / grid.scaleArcsec) * k;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(12, VIEW - 18, bar, 3);
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.fillText("1′", 12, VIEW - 24);
    ctx.fillText('N ↑  E ←', VIEW - 78, VIEW - 12);
  }, [current, grid, stretch, showGaia, stars, picked, showFlags]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!grid) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width) * grid.size);
    const j = Math.floor(((e.clientY - r.top) / r.height) * grid.size);
    const [ra, dec] = gridToSky(grid, i, j);
    setPicked({ ra, dec });
  };

  const spectrum: SpectrumPoint[] = useMemo(() => {
    if (!picked) return [];
    const out: SpectrumPoint[] = [];
    for (const g of gridFrames) {
      const s = sampleAt(g.source, picked.ra, picked.dec, { subtractZodi, maskBad });
      if (!s || s.wavelength === null) continue;
      out.push({
        wavelength: s.wavelength,
        bandwidth: s.bandwidth,
        value: s.value,
        error: s.error,
        epoch: epochOf(g),
        detector: g.source.detector,
        dateIso: g.source.dateIso,
        flags: flagNames(s.flags),
      });
    }
    return out;
  }, [picked, gridFrames, subtractZodi, maskBad, epochOf]);

  const exportPng = () => {
    const cv = canvasRef.current;
    if (!cv || !current || !position) return;
    const out = document.createElement('canvas');
    out.width = VIEW;
    out.height = VIEW + 84;
    const g = out.getContext('2d')!;
    g.fillStyle = '#0b1020';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(cv, 0, 0);
    g.fillStyle = '#e7ecf6';
    g.font = '13px ui-monospace, monospace';
    const lines = [
      `${position.label} · RA ${formatRa(position.ra)} Dec ${formatDec(position.dec)} · ${fov}′ field`,
      `${current.title} · ${current.detail}`.slice(0, 88),
      `Display: ${display === 'image' ? 'image' : display === 'diff-median' ? 'difference from median sky' : 'difference from first frame'}${subtractZodi ? ', zodiacal light subtracted' : ''}`,
      'Data: NASA SPHEREx (Caltech/IPAC), via IRSA. Made with SPHEREx Sky Motion.',
    ];
    lines.forEach((l, i) => g.fillText(l, 8, VIEW + 18 + i * 18));
    out.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `spherex_${position.label.replace(/[^A-Za-z0-9]+/g, '_')}_${current.key}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };

  const shareLink = typeof window !== 'undefined' ? window.location.href : '';
  const loading = progress !== null && progress.done < progress.total;

  // ------------------------------------------------------------------ UI
  return (
    <div className="max-w-[1280px] mx-auto px-4 py-5">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">SPHEREx Sky Motion</h1>
        <p className="text-[15px]" style={{ color: 'var(--muted)' }}>
          Pick a patch of sky and watch NASA SPHEREx images of it, one after another, to spot what moves or changes.
          SPHEREx maps the whole sky every six months in 102 near-infrared colours.
        </p>
      </header>

      <section className="panel p-4 mb-4" aria-label="Choose a patch of sky">
        <form onSubmit={goCoords} className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] items-end">
          <label className="block">
            <span className="label">Right ascension (RA)</span>
            <input className="input font-mono" value={raText} onChange={(e) => setRaText(e.target.value)} placeholder="08h55m10.831s or 133.795" />
          </label>
          <label className="block">
            <span className="label">Declination (Dec)</span>
            <input className="input font-mono" value={decText} onChange={(e) => setDecText(e.target.value)} placeholder="-7d14m42.53s or -7.245" />
          </label>
          <label className="block">
            <span className="label">Field of view</span>
            <select className="input" value={fov} onChange={(e) => setFov(Number(e.target.value))}>
              {FOVS.map((f) => <option key={f} value={f}>{f} arcmin</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-primary h-[38px]">Show this patch</button>
        </form>
        <form
          className="mt-3 flex flex-wrap gap-2 items-end"
          onSubmit={(e) => { e.preventDefault(); if (nameText.trim()) void goName(nameText.trim()); }}
        >
          <label className="block grow max-w-sm">
            <span className="label">…or an object name (resolved by CDS Sesame)</span>
            <input className="input" value={nameText} onChange={(e) => setNameText(e.target.value)} placeholder="e.g. Barnard's Star, R Dra" />
          </label>
          <button type="submit" className="btn h-[38px]">Find</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <span className="label">Challenge test targets:</span>
          {TEST_TARGETS.map((t) => (
            <button key={t.id} type="button" className="btn" title={t.why} onClick={() => void goName(t.label, t)}>{t.label}</button>
          ))}
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-3 items-center">
          <legend className="label mb-1">Detectors (each sees a range of wavelengths, µm)</legend>
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <label key={d} className="inline-flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={detectors.includes(d)} onChange={(e) => setDetectors((s) => (e.target.checked ? [...s, d].sort() : s.filter((x) => x !== d)))} />
              D{d} <span className="label">{DETECTOR_RANGES[d - 1]}</span>
            </label>
          ))}
        </fieldset>
        {formError && <p role="alert" className="mt-2 text-[13px]" style={{ color: 'var(--warn)' }}>{formError}</p>}
      </section>

      {position && (
        <p className="mb-3 text-[13px]" style={{ color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--ink)' }}>{position.label}</strong> · RA {formatRa(position.ra)} · Dec {formatDec(position.dec)}
          {position.source && ` · position from ${position.source}`}
          {searchInfo && ` · ${searchInfo}`}
        </p>
      )}

      {loadError && (
        <div role="alert" className="panel p-4 mb-4" style={{ borderColor: '#7a5a1c' }}>
          <p><strong>We could not list SPHEREx images for this position.</strong> {loadError}</p>
          <p className="mt-1 label">
            The image list comes from NASA/IPAC's IRSA archive. If its search service is down, nothing is shown in its place.
            You can retry, or open the one example image printed in the SPHEREx archive guide to try the viewer.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn" onClick={() => position && void load(position, fov, detectors)}>Retry</button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void load(
                  { ra: ARCHIVE_EXAMPLE.ra, dec: ARCHIVE_EXAMPLE.dec, label: ARCHIVE_EXAMPLE.label, source: 'SPHEREx archive user guide' },
                  fov,
                  detectors,
                  [{ path: ARCHIVE_EXAMPLE.path, obsId: null, detector: 1, mjd: null, bandpass: null, release: 'qr3', version: 27 }]
                )
              }
            >
              Open the archive's example image
            </button>
          </div>
        </div>
      )}

      {progress && (
        <div className="mb-3" aria-live="polite">
          <div className="h-1.5 rounded" style={{ background: 'var(--line)' }}>
            <div className="h-1.5 rounded" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%`, background: 'var(--accent)' }} />
          </div>
          <p className="label mt-1">
            {loading ? 'Downloading' : 'Downloaded'} {progress.done} of {progress.total} cutouts from IRSA
            {progress.failed ? ` · ${progress.failed} could not be fetched` : ''}
            {images && images.length === MAX_FRAMES ? ` · showing ${MAX_FRAMES} spread over time` : ''}
          </p>
        </div>
      )}

      {position && !loadError && progress && progress.total === 0 && (
        <div className="panel p-4 mb-4">No SPHEREx image covers this position with the selected detectors yet.</div>
      )}

      {grid && current && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
          <section className="panel p-3" aria-label="Sky player">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <h2 className="font-semibold">{current.title}</h2>
              <span className="label">{Math.min(index, playable.length - 1) + 1} / {playable.length}</span>
            </div>
            <p className="label mb-2">{current.detail}</p>
            <canvas
              ref={canvasRef}
              width={VIEW}
              height={VIEW}
              onClick={onCanvasClick}
              className="pixelated w-full h-auto rounded cursor-crosshair"
              aria-label={`SPHEREx image, ${current.title}. Click a pixel to see its spectrum.`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="btn" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
              <button type="button" className="btn" onClick={() => { setPlaying(false); setIndex((i) => (i - 1 + playable.length) % playable.length); }} aria-label="Previous frame">◀</button>
              <button type="button" className="btn" onClick={() => { setPlaying(false); setIndex((i) => (i + 1) % playable.length); }} aria-label="Next frame">▶</button>
              <label className="inline-flex items-center gap-2 text-[13px]">
                Speed
                <input type="range" min={0.5} max={10} step={0.5} value={fps} onChange={(e) => setFps(Number(e.target.value))} />
                <span className="label w-14">{fps} fps</span>
              </label>
              <button type="button" className="btn ml-auto" onClick={exportPng}>Save frame (PNG)</button>
            </div>
            <input
              type="range"
              className="w-full mt-2"
              min={0}
              max={Math.max(0, playable.length - 1)}
              value={Math.min(index, playable.length - 1)}
              onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }}
              aria-label="Frame"
            />
            <p className="label mt-1">Space: play/pause · ← →: step · click the image: spectrum of that pixel. Pixels are 6.2″ wide.</p>
          </section>

          <section className="flex flex-col gap-4">
            <div className="panel p-3">
              <h2 className="font-semibold mb-2">How to look</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <fieldset>
                  <legend className="label mb-1">Play</legend>
                  <label className="flex gap-2 text-[13px]"><input type="radio" checked={mode === 'epochs'} onChange={() => { setMode('epochs'); setIndex(0); }} /> One frame per sky survey (every ~6 months) — best for motion</label>
                  <label className="flex gap-2 text-[13px]"><input type="radio" checked={mode === 'exposures'} onChange={() => { setMode('exposures'); setIndex(0); }} /> Every exposure, in time order</label>
                </fieldset>
                <fieldset>
                  <legend className="label mb-1">Show</legend>
                  <label className="flex gap-2 text-[13px]"><input type="radio" checked={display === 'image'} onChange={() => setDisplay('image')} /> The images</label>
                  <label className="flex gap-2 text-[13px]"><input type="radio" checked={display === 'diff-median'} onChange={() => setDisplay('diff-median')} /> What differs from the usual sky (minus median)</label>
                  <label className="flex gap-2 text-[13px]"><input type="radio" checked={display === 'diff-first'} onChange={() => setDisplay('diff-first')} /> What changed since the first frame</label>
                </fieldset>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <label className="inline-flex gap-2"><input type="checkbox" checked={subtractZodi} onChange={(e) => setSubtractZodi(e.target.checked)} /> Remove zodiacal glow (archive model)</label>
                <label className="inline-flex gap-2"><input type="checkbox" checked={maskBad} onChange={(e) => setMaskBad(e.target.checked)} /> Hide flagged pixels</label>
                <label className="inline-flex gap-2"><input type="checkbox" checked={showGaia} onChange={(e) => setShowGaia(e.target.checked)} /> Gaia DR3 stars at this date</label>
                <label className="inline-flex gap-2"><input type="checkbox" checked={showFlags} onChange={(e) => setShowFlags(e.target.checked)} disabled={mode === 'epochs'} /> Tint flagged pixels red (per exposure)</label>
              </div>
              <p className="label mt-2">
                {gaiaNote ?? 'Loading Gaia DR3…'} — blue circles: stars where Gaia predicts them on this frame's date; gold: stars moving faster than 0.5″ per year.
                Dark blue pixels: no data. In difference mode, dark = fainter, white = brighter.
              </p>
              {mode === 'epochs' && (
                <p className="label mt-1">
                  Each survey frame averages the exposures of that visit across the chosen detectors, to beat the noise; their colours (wavelengths) differ,
                  so compare a single detector for colour-sensitive work.
                </p>
              )}
            </div>

            <div className="panel p-3">
              <h2 className="font-semibold">Spectrum on the fly</h2>
              {picked && (
                <p className="label mb-2">
                  Pixel at RA {formatRa(picked.ra)} Dec {formatDec(picked.dec)}: one point per exposure. SPHEREx sees a different wavelength at each place on its
                  detectors, so the many exposures together build a spectrum. Colours are survey epochs: if they disagree, the source changed.
                </p>
              )}
              <Spectrum points={spectrum} epochLabels={epochLabels} />
            </div>
          </section>
        </div>
      )}

      {grid && current && (
        <details className="panel p-3 mt-4">
          <summary className="cursor-pointer font-semibold">Frame details and sources ({current.members.length} exposure{current.members.length > 1 ? 's' : ''} in this frame)</summary>
          <div className="overflow-auto max-h-80 mt-2">
            <table className="w-full text-xs tabular-nums">
              <thead><tr className="text-left label"><th className="p-1">Date (UTC)</th><th className="p-1">Det.</th><th className="p-1">λ centre (µm)</th><th className="p-1">Observation</th><th className="p-1">Exposure</th><th className="p-1">Quality</th><th className="p-1">Pipeline</th><th className="p-1">File at IRSA</th></tr></thead>
              <tbody>
                {current.members.map((g, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="p-1">{g.source.dateIso.slice(0, 19).replace('T', ' ')}</td>
                    <td className="p-1">D{g.source.detector}</td>
                    <td className="p-1">{g.centerWavelength?.toFixed(4) ?? '—'}</td>
                    <td className="p-1">{g.source.obsId}</td>
                    <td className="p-1">{g.source.exposureS ? `${g.source.exposureS.toFixed(0)} s` : '—'}</td>
                    <td className="p-1">{g.source.dqa ?? '—'}</td>
                    <td className="p-1">{g.source.pipelineVersion ?? '—'}</td>
                    <td className="p-1"><a className="underline" style={{ color: 'var(--accent)' }} href={irsaFileUrl(g.source.sourceUrl)} target="_blank" rel="noreferrer">full image</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="label mt-2">
            Share or embed this view: <code className="break-all">{shareLink}</code>
          </p>
        </details>
      )}

      <footer className="mt-6 label">
        Data: NASA SPHEREx (Caltech/IPAC), served by NASA/IPAC Infrared Science Archive (IRSA); Gaia DR3 (ESA); names resolved by CDS Sesame.
        Units: MJy/sr. Flags per SPHEREx Explanatory Supplement, Table 16. This tool shows archive data as it is; it does not claim discoveries.
      </footer>
    </div>
  );
}
