import { useEffect, useRef, useState } from 'react';
import { applyFree, freeModes, type FreeMode } from '@claudus/core';
import { useTwoD, type Articulation2D } from './store2d';
import type { Solution2D } from './useSolution';

/** Bump and roll sliders. Moving one makes it the articulation shown and graphed. */
export function ArticulationBar2D() {
  const model = useTwoD((s) => s.model);
  const sweep = useTwoD((s) => s.sweep);
  const art = useTwoD((s) => s.art);
  const mode = useTwoD((s) => s.mode);
  const setArt = useTwoD((s) => s.setArt);
  const setMode = useTwoD((s) => s.setMode);
  const [playing, setPlaying] = useState<Articulation2D | null>(null);

  const ranges = {
    bump: { min: -sweep.reboundTravel, max: sweep.bumpTravel, step: 0.5, label: 'Bump / rebound', unit: 'mm', digits: 1 },
    roll: { min: -model.rollTravel, max: model.rollTravel, step: 0.05, label: 'Roll', unit: '°', digits: 2 },
  } as const;

  // Animate one articulation back and forth through its range.
  const t0 = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    t0.current = performance.now();
    const r = ranges[playing];
    const tick = (now: number) => {
      const s = Math.sin(((now - t0.current) / 3000) * 2 * Math.PI);
      setArt({ [playing]: Math.round((s >= 0 ? s * r.max : -s * r.min) / r.step) * r.step });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sweep, model.rollTravel]);

  return (
    <div className="artbar">
      {(['bump', 'roll'] as Articulation2D[]).map((m) => {
        const r = ranges[m];
        return (
          <div key={m} className={`artctl${mode === m ? '' : ' dim'}`}>
            <label>
              {r.label}
              <span className="val">{art[m].toFixed(r.digits)} {r.unit}</span>
            </label>
            <input
              type="range"
              min={r.min}
              max={r.max}
              step={r.step}
              value={art[m]}
              onChange={(e) => { setPlaying(null); setMode(m); setArt({ [m]: Number(e.target.value) }); }}
              onDoubleClick={() => setArt({ [m]: 0 })}
            />
            <button className="icon" title={playing === m ? 'Stop' : `Animate ${r.label.toLowerCase()}`} onClick={() => { setMode(m); setPlaying(playing === m ? null : m); }}>
              {playing === m ? '■' : '▶'}
            </button>
          </div>
        );
      })}
      <button onClick={() => { setPlaying(null); setArt({ bump: 0, roll: 0 }); }}>Static</button>
    </div>
  );
}

export const FREE_LABELS: Record<FreeMode, (strut: boolean) => string> = {
  fixAll: () => 'Fix All',
  upperOuter: (strut) => (strut ? 'Free strut top' : 'Free upper outer'),
  lowerOuter: () => 'Free lower outer',
  upperInner: () => 'Free upper inner',
  lowerInner: () => 'Free lower inner',
};

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

/** The Solve / 2D Fix Option selector, the result of a Free solve, and the live readouts. */
export function Panel2D({ sol, onConvert }: { sol: Solution2D; onConvert: () => void }) {
  const model = useTwoD((s) => s.model);
  const freeMode = useTwoD((s) => s.freeMode);
  const setFreeMode = useTwoD((s) => s.setFreeMode);
  const mode = useTwoD((s) => s.mode);
  const edit = useTwoD((s) => s.edit);
  const strut = model.type === 2;
  const apply = () => {
    if (freeMode === 'fixAll' || !sol.free) return;
    const a = applyFree(model, freeMode, sol.free.point);
    if (freeMode === 'lowerInner') edit({ lowerInner: a.lowerInner });
    else if (freeMode === 'upperInner') edit({ upperInner: a.upperInner });
    else if (freeMode === 'lowerOuter') edit({ lowerOuterZ: a.lowerOuterZ, outerY: a.outerY });
    else edit({ upperOuterZ: a.upperOuterZ, outerY: a.outerY });
    setFreeMode('fixAll');
  };
  const b = sol.bump;
  const r = sol.roll;

  return (
    <div className="readouts">
      <div className="fixbox">
        <label className="muted">Solve / 2D Fix Option</label>
        <select value={freeMode} onChange={(e) => setFreeMode(e.target.value as FreeMode)} data-testid="fix-select">
          {freeModes(model.type).map((m) => <option key={m} value={m}>{FREE_LABELS[m](strut)}</option>)}
        </select>
        {sol.free && (
          <div className="freeinfo">
            <div>Solved position: Y {f(sol.free.point[0])}, Z {f(sol.free.point[1])} mm</div>
            <div className="muted">Misfit to the user lines: {f(sol.free.rms, 3)} (rms){sol.free.converged ? '' : ', not converged'}</div>
            <button className="primary" onClick={apply}>Apply to model</button>
          </div>
        )}
      </div>

      <table>
        <thead><tr><th /><th>{mode === 'bump' ? 'Bump' : 'Roll'}</th><th>Static</th></tr></thead>
        <tbody>
          {mode === 'bump' ? (
            <>
              <Row label="Camber (°)" a={f(b.camber, 3)} s={f(0, 3)} />
              <Row label="RC height (mm)" a={f(b.rcHeight)} s={f(sol.results.rcStatic)} />
              <Row label="Half track change (mm)" a={f(b.halfTrackChange)} s={f(0)} />
              <Row label="Instant centre Y (mm)" a={b.corner.ic ? f(b.corner.ic[0], 1) : 'infinite'} s={sol.rest.corner.ic ? f(sol.rest.corner.ic[0], 1) : 'infinite'} />
              <Row label="Instant centre Z (mm)" a={b.corner.ic ? f(b.corner.ic[1], 1) : 'infinite'} s={sol.rest.corner.ic ? f(sol.rest.corner.ic[1], 1) : 'infinite'} />
            </>
          ) : (
            <>
              <Row label="Camber, right (°)" a={f(r.camber, 3)} s={f(0, 3)} />
              <Row label="Camber, left (°)" a={f(r.camberLeft, 3)} s={f(0, 3)} />
              <Row label="RC height (mm)" a={f(r.rcHeight)} s={f(sol.results.rcStatic)} />
              <Row label="RC lateral (mm)" a={f(r.rcLateral)} s={f(0)} />
            </>
          )}
        </tbody>
      </table>
      <button onClick={onConvert} data-testid="convert-3d">Convert to 3D…</button>
    </div>
  );
}

const Row = ({ label, a, s }: { label: string; a: string; s: string }) => (
  <tr><td>{label}</td><td className="num">{a}</td><td className="num muted">{s}</td></tr>
);
