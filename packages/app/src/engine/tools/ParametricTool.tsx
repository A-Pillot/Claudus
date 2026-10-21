import { useMemo, useRef, useState } from 'react';
import { getPath, linspace, optimiseModel, runParametric, setPath, type EngineModel, type ParametricRun } from '@claudus/engine';
import { useEngine } from '../store';
import { Check, f2, Sel } from './common';
import { ToolPlot } from './ToolPlot';

export type Evaluate = (m: EngineModel) => Promise<number> | number;

interface Row { path: string; from: number; to: number; steps: number }

/** Numeric leaf paths of the model that are worth varying. */
export function modelPaths(m: EngineModel): string[] {
  const out: string[] = [];
  const skip = new Set(['id', 'extra', 'layout', 'raw', 'connections', 'tests', 'title']);
  const walk = (o: unknown, p: string) => {
    if (typeof o === 'number') { out.push(p); return; }
    if (Array.isArray(o)) { if (o.length > 40) return; o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!skip.has(k)) walk(v, p ? `${p}.${k}` : k);
  };
  walk(m, '');
  return out;
}

export function ParametricTool({ evaluate }: { evaluate?: Evaluate }) {
  const model = useEngine((s) => s.model);
  const setModel = useEngine((s) => s.setModel);
  const [rows, setRows] = useState<Row[]>([{ path: 'pipes[0].length', from: 200, to: 600, steps: 5 }]);
  const [mode, setMode] = useState<'parametric' | 'optimise'>('parametric');
  const [maximise, setMaximise] = useState(true);
  const [maxEval, setMaxEval] = useState(40);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [runs, setRuns] = useState<ParametricRun[]>([]);
  const [best, setBest] = useState<ParametricRun | null>(null);
  const [error, setError] = useState('');
  const abort = useRef({ aborted: false });
  const paths = useMemo(() => (model ? modelPaths(model) : []), [model]);

  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const setPathAt = (i: number, path: string) => {
    const cur = model ? getPath(model, path) : undefined;
    if (typeof cur === 'number') patch(i, { path, from: cur * 0.8, to: cur * 1.2 });
    else patch(i, { path });
  };
  const valid = (r: Row) => !!model && typeof getPath(model, r.path) === 'number';

  const run = async () => {
    if (!model || !evaluate) return;
    setError(''); setRuns([]); setBest(null); setRunning(true);
    abort.current = { aborted: false };
    try {
      if (mode === 'parametric') {
        const res = await runParametric(model, rows.map((r) => ({ path: r.path, values: linspace(r.from, r.to, Math.max(1, Math.round(r.steps))) })), evaluate, {
          maximise, signal: abort.current, onProgress: (d, t) => setProgress(`${d} / ${t}`),
        });
        setRuns(res.runs); setBest(res.best);
      } else {
        const res = await optimiseModel(model, rows.map((r) => ({ path: r.path, min: Math.min(r.from, r.to), max: Math.max(r.from, r.to) })), evaluate, {
          maximise, maxEvaluations: maxEval, onProgress: (n, b) => setProgress(`${n} evaluations, best ${b.toPrecision(5)}`),
        });
        setRuns(res.history); setBest({ values: res.values, score: res.score });
      }
    } catch (e) { setError((e as Error).message); } finally { setRunning(false); setProgress(''); }
  };

  const applyBest = () => {
    if (!model || !best) return;
    let m = model;
    for (const [p, v] of Object.entries(best.values)) m = setPath(m, p, v);
    setModel(m);
  };

  const one = runs.length > 1 && rows.length === 1 && mode === 'parametric';
  const sorted = one ? [...runs].sort((a, b) => a.values[rows[0].path] - b.values[rows[0].path]) : [];

  return (
    <div className="etools-body">
      <div className="etools-side">
        <fieldset>
          <legend>Parameters</legend>
          <datalist id="eparam-paths">{paths.map((p) => <option key={p} value={p} />)}</datalist>
          {rows.map((r, i) => (
            <div key={i} className="erow">
              <input type="text" list="eparam-paths" value={r.path} onChange={(e) => setPathAt(i, e.target.value)} style={{ flex: '1 1 150px' }} aria-label="Parameter path" />
              <input type="number" value={r.from} onChange={(e) => patch(i, { from: parseFloat(e.target.value) })} style={{ width: 72 }} aria-label="From" />
              <input type="number" value={r.to} onChange={(e) => patch(i, { to: parseFloat(e.target.value) })} style={{ width: 72 }} aria-label="To" />
              {mode === 'parametric' && <input type="number" value={r.steps} min={1} onChange={(e) => patch(i, { steps: parseInt(e.target.value, 10) })} style={{ width: 48 }} aria-label="Steps" />}
              <button className="icon" onClick={() => setRows((x) => x.filter((_, k) => k !== i))} disabled={rows.length < 2} aria-label="Remove parameter">x</button>
              {!valid(r) && <span className="ewarn">not a numeric model value</span>}
            </div>
          ))}
          <div className="erow">
            <button onClick={() => setRows((r) => [...r, { path: '', from: 0, to: 1, steps: 3 }])}>Add parameter</button>
            <span className="edim">path, from, to{mode === 'parametric' ? ', steps' : ''}</span>
          </div>
        </fieldset>
        <fieldset>
          <legend>Solve</legend>
          <Sel label="Type" value={mode} options={[['parametric', 'Parametric (all combinations)'], ['optimise', 'Optimiser (Nelder-Mead)']]} onChange={setMode} />
          <Check label="Higher score is better" value={maximise} onChange={setMaximise} />
          {mode === 'optimise' && (
            <label className="ef"><span>Max evaluations</span><input type="number" value={maxEval} min={5} onChange={(e) => setMaxEval(parseInt(e.target.value, 10) || 40)} /></label>
          )}
          <div className="erow">
            <button className="primary" disabled={!model || !evaluate || running || rows.some((r) => !valid(r))} onClick={run}>{running ? 'Running...' : 'Run'}</button>
            {running && <button onClick={() => { abort.current.aborted = true; }}>Stop</button>}
            <span className="edim">{progress}</span>
          </div>
          {!evaluate && <p className="edim">No simulation is connected to the tool yet, so scores cannot be computed.</p>}
          {!model && <p className="edim">Load or generate a model first.</p>}
          {error && <p className="ewarn">{error}</p>}
        </fieldset>
      </div>
      <div className="etools-main">
        {best && (
          <fieldset>
            <legend>Best result</legend>
            <div className="estat">
              <div><span>Score</span><span>{best.score.toPrecision(6)}</span></div>
              {Object.entries(best.values).map(([k, v]) => <div key={k}><span>{k}</span><span>{f2(v, 3)}</span></div>)}
            </div>
            <div className="erow"><button className="primary" onClick={applyBest}>Apply best to model</button></div>
          </fieldset>
        )}
        {one && <ToolPlot title="Score" x={sorted.map((r) => r.values[rows[0].path])} series={[{ label: 'Score', y: sorted.map((r) => r.score), points: true }]} xLabel={rows[0].path} yLabel="score" />}
        {runs.length > 0 && (
          <div className="etable-wrap">
            <table>
              <thead><tr><th className="l">#</th>{Object.keys(runs[0].values).map((k) => <th key={k}>{k}</th>)}<th>Score</th></tr></thead>
              <tbody>{runs.map((r, i) => <tr key={i}><td className="l">{i + 1}</td>{Object.values(r.values).map((v, k) => <td key={k}>{f2(v, 3)}</td>)}<td>{r.score.toPrecision(6)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {!runs.length && <p className="edim">Choose model parameters (type a path like pipes[0].length or pick from the list), set the ranges, and run. The score comes from the simulation callback supplied by the application.</p>}
      </div>
    </div>
  );
}
