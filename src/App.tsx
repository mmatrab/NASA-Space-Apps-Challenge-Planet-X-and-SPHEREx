import { useEffect, useState } from 'react';
import { formatDec, formatRa, parseDec, parseRa } from './lib/coords.ts';
import type { Target } from './lib/targets.ts';
import { useSky, FOVS } from './useSky.ts';
import { Explore } from './pages/Explore.tsx';
import { Compare } from './pages/Compare.tsx';
import { About } from './pages/About.tsx';
import { findPosition } from './pages/shared.tsx';

type Tab = 'explore' | 'compare' | 'about';
const TABS: [Tab, string][] = [['explore', 'Explore'], ['compare', 'Compare'], ['about', 'About the data']];

export function App() {
  const sky = useSky();
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'compare' || t === 'about' ? t : 'explore';
  });
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [findError, setFindError] = useState<string | null>(null);

  const changeTab = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === 'explore') url.searchParams.delete('tab');
    else url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0 });
  };

  const onFind = async (text: string, target?: Target) => {
    setFindError(null);
    setActiveTarget(target?.id ?? null);
    try {
      void sky.go(await findPosition(text, target));
    } catch (e) {
      setFindError(e instanceof Error ? e.message : String(e));
    }
  };

  // Links with ?ra=&dec=&fov=&det= open that patch directly (embeddable).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ra = parseRa(p.get('ra') ?? '');
    const dec = parseDec(p.get('dec') ?? '');
    if (ra === null || dec === null) return;
    const fov = FOVS.includes(Number(p.get('fov'))) ? Number(p.get('fov')) : 3;
    const det = (p.get('det') ?? '1,2,3,4,5,6').split(',').map(Number).filter((d) => d >= 1 && d <= 6);
    sky.setFov(fov);
    sky.setDetectors(det.length ? det : [1, 2, 3, 4, 5, 6]);
    void sky.load(
      { ra, dec, label: p.get('name') || `RA ${formatRa(ra)} Dec ${formatDec(dec)}`, source: 'link' },
      { fov, detectors: det.length ? det : [1, 2, 3, 4, 5, 6] }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header className="bar">
        <span className="brand">SPHEREx Sky Motion</span>
        <nav aria-label="Sections">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => changeTab(id)}>{label}</button>
          ))}
        </nav>
      </header>
      {findError && (
        <div className="wrap pt-4"><p className="alert" role="alert">{findError}</p></div>
      )}
      <main>
        {tab === 'explore' && <Explore sky={sky} onFind={onFind} onCompare={() => changeTab('compare')} activeTarget={activeTarget} />}
        {tab === 'compare' && <Compare sky={sky} onFind={onFind} />}
        {tab === 'about' && <About />}
      </main>
      <footer className="wrap py-8 mut text-[13px]" style={{ borderTop: '1px solid var(--line)' }}>
        NASA SPHEREx data via IRSA (Caltech/IPAC) · Gaia DR3 (ESA) · CDS Sesame · NASA Space Apps 2026
      </footer>
    </>
  );
}
