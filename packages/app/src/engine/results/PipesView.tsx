// Pipe graphical display: pressure, velocity or temperature along each pipe at a crank angle, with slider and animation.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEngine } from '../store';
import { Plot, PALETTE, type PlotSeries } from './Plot';
import { interp } from '@claudus/engine';
import type { PipeTrace, TestPointResult } from '@claudus/engine';

type V = 'p' | 'u' | 'T';
const VARS: Record<V, { label: string; unit: string }> = {
  p: { label: 'Pressure', unit: 'bar' },
  u: { label: 'Velocity', unit: 'm/s' },
  T: { label: 'Temperature', unit: 'K' },
};

interface PipeData { id: number; length: number; x: (a: number) => number[]; y: (a: number) => number[]; range: [number, number] }

function pipeData(pt: TestPointResult, v: V, lengths: Map<number, number>): PipeData[] {
  const out: PipeData[] = [];
  const prof = pt.profiles;
  if (prof) {
    for (const pp of prof.pipes) {
      const arr = v === 'p' ? pp.p : v === 'u' ? pp.u : pp.T;
      const idx = (a: number) => nearestIndex(prof.angle, a);
      let lo = Infinity, hi = -Infinity;
      for (const row of arr) for (const val of row) { if (val < lo) lo = val; if (val > hi) hi = val; }
      out.push({ id: pp.id, length: pp.x[pp.x.length - 1] ?? 0, x: () => pp.x, y: (a) => arr[idx(a)] ?? [], range: pad(lo, hi) });
    }
    return out;
  }
  for (const t of pt.traces.pipes) {
    const L = lengths.get(t.id) ?? 1;
    const get = (loc: 'start' | 'mid' | 'end') => (v === 'p' ? t.pressure[loc] : v === 'u' ? t.velocity[loc] : t.temperature[loc]);
    let lo = Infinity, hi = -Infinity;
    for (const loc of ['start', 'mid', 'end'] as const) for (const val of get(loc)) { if (val < lo) lo = val; if (val > hi) hi = val; }
    out.push({ id: t.id, length: L, x: () => [0, L / 2, L], y: (a) => (['start', 'mid', 'end'] as const).map((loc) => interp(t.angle, get(loc), a)), range: pad(lo, hi) });
  }
  return out;
}

function pad(lo: number, hi: number): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  const m = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  return [lo - m, hi + m];
}

function nearestIndex(a: number[], v: number): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - v) < Math.abs(a[best] - v)) best = i;
  return best;
}

function angleRange(pt: TestPointResult): { min: number; max: number; step: number } {
  const a = pt.profiles?.angle ?? pt.traces.pipes[0]?.angle ?? pt.traces.cylinders[0]?.angle ?? [0, 720];
  return { min: a[0], max: a[a.length - 1], step: a.length > 1 ? (a[a.length - 1] - a[0]) / (a.length - 1) : 1 };
}

export function PipesView() {
  const results = useEngine((s) => s.results);
  const model = useEngine((s) => s.model);
  const [speed, setSpeed] = useState<number | null>(null);
  const [v, setV] = useState<V>('p');
  const [angle, setAngle] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const pt = results?.points.find((p) => p.speed === speed) ?? results?.points[0] ?? null;
  const lengths = useMemo(() => new Map((model?.pipes ?? []).map((p) => [p.id, p.length])), [model]);
  const data = useMemo(() => (pt ? pipeData(pt, v, lengths) : []), [pt, v, lengths]);
  const ar = pt ? angleRange(pt) : { min: 0, max: 720, step: 1 };
  const span = ar.max - ar.min + ar.step;
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setAngle((a) => ar.min + ((a - ar.min + dt * 90 * rate) % span));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, rate, span, ar.min]);

  if (!results || !pt) return <div className="er-empty">No results yet. Run the simulation to see the pipe display.</div>;
  const hasProfiles = !!pt.profiles;
  return (
    <div className="er-view">
      <div className="er-bar">
        <label>Test point <select value={pt.speed} onChange={(e) => setSpeed(Number(e.target.value))}>{results.points.map((p) => <option key={p.speed} value={p.speed}>{Math.round(p.speed)} rpm</option>)}</select></label>
        <label>Variable <select value={v} onChange={(e) => setV(e.target.value as V)}>{(Object.keys(VARS) as V[]).map((k) => <option key={k} value={k}>{VARS[k].label} ({VARS[k].unit})</option>)}</select></label>
        <button onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
        <label>Speed <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>{[0.25, 0.5, 1, 2, 4].map((r) => <option key={r} value={r}>{r}x</option>)}</select></label>
        <label className="er-grow">Crank angle
          <input type="range" min={ar.min} max={ar.max} step={ar.step} value={angle} onChange={(e) => { setPlaying(false); setAngle(Number(e.target.value)); }} />
          <b>{angle.toFixed(1)} deg</b>
        </label>
      </div>
      {!hasProfiles && <div className="er-dim">Full pipe profiles are not available for this run: showing the start, middle and end values only.</div>}
      <div className="er-grid">
        {data.map((d) => {
          const series: PlotSeries[] = [{ label: `Pipe ${d.id}`, x: d.x(angle), y: d.y(angle), color: PALETTE[(d.id - 1) % PALETTE.length], points: !hasProfiles }];
          return <div key={d.id} className="er-card"><Plot series={series} xLabel="Distance along pipe (mm)" yLabel={`${VARS[v].label} (${VARS[v].unit})`} yRange={d.range} xRange={[0, d.length || 1]} height={200} title={`Pipe ${d.id}`} readout={false} /></div>;
        })}
      </div>
      {data.length === 0 && <div className="er-empty">This result has no pipe data.</div>}
    </div>
  );
}

export type { PipeTrace };
