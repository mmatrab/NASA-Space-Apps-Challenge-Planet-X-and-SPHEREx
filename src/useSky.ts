/** Loading and shared state for one patch of sky: image list, cutouts, Gaia, grid, survey visits. */
import { useCallback, useMemo, useRef, useState } from 'react';
import { fetchCutout, gaiaStars, listImages, type GaiaStar, type ImageRecord } from './lib/api.ts';
import { formatDec, formatRa } from './lib/coords.ts';
import { frameFromFits, frameScale, groupEpochs, makeGrid, mjdToIso, stack, toGrid, type GridFrame, type SourceFrame } from './lib/frames.ts';

export const FOVS = [1, 2, 3, 5, 8];
export const DETECTOR_RANGES = ['0.75–1.09', '1.10–1.62', '1.63–2.41', '2.42–3.82', '3.83–4.41', '4.42–5.00'];
const MAX_FRAMES = 300;
const CONCURRENCY = 6;

export interface Position {
  ra: number;
  dec: number;
  label: string;
  source: string;
}

export interface Visit {
  index: number;
  label: string;
  startMjd: number;
  endMjd: number;
  midMjd: number;
  members: GridFrame[];
  data: Float32Array;
  detectors: number[];
}

const fmtDate = (mjd: number) => mjdToIso(mjd).slice(0, 10);
const fmtMonth = (mjd: number) => new Date(mjdToIso(mjd)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function useSky() {
  const [fov, setFov] = useState(3);
  const [detectors, setDetectors] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [subtractZodi, setSubtractZodi] = useState(true);
  const [maskBad, setMaskBad] = useState(true);

  const [position, setPosition] = useState<Position | null>(null);
  const [images, setImages] = useState<ImageRecord[] | null>(null);
  const [searchInfo, setSearchInfo] = useState<string | null>(null);
  const [frames, setFrames] = useState<SourceFrame[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stars, setStars] = useState<GaiaStar[] | null>(null);
  const [gaiaNote, setGaiaNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (pos: Position, opts: { fov: number; detectors: number[]; only?: ImageRecord[] }) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPosition(pos);
    setFrames([]);
    setImages(null);
    setLoadError(null);
    setSearchInfo(null);
    setProgress(null);
    setStars(null);
    setGaiaNote(null);

    const url = new URL(window.location.href);
    url.searchParams.set('ra', pos.ra.toFixed(6));
    url.searchParams.set('dec', pos.dec.toFixed(6));
    url.searchParams.set('fov', String(opts.fov));
    url.searchParams.set('det', opts.detectors.join(','));
    if (pos.label && !pos.label.startsWith('RA ')) url.searchParams.set('name', pos.label);
    else url.searchParams.delete('name');
    window.history.replaceState(null, '', url);

    const sizeDeg = Math.min(0.5, (opts.fov * 1.5) / 60);
    gaiaStars(pos.ra, pos.dec, (opts.fov / 60) * 0.75, ac.signal)
      .then((r) => { setStars(r.stars); setGaiaNote(`${r.count} Gaia DR3 stars`); })
      .catch((e) => { if (!ac.signal.aborted) setGaiaNote(`Gaia DR3 unavailable (${e.message})`); });

    let list: ImageRecord[];
    try {
      if (opts.only) list = opts.only;
      else {
        const r = await listImages(pos.ra, pos.dec, ac.signal);
        list = r.images;
        setSearchInfo(`${r.count} SPHEREx images · ${r.via}`);
      }
    } catch (e) {
      if (!ac.signal.aborted) setLoadError(e instanceof Error ? e.message : String(e));
      return;
    }
    let chosen = list.filter((im) => im.detector === null || opts.detectors.includes(im.detector));
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
          buffer.push(frameFromFits(await fetchCutout(im.path, pos.ra, pos.dec, sizeDeg, ac.signal), im.path));
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
  }, []);

  const go = useCallback((pos: Position, only?: ImageRecord[]) => load(pos, { fov, detectors, only }), [load, fov, detectors]);

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

  /** Six-month survey visits: exposures grouped on gaps > 30 days, averaged for signal-to-noise. */
  const visits: Visit[] = useMemo(() => {
    if (!grid) return [];
    const n = grid.size * grid.size;
    return groupEpochs(gridFrames, (g) => g.source.mjd).map((e, i) => ({
      index: i,
      label: fmtMonth(e.midMjd),
      startMjd: e.startMjd,
      endMjd: e.endMjd,
      midMjd: e.midMjd,
      members: e.items,
      data: stack(e.items.map((g) => g.data), n),
      detectors: [...new Set(e.items.map((g) => g.source.detector))].sort(),
    }));
  }, [gridFrames, grid]);

  const visitOf = useCallback((g: GridFrame) => visits.findIndex((v) => v.members.includes(g)), [visits]);

  return {
    fov, setFov, detectors, setDetectors, subtractZodi, setSubtractZodi, maskBad, setMaskBad,
    position, images, searchInfo, frames, progress, loadError, stars, gaiaNote,
    load, go, grid, gridFrames, visits, visitOf,
    describe: (p: Position) => `RA ${formatRa(p.ra)} · Dec ${formatDec(p.dec)}`,
    visitRange: (v: Visit) => (fmtDate(v.startMjd) === fmtDate(v.endMjd) ? fmtDate(v.startMjd) : `${fmtDate(v.startMjd)} – ${fmtDate(v.endMjd)}`),
  };
}

export type Sky = ReturnType<typeof useSky>;
