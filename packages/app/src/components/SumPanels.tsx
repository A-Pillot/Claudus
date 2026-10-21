import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COEFFICIENTS, dataPoints, getTemplate, hasTemplate, kinematicSum, lineKey, optimise, parameterValue, withParameter,
  type End, type KinematicSum, type Side, type Model, type OptimiserParameter, type ParameterState, type SumTarget, type Sweep, type Template,
} from '@claudus/core';
import { useApp } from '../store';
import { useLab } from '../lab';
import { useEffectiveCompliance } from '../derived';
import { NumberCell } from './PointTable';
import { Panel } from './Panel';
import { VARIABLES } from './Graphs';

const END_NAME: Record<End, string> = { front: 'Front', rear: 'Rear' };
const SWEEP_NAME: Record<Sweep, string> = { bump: 'bump', roll: 'roll', steer: 'steer' };
const fmt = (v: number | undefined, d = 4) => (v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d));

const templateOf = (m: Model, end: End): Template | undefined => {
  const s = m[end];
  if (!s) return undefined;
  // The registry first: a file's own templates are registered when it opens, and only the registry follows later edits.
  return hasTemplate(s.templateSlot) ? getTemplate(s.templateSlot) : m.templates?.find((t) => t.slot === s.templateSlot);
};

/** The model as the sum should see it: in compliant mode with the master force switch applied. */
function useSumModel(): { model: Model; compliant: boolean } {
  const model = useApp((s) => s.model);
  const compliant = useApp((s) => s.compliant);
  const comp = useEffectiveCompliance();
  return useMemo(() => ({ model: compliant ? { ...model, compliance: comp } : model, compliant }), [model, compliant, comp]);
}

/** The kinematic sum of the current model, recomputed shortly after anything it depends on changes. */
export function useKinematicSum(enabled = true): { sum?: KinematicSum; busy: boolean; error?: string } {
  const { model, compliant } = useSumModel();
  const templatesRev = useApp((s) => s.templatesRev);
  const targets = useLab((s) => s.sumTargets);
  const lines = useLab((s) => s.userLines);
  const [state, setState] = useState<{ sum?: KinematicSum; busy: boolean; error?: string }>({ busy: true });
  useEffect(() => {
    if (!enabled) return;
    setState((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      try {
        setState({ sum: kinematicSum(model, targets, lines, { compliant }), busy: false });
      } catch (e) {
        setState({ busy: false, error: (e as Error).message });
      }
    }, 200);
    return () => clearTimeout(t);
  }, [enabled, model, compliant, targets, lines, templatesRev]);
  return state;
}

export const targetLabel = (t: SumTarget): string => {
  if (t.kind === 'graph') {
    const y = VARIABLES[t.sweep].ys.find((v) => v.key === t.variable);
    return `${END_NAME[t.end]}${t.side === 'left' ? ' (-Y)' : ''} ${y?.label ?? t.variable} (${SWEEP_NAME[t.sweep]})`;
  }
  const c = COEFFICIENTS.find((x) => x.key === t.coefficient);
  return `${END_NAME[t.end]} compliance: ${c?.label ?? t.coefficient}, force set ${t.set + 1}`;
};

/* ---------- kinematic sum ---------- */

export function KinSumPanel() {
  const on = useLab((s) => s.panels.kinSum);
  const setPanel = useLab((s) => s.setPanel);
  if (!on) return null;
  return (
    <Panel title="Kinematic sum" width={640} onClose={() => setPanel('kinSum', false)} testId="kinsum">
      <KinSumBody />
    </Panel>
  );
}

function KinSumBody() {
  const targets = useLab((s) => s.sumTargets);
  const setTargets = useLab((s) => s.setSumTargets);
  const lines = useLab((s) => s.userLines);
  const { sum, busy, error } = useKinematicSum();
  const model = useApp((s) => s.model);
  const comp = useEffectiveCompliance();
  const ends = (['front', 'rear'] as End[]).filter((e) => model[e]);

  const edit = (i: number, patch: Partial<SumTarget>) => setTargets(targets.map((t, j) => (j === i ? ({ ...t, ...patch } as SumTarget) : t)));
  const includeAll = () => {
    const have = new Set(targets.filter((t) => t.kind === 'graph').map((t) => lineKey(t as Extract<SumTarget, { kind: 'graph' }>)));
    const added = lines.filter((l) => !have.has(lineKey(l))).map((l): SumTarget => ({ kind: 'graph', end: l.end, ...(l.side ? { side: l.side } : {}), sweep: l.sweep, variable: l.variable, weight: 1, on: true }));
    setTargets([...targets, ...added]);
  };

  const [g, setG] = useState<{ end: End; side: Side; sweep: Sweep; variable: string }>({ end: ends[0] ?? 'front', side: 'right', sweep: 'bump', variable: 'camber' });
  const [c, setC] = useState<{ end: End; set: number; coefficient: (typeof COEFFICIENTS)[number]['key']; target: number }>({ end: ends[0] ?? 'front', set: 0, coefficient: 'toe', target: 0 });

  return (
    <>
      <div className="row">
        <button onClick={includeAll} disabled={!lines.length} title="Add every graph that has a user line, weight 1">Include all graphs with user lines</button>
        <button onClick={() => setTargets([])} disabled={!targets.length}>Remove all</button>
        <span className="grow" />
        <span className="sumtotal" data-testid="sum-total">Sum <b>{busy ? '…' : fmt(sum?.total)}</b></span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="tblwrap">
        <table className="ctable" data-testid="kinsum-table">
          <thead><tr><th>On</th><th>Result</th><th>Target</th><th>Weight</th><th>Deviation</th><th>Weighted</th><th /></tr></thead>
          <tbody>
            {targets.map((t, i) => {
              const item = sum?.items[i];
              const missing = t.on && !busy && item && item.deviation === undefined;
              return (
                <tr key={i} className={t.on ? '' : 'off'}>
                  <td><input type="checkbox" aria-label={`Include ${targetLabel(t)}`} checked={t.on} onChange={(e) => edit(i, { on: e.target.checked })} /></td>
                  <td>{targetLabel(t)}</td>
                  <td className="num">{t.kind === 'compliance' ? <NumberCell value={t.target} digits={4} onCommit={(v) => edit(i, { target: v })} /> : <span className="muted">user line</span>}</td>
                  <td><NumberCell value={t.weight} onCommit={(v) => edit(i, { weight: v })} /></td>
                  <td className="num">{missing ? <span className="muted" title="No user line, or it does not overlap the results">none</span> : fmt(item?.deviation)}</td>
                  <td className="num">{t.on ? fmt(item?.weighted) : '–'}</td>
                  <td><button className="icon" aria-label="Remove target" onClick={() => setTargets(targets.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}
            {targets.length === 0 && <tr><td colSpan={7} className="muted">No targets. Copy a data line to a user line on a graph, then include it here.</td></tr>}
          </tbody>
        </table>
      </div>
      <fieldset className="addrow">
        <legend>Add graph result</legend>
        <select aria-label="End" value={g.end} onChange={(e) => setG({ ...g, end: e.target.value as End })}>{ends.map((e) => <option key={e} value={e}>{END_NAME[e]}</option>)}</select>
        <select aria-label="Side" value={g.side} onChange={(e) => setG({ ...g, side: e.target.value as Side })}><option value="right">+Y</option><option value="left">-Y</option></select>
        <select aria-label="Sweep" value={g.sweep} onChange={(e) => setG({ ...g, sweep: e.target.value as Sweep, variable: VARIABLES[e.target.value as Sweep].ys[0].key })}>
          <option value="bump">Bump</option><option value="roll">Roll</option><option value="steer">Steer</option>
        </select>
        <select aria-label="Variable" value={g.variable} onChange={(e) => setG({ ...g, variable: e.target.value })}>{VARIABLES[g.sweep].ys.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</select>
        <button onClick={() => setTargets([...targets, { kind: 'graph', end: g.end, ...(g.side === 'left' ? { side: g.side } : {}), sweep: g.sweep, variable: g.variable, weight: 1, on: true }])}>Add</button>
      </fieldset>
      <fieldset className="addrow">
        <legend>Add compliance coefficient</legend>
        <select aria-label="End" value={c.end} onChange={(e) => setC({ ...c, end: e.target.value as End })}>{ends.map((e) => <option key={e} value={e}>{END_NAME[e]}</option>)}</select>
        <select aria-label="Force set" value={c.set} onChange={(e) => setC({ ...c, set: Number(e.target.value) })}>{comp.forceSets.map((f, k) => <option key={k} value={k}>Set {k + 1} {f.label}</option>)}</select>
        <select aria-label="Coefficient" value={c.coefficient} onChange={(e) => setC({ ...c, coefficient: e.target.value as typeof c.coefficient })}>{COEFFICIENTS.map((k) => <option key={k.key} value={k.key}>{k.label} ({k.unit})</option>)}</select>
        <label className="inl">Target <NumberCell value={c.target} digits={4} onCommit={(v) => setC({ ...c, target: v })} /></label>
        <button onClick={() => setTargets([...targets, { kind: 'compliance', end: c.end, set: c.set, coefficient: c.coefficient, target: c.target, weight: 1, on: true }])}>Add</button>
      </fieldset>
      <p className="muted small">The deviation of a graph is the average difference between its curve and its user line over the positions the user line covers. A compliance coefficient is the difference from its target value.</p>
    </>
  );
}

/* ---------- optimiser ---------- */

const STIFF = ['kx', 'ky', 'kz', 'krx', 'kry', 'krz'];
const AXES = ['X', 'Y', 'Z'];

function paramLabel(p: OptimiserParameter, t?: Template): string {
  const pt = t ? dataPoints(t).find((q) => q.no === p.point) : undefined;
  const where = `${END_NAME[p.end]} point ${p.point}${pt ? ' ' + pt.label : ''}`;
  if (p.kind === 'point') return `${where}, ${AXES[p.axis]} (mm)`;
  if (p.kind === 'bushStiffness') return `${where}, bush ${STIFF[p.component]}`;
  return `${where}, bush turned about ${AXES[p.axis]} (deg)`;
}

type RunStatus = 'idle' | 'running' | 'done' | 'stopped';
/** One line of the optimiser's detail log. */
interface LogRow { iteration: number; what: string; sum: number; values: number[] }

interface RunState {
  status: RunStatus;
  history: number[];
  log: LogRow[];
  startSum?: number;
  params: ParameterState[];
  values: number[];
  iteration: number;
  result?: { model: Model; total: number };
  error?: string;
}
const IDLE: RunState = { status: 'idle', history: [], log: [], params: [], values: [], iteration: 0 };

export function OptimiserPanel() {
  const on = useLab((s) => s.panels.optimiser);
  const setPanel = useLab((s) => s.setPanel);
  if (!on) return null;
  return (
    <Panel title="Optimiser" width={700} x={Math.max(8, window.innerWidth - 740)} onClose={() => setPanel('optimiser', false)} testId="optimiser">
      <OptimiserBody />
    </Panel>
  );
}

function OptimiserBody() {
  const params = useLab((s) => s.optParams);
  const setParams = useLab((s) => s.setOptParams);
  const settings = useLab((s) => s.optSettings);
  const setSettings = useLab((s) => s.setOptSettings);
  const backup = useLab((s) => s.optBackup);
  const targets = useLab((s) => s.sumTargets);
  const lines = useLab((s) => s.userLines);
  const model = useApp((s) => s.model);
  const compliant = useApp((s) => s.compliant);
  const comp = useEffectiveCompliance();
  const live = useKinematicSum();
  const [run, setRun] = useState<RunState>(IDLE);
  const [details, setDetails] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const stopFlag = useRef(false);
  const startModel = useRef<Model>(model);
  const ends = (['front', 'rear'] as End[]).filter((e) => model[e]);
  const running = run.status === 'running';

  useEffect(() => () => { stopFlag.current = true; clearTimeout(timer.current); }, []);

  // New-parameter form.
  const [kind, setKind] = useState<OptimiserParameter['kind']>('point');
  const [end, setEnd] = useState<End>(ends[0] ?? 'front');
  const tpl = templateOf(model, end);
  const pts = tpl ? dataPoints(tpl) : [];
  const bushPts = (model.compliance?.[end]?.bushes ?? []).map((b) => b.point);
  const [pointNo, setPointNo] = useState<number>(pts[0]?.no ?? 1);
  const [sub, setSub] = useState(2);
  const choices = kind === 'point' ? pts.map((p) => ({ no: p.no, label: p.label })) : (bushPts.length ? bushPts : []).map((no) => ({ no, label: pts.find((p) => p.no === no)?.label ?? '' }));
  const chosen = choices.some((c) => c.no === pointNo) ? pointNo : choices[0]?.no;

  const add = () => {
    if (chosen === undefined) return;
    let p: OptimiserParameter;
    if (kind === 'point') p = { kind, end, point: chosen, axis: sub as 0 | 1 | 2, range: 10, increment: 1, on: true };
    else if (kind === 'bushStiffness') {
      p = { kind, end, point: chosen, component: sub as 0 | 1 | 2 | 3 | 4 | 5, range: 1, increment: 1, on: true };
      const v = parameterValue(model, p);
      p.range = Math.max(1, v);
      p.increment = Math.max(0.1, Math.round(v / 10));
    } else p = { kind, end, point: chosen, axis: (sub % 3) as 0 | 1 | 2, range: 5, increment: 0.5, on: true };
    setParams([...params, p]);
  };
  const editParam = (i: number, patch: Partial<OptimiserParameter>) => setParams(params.map((p, j) => (j === i ? ({ ...p, ...patch } as OptimiserParameter) : p)));

  const buildStopped = (values: number[]): Model => {
    const effective: Model = compliant ? { ...startModel.current, compliance: comp } : startModel.current;
    let m = effective;
    params.forEach((p, i) => {
      const start = parameterValue(effective, p);
      const v = values[i];
      if (v !== undefined && Number.isFinite(v) && (p.kind === 'bushOrientation' ? v !== 0 : v !== start)) m = withParameter(m, p, v);
    });
    return m;
  };

  const start = () => {
    stopFlag.current = false;
    startModel.current = model;
    const effective: Model = compliant ? { ...model, compliance: comp } : model;
    const gen = optimise({ model: effective, targets, lines, parameters: params, settings, sumOptions: { compliant } });
    let st: RunState = { ...IDLE, status: 'running', values: params.map((p) => parameterValue(effective, p)) };
    setRun(st);
    const tick = () => {
      if (stopFlag.current) return;
      try {
        const r = gen.next();
        if (r.done) return;
        const e = r.value;
        const last = st.history[st.history.length - 1];
        if (e.type === 'start') st = { ...st, startSum: e.sum.total, history: [e.sum.total], log: [{ iteration: 0, what: 'start', sum: e.sum.total, values: st.values }] };
        else if (e.type === 'sensitivity')
          st = { ...st, params: e.parameters, iteration: e.iteration, log: [...st.log, { iteration: e.iteration, what: 'sensitivity pass', sum: last, values: e.parameters.map((q) => q.value) }] };
        else if (e.type === 'step')
          st = { ...st, history: [...st.history, e.sum], values: e.values, iteration: e.iteration, log: [...st.log, { iteration: e.iteration, what: e.parameter < 0 ? 'pattern move' : `P${e.parameter + 1}`, sum: e.sum, values: e.values }] };
        else {
          st = { ...st, status: 'done', log: [...st.log, { iteration: e.iterations, what: 'finished', sum: e.sum.total, values: e.parameters.map((q) => q.value) }], params: e.parameters, values: e.parameters.map((p) => p.value), iteration: e.iterations, history: [...st.history, e.sum.total], result: { model: e.model, total: e.sum.total } };
          setRun(st);
          return;
        }
        setRun(st);
        timer.current = setTimeout(tick, 0);
      } catch (err) {
        setRun({ ...st, status: 'stopped', error: (err as Error).message });
      }
    };
    timer.current = setTimeout(tick, 0);
  };

  const stop = () => {
    stopFlag.current = true;
    clearTimeout(timer.current);
    try {
      const m = buildStopped(run.values);
      const total = kinematicSum(m, targets, lines, { compliant }).total;
      setRun({ ...run, status: 'stopped', result: { model: m, total } });
    } catch (err) {
      setRun({ ...run, status: 'stopped', error: (err as Error).message });
    }
  };

  const apply = () => {
    if (!run.result) return;
    const original = useApp.getState().model;
    const res = run.result.model;
    // The master force switch only affects the solve; keep the model's own force sets.
    const fixed: Model = res.compliance && original.compliance ? { ...res, compliance: { ...res.compliance, forceSets: original.compliance.forceSets } } : res;
    useLab.getState().setOptBackup(original);
    useApp.getState().replaceModel(fixed);
  };
  const revert = () => {
    if (!backup) return;
    useApp.getState().replaceModel(backup);
    useLab.getState().setOptBackup(null);
  };

  const canRun = params.some((p) => p.on) && targets.some((t) => t.on) && !running;
  const rows = run.params.length ? run.params : params.map((p) => ({ parameter: p, start: parameterValue(model, p), value: parameterValue(model, p), sensitivity: 0, screened: !p.on }) as ParameterState);

  return (
    <>
      <div className="row">
        <span>Kinematic sum <b data-testid="opt-live-sum">{live.busy ? '…' : fmt(live.sum?.total)}</b></span>
        <span className="muted small">{targets.filter((t) => t.on).length} result(s) in the sum</span>
        <span className="grow" />
        <button onClick={() => useLab.getState().setPanel('kinSum', true)}>Kinematic sum…</button>
      </div>
      {!targets.some((t) => t.on) && <p className="warn small">The sum has no results in it yet. Open the kinematic sum and add some.</p>}

      <div className="tblwrap short">
        <table className="ctable" data-testid="opt-params">
          <thead><tr><th>On</th><th>Parameter</th><th>Range</th><th>Increment</th><th /></tr></thead>
          <tbody>
            {params.map((p, i) => (
              <tr key={i} className={p.on ? '' : 'off'}>
                <td><input type="checkbox" aria-label={`Use ${paramLabel(p, templateOf(model, p.end))}`} checked={p.on} disabled={running} onChange={(e) => editParam(i, { on: e.target.checked })} /></td>
                <td>{paramLabel(p, templateOf(model, p.end))}</td>
                <td><NumberCell value={p.range} onCommit={(v) => editParam(i, { range: Math.abs(v) })} /></td>
                <td><NumberCell value={p.increment} onCommit={(v) => editParam(i, { increment: Math.abs(v) })} /></td>
                <td><button className="icon" aria-label="Remove parameter" disabled={running} onClick={() => setParams(params.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
            {params.length === 0 && <tr><td colSpan={5} className="muted">No parameters. Add a point coordinate, bush stiffness or bush orientation below.</td></tr>}
          </tbody>
        </table>
      </div>
      <fieldset className="addrow" disabled={running}>
        <legend>Add parameter</legend>
        <select aria-label="Parameter type" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setSub(e.target.value === 'bushStiffness' ? 0 : 2); }}>
          <option value="point">Point coordinate</option>
          <option value="bushStiffness">Bush stiffness</option>
          <option value="bushOrientation">Bush orientation</option>
        </select>
        <select aria-label="End" value={end} onChange={(e) => setEnd(e.target.value as End)}>{ends.map((e) => <option key={e} value={e}>{END_NAME[e]}</option>)}</select>
        <select aria-label="Point" value={chosen ?? ''} onChange={(e) => setPointNo(Number(e.target.value))}>
          {choices.map((c) => <option key={c.no} value={c.no}>{c.no} {c.label}</option>)}
        </select>
        <select aria-label={kind === 'bushStiffness' ? 'Component' : 'Axis'} value={sub} onChange={(e) => setSub(Number(e.target.value))}>
          {(kind === 'bushStiffness' ? STIFF : AXES).map((a, k) => <option key={k} value={k}>{a}</option>)}
        </select>
        <button onClick={add} disabled={chosen === undefined}>Add</button>
        {kind !== 'point' && bushPts.length === 0 && <span className="muted small">No bushes at this end yet (Compliance / Bush properties).</span>}
      </fieldset>

      <div className="row settings">
        <label className="inl" title="Parameters whose effect on the sum is below this fraction of the sum are screened out">Threshold <NumberCell value={settings.threshold} digits={5} onCommit={(v) => setSettings({ ...settings, threshold: Math.abs(v) })} /></label>
        <label className="inl">Max iterations <NumberCell value={settings.maxIterations} digits={0} onCommit={(v) => setSettings({ ...settings, maxIterations: Math.max(1, Math.round(v)) })} /></label>
        <label className="inl" title="How many times the increments may be halved once progress stops">Refinements <NumberCell value={settings.refinements} digits={0} onCommit={(v) => setSettings({ ...settings, refinements: Math.max(0, Math.round(v)) })} /></label>
      </div>

      <div className="row">
        <button className="primary" onClick={start} disabled={!canRun}>Run</button>
        <button onClick={stop} disabled={!running}>Stop</button>
        <button onClick={apply} disabled={running || !run.result} title="Put the optimised values into the model">Apply result to model</button>
        <label className="inl" title="List every step of the run with the parameter values and the sum"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Details</label>
        <button onClick={revert} disabled={!backup || running} title="Go back to the model as it was before the result was applied">Revert</button>
        <span className="grow" />
        <span className="muted small" data-testid="opt-status">
          {run.status === 'idle' ? 'Ready' : running ? `Running, iteration ${run.iteration}…` : run.status === 'done' ? `Finished after ${run.iteration} iteration(s)` : 'Stopped'}
          {run.error ? `: ${run.error}` : ''}
        </span>
      </div>

      {run.history.length > 0 && (
        <div className="rolling">
          <Sparkline values={run.history} />
          <div className="small" data-testid="opt-sums">
            Start <b>{fmt(run.startSum)}</b> · now <b>{fmt(run.history[run.history.length - 1])}</b>
            {run.startSum ? <> · {(((run.startSum - run.history[run.history.length - 1]) / run.startSum) * 100).toFixed(1)}% lower</> : null}
            {' '}· {run.history.length - 1} step(s)
          </div>
        </div>
      )}

      {run.status !== 'idle' && (
        <div className="tblwrap short">
          <table className="ctable" data-testid="opt-summary">
            <thead><tr><th>Parameter</th><th>Start</th><th>Current</th><th>Sensitivity</th><th>Screened</th></tr></thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={i}>
                  <td>{paramLabel(s.parameter, templateOf(model, s.parameter.end))}</td>
                  <td className="num">{fmt(s.start, 3)}</td>
                  <td className="num">{fmt(running || run.status === 'stopped' ? run.values[i] ?? s.value : s.value, 3)}</td>
                  <td className="num">{fmt(s.sensitivity, 4)}</td>
                  <td>{!s.parameter.on ? 'off' : s.screened ? 'screened' : 'used'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {details && (
        <div className="tblwrap short" data-testid="opt-details">
          <table className="ctable">
            <thead>
              <tr>
                <th>Iter</th><th>Step</th><th>Sum</th>
                {params.map((p, i) => <th key={i} title={paramLabel(p, templateOf(model, p.end))}>P{i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {run.log.map((r, k) => (
                <tr key={k}>
                  <td className="num">{r.iteration}</td><td>{r.what}</td><td className="num">{fmt(r.sum, 5)}</td>
                  {params.map((_, i) => <td key={i} className="num">{fmt(r.values[i], 3)}</td>)}
                </tr>
              ))}
              {run.log.length === 0 && <tr><td colSpan={3 + params.length} className="muted">Nothing run yet. P1, P2 ... are the parameters in the order listed above; each row is one accepted change.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {backup && <p className="muted small">A result has been applied. Revert puts the earlier hard points and bush data back.</p>}
    </>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 640;
  const H = 70;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (values.length === 1 ? W / 2 : 6 + (i / (values.length - 1)) * (W - 12));
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (H - 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="Rolling kinematic sum" data-testid="opt-spark">
      <polyline fill="none" stroke="#7ee787" strokeWidth="2" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill="#ffe066" />
    </svg>
  );
}
