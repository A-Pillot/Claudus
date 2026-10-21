import { useEffect, useMemo, useRef, useState } from 'react';
import { forcedSweep, type AxleState, type Corner, type ForcedResponse, type ModalResult } from '@claudus/core';
import { useApp } from '../store';
import { useLab, type DisplayMode } from '../lab';
import { useEffectiveCompliance } from '../derived';
import { NumberCell } from './PointTable';
import { Panel } from './Panel';

/** A rounded set of tick values covering a range. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
const short = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 0.1 ? v.toFixed(2) : v.toPrecision(2));

/* ---------- display mode selector over the 3D view ---------- */

const MODES: [DisplayMode, string][] = [
  ['articulation', 'Displacement (normal)'],
  ['deformed', 'Deformed geometry'],
  ['mode', 'Mode shape'],
  ['forced', 'Forced-damped'],
];

/** View / Set Display Mode: what the 3D view draws in compliant mode, with its scalar and an Animate switch. */
export function DisplayModeBar({ modal }: { modal?: ModalResult }) {
  const compliant = useApp((s) => s.compliant);
  const d = useLab((s) => s.display);
  const set = useLab((s) => s.setDisplay);
  if (!compliant) return null;
  const nModes = modal?.modes.length ?? 0;
  return (
    <div className="displaybar" data-testid="display-mode">
      <label>View
        <select aria-label="Display mode" value={d.mode} onChange={(e) => set({ mode: e.target.value as DisplayMode })}>
          {MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </select>
      </label>
      {d.mode === 'deformed' && <label>Scalar <NumberCell value={d.deformScalar} onCommit={(v) => set({ deformScalar: Math.max(0, v) })} /></label>}
      {d.mode === 'mode' && (
        <>
          <label>Mode no. <input type="number" aria-label="Mode number" min={1} max={nModes || undefined} value={d.modeNo} onChange={(e) => set({ modeNo: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></label>
          <label>Scalar <NumberCell value={d.modeScalar} onCommit={(v) => set({ modeScalar: Math.max(0, v) })} /></label>
        </>
      )}
      {d.mode === 'forced' && (
        <>
          <label>Frequency
            <input type="range" aria-label="Frequency" min={0} max={1000} step={0.5} value={d.forcedHz} onChange={(e) => set({ forcedHz: Number(e.target.value) })} />
            <NumberCell value={d.forcedHz} digits={2} onCommit={(v) => set({ forcedHz: Math.min(1000, Math.max(0, v)) })} /> Hz
          </label>
          <label>Scalar <NumberCell value={d.forcedScalar} onCommit={(v) => set({ forcedScalar: Math.max(0, v) })} /></label>
        </>
      )}
      <label className="inl"><input type="checkbox" checked={d.animate} disabled={d.mode === 'articulation'} onChange={(e) => set({ animate: e.target.checked })} /> Animate</label>
    </div>
  );
}

/* ---------- modal frequencies bar chart ---------- */

export function ModalPanel({ modal }: { modal?: ModalResult }) {
  const on = useLab((s) => s.panels.modal);
  const compliant = useApp((s) => s.compliant);
  const setPanel = useLab((s) => s.setPanel);
  if (!on) return null;
  return (
    <Panel title="Modal frequencies" width={560} x={Math.max(8, window.innerWidth - 620)} y={96} onClose={() => setPanel('modal', false)} testId="modal-panel">
      {!compliant ? <p className="muted">Switch on 3D Compliance to run a modal analysis.</p> : !modal ? <p className="muted">Calculating…</p> : <ModalChart modal={modal} />}
    </Panel>
  );
}

function ModalChart({ modal }: { modal: ModalResult }) {
  const d = useLab((s) => s.display);
  const set = useLab((s) => s.setDisplay);
  const freqs = modal.modes.map((m) => m.frequency);
  const selected = Math.min(Math.max(1, Math.round(d.modeNo)), freqs.length);
  const W = 520;
  const H = 280;
  const L = 52;
  const B = 26;
  const T = 10;
  const positive = freqs.filter((f) => f > 0);
  const hi = Math.max(1, ...freqs);
  const lo = positive.length ? Math.min(...positive) : 1;
  // Log axis in whole decades; modes at (or near) zero Hz sit on the floor.
  const yMin = 10 ** Math.floor(Math.log10(Math.max(1e-3, lo)) - 0.0001);
  const yMax = 10 ** Math.ceil(Math.log10(hi) + 0.0001);
  const lg = (v: number) => Math.log10(Math.max(v, yMin));
  const y = (v: number) => T + (1 - (lg(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * (H - T - B);
  const bw = (W - L - 8) / freqs.length;
  const decades: number[] = [];
  for (let e = Math.log10(yMin); e <= Math.log10(yMax) + 1e-9; e++) decades.push(10 ** Math.round(e));
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Modal frequencies" data-testid="modal-chart">
        {decades.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - 4} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{v >= 1 ? v : v.toPrecision(1)}</text>
          </g>
        ))}
        {freqs.map((f, i) => {
          const x = L + i * bw;
          const top = y(f);
          const isSel = i + 1 === selected;
          return (
            <g key={i} className="bar" data-testid={`mode-bar-${i + 1}`} onClick={() => set({ modeNo: i + 1, mode: 'mode' })} style={{ cursor: 'pointer' }}>
              <title>{`Mode ${i + 1}: ${f.toFixed(2)} Hz`}</title>
              <rect x={x} y={T} width={bw} height={H - T - B} fill="transparent" />
              <rect x={x + bw * 0.12} y={top} width={bw * 0.76} height={Math.max(1, H - B - top)} fill={isSel ? '#22d3ee' : '#4e79a7'} />
              {(freqs.length <= 24 || isSel || (i + 1) % 5 === 0) && <text x={x + bw / 2} y={H - B + 12} textAnchor="middle" fontSize="9" fill={isSel ? '#22d3ee' : 'var(--muted)'}>{i + 1}</text>}
            </g>
          );
        })}
        <text x={(W + L) / 2} y={H - 2} textAnchor="middle" fontSize="10" fill="var(--muted)">Mode number (click a bar to display it); frequency in Hz, log scale</text>
      </svg>
      <div className="small" data-testid="modal-selected">Mode <b>{selected}</b>: <b>{freqs[selected - 1]?.toFixed(2)} Hz</b>{d.mode !== 'mode' && <span className="muted"> (switch View to Mode shape to see it)</span>}</div>
    </>
  );
}

/* ---------- forced-damped speed sweep ---------- */

const COMPONENTS = ['X translation (mm)', 'Y translation (mm)', 'Z translation (mm)', 'X rotation (deg)', 'Y rotation (deg)', 'Z rotation (deg)'];
const COLOURS = ['#4e9fe5', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#edc948', '#76b7b2', '#ff9da7', '#9c755f'];
const SWEEP_POINTS = 250;

export function SweepPanel({ corner, state }: { corner?: Corner; state?: AxleState }) {
  const on = useLab((s) => s.panels.sweep);
  const compliant = useApp((s) => s.compliant);
  const setPanel = useLab((s) => s.setPanel);
  if (!on) return null;
  return (
    <Panel title="Forced-damped speed sweep" width={640} x={Math.max(8, window.innerWidth - 700)} y={150} onClose={() => setPanel('sweep', false)} testId="sweep-panel">
      {!compliant || !corner || !state ? <p className="muted">Switch on 3D Compliance to see the forced response.</p> : <SweepBody corner={corner} state={state} />}
    </Panel>
  );
}

function SweepBody({ corner, state }: { corner: Corner; state: AxleState }) {
  const comp = useEffectiveCompliance();
  const d = useLab((s) => s.display);
  const set = useLab((s) => s.setDisplay);
  const [fmax, setFmax] = useState(200);
  const [component, setComponent] = useState(2);
  const [sweep, setSweep] = useState<{ freqs: number[]; rows: ForcedResponse[]; fmax: number } | null>(null);
  const [error, setError] = useState('');
  // The latest inputs, so Refresh and the first calculation use what is on screen now.
  const latest = useRef({ corner, state, comp, fmax });
  latest.current = { corner, state, comp, fmax };

  const refresh = () => {
    setSweep(null);
    setError('');
    // Let the "Calculating" state paint before the work starts.
    setTimeout(() => {
      const { corner: c, state: s, comp: cd, fmax: fm } = latest.current;
      try {
        const freqs = Array.from({ length: SWEEP_POINTS + 1 }, (_, i) => (i / SWEEP_POINTS) * fm);
        setSweep({ freqs, rows: forcedSweep(c, s.right, cd, freqs), fmax: fm });
      } catch (e) {
        setError((e as Error).message);
      }
    }, 20);
  };
  // Computed when the window opens and on Refresh only: it is too slow to follow every edit.
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  const parts = corner.template.parts;
  const series = useMemo(() => (sweep ? parts.map((_, p) => sweep.rows.map((r) => r.parts[p].amplitude[component])) : []), [sweep, parts, component]);
  const W = 600;
  const H = 280;
  const L = 56;
  const B = 28;
  const T = 10;
  const R = 8;
  const peak = Math.max(1e-12, ...series.flat());
  const yTicks = niceTicks(0, peak * 1.05);
  const yHi = yTicks[yTicks.length - 1] || peak;
  const xHi = sweep?.fmax ?? fmax;
  const px = (f: number) => L + (f / xHi) * (W - L - R);
  const py = (v: number) => T + (1 - v / yHi) * (H - T - B);
  const svgRef = useRef<SVGSVGElement>(null);
  const click = (e: React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const f = Math.min(xHi, Math.max(0, ((x - L) / (W - L - R)) * xHi));
    set({ forcedHz: Math.round(f * 10) / 10, mode: 'forced' });
  };

  return (
    <>
      <div className="row">
        <label className="inl">Component
          <select aria-label="Component" value={component} onChange={(e) => setComponent(Number(e.target.value))}>
            {COMPONENTS.map((c, k) => <option key={k} value={k}>{c}</option>)}
          </select>
        </label>
        <label className="inl">Up to <NumberCell value={fmax} digits={0} onCommit={(v) => setFmax(Math.min(1000, Math.max(5, v)))} /> Hz</label>
        <button onClick={refresh} data-testid="sweep-refresh">Refresh</button>
        <span className="grow" />
        <span className="muted small">C of G amplitude per part, active force set</span>
      </div>
      {error && <div className="error">{error}</div>}
      {!sweep && !error && <p className="muted">Calculating…</p>}
      {sweep && (
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="chart sweep" role="img" aria-label="Forced-damped speed sweep" data-testid="sweep-chart" onClick={click}>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke="var(--line)" />
              <text x={L - 6} y={py(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{short(v)}</text>
            </g>
          ))}
          {niceTicks(0, xHi, 8).map((f) => (
            <g key={f}>
              <line x1={px(f)} x2={px(f)} y1={T} y2={H - B} stroke="var(--line)" />
              <text x={px(f)} y={H - B + 13} textAnchor="middle" fontSize="10" fill="var(--muted)">{f}</text>
            </g>
          ))}
          {series.map((vals, p) => (
            <polyline key={p} fill="none" stroke={COLOURS[p % COLOURS.length]} strokeWidth="1.8" points={vals.map((v, i) => `${px(sweep.freqs[i])},${py(v)}`).join(' ')} />
          ))}
          {d.forcedHz <= xHi && <line data-testid="sweep-marker" x1={px(d.forcedHz)} x2={px(d.forcedHz)} y1={T} y2={H - B} stroke="#ffe066" strokeDasharray="5 4" />}
          <text x={(W + L) / 2} y={H - 3} textAnchor="middle" fontSize="10" fill="var(--muted)">Frequency (Hz); click to set the 3D view frequency</text>
        </svg>
      )}
      <div className="legend small">
        {parts.map((name, p) => <span key={p}><i style={{ background: COLOURS[p % COLOURS.length] }} />{p + 1} {name}</span>)}
        <span className="muted">| 3D view at {d.forcedHz.toFixed(1)} Hz</span>
      </div>
    </>
  );
}
