import { useState } from 'react';
import {
  around, canSetStaticAngles, dataPoints, defaultCombined, evenBumpValues, getTemplate, hasTemplate, limitOf,
  setAllLimits, setLimit, setSteeringBox, setSteeringType, setStaticAngles, staticAngles, steeringOf, DEFAULT_TOLERANCE,
  type End, type Model, type Template, type Vec3,
} from '@claudus/core';
import { useApp } from '../store';
import { useModes, type ModeDialog } from '../modes';
import { Dlg } from './ComplianceDialogs';
import { NumberCell } from './PointTable';
import { unitText, useUnitSettings } from '../units';

const replace = (m: Model) => useApp.getState().replaceModel(m);
const close = () => useModes.getState().set({ dialog: null });

/** The Data and Solve menu dialogs: static angles, combined motion profile, extended bump, steering, tolerances. */
export function AnalysisDialogs() {
  const dialog: ModeDialog | null = useModes((s) => s.dialog);
  switch (dialog) {
    case 'static': return <StaticAnglesDialog />;
    case 'combined': return <CombinedDialog />;
    case 'extended': return <ExtendedDialog />;
    case 'steering': return <SteeringDialog />;
    case 'boxCoords': return <BoxCoordsDialog />;
    case 'solverTol': return <SolverTolDialog />;
    case 'tolPoint': return <TolPointDialog />;
    case 'pointTol': return <PointTolDialog />;
    case 'allTol': return <AllTolDialog />;
    default: return null;
  }
}

const templateOf = (m: Model, end: End): Template | undefined => {
  const s = m[end];
  if (!s) return undefined;
  return m.templates?.find((t) => t.slot === s.templateSlot) ?? (hasTemplate(s.templateSlot) ? getTemplate(s.templateSlot) : undefined);
};
const END_NAME: Record<End, string> = { front: 'Front', rear: 'Rear' };

/** A number box for values that need an exponent, such as 1e-10. */
function SciCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '';
  return (
    <input
      className="numcell"
      value={text ?? shown}
      onFocus={() => setText(shown)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = Number(text);
        if (text !== null && text.trim() !== '' && Number.isFinite(v) && v !== value) onCommit(v);
        setText(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** End and point chooser: SHARK's tree of axle then point. */
function PointPicker({ model, end, index, onChange }: { model: Model; end: End; index: number; onChange: (end: End, index: number) => void }) {
  const ends = (['front', 'rear'] as End[]).filter((e) => model[e] && templateOf(model, e));
  const t = templateOf(model, end);
  const pts = t ? dataPoints(t) : [];
  return (
    <div className="row">
      <label className="vlabel">Axle</label>
      <select aria-label="Axle" value={end} onChange={(e) => onChange(e.target.value as End, 0)}>
        {ends.map((e) => <option key={e} value={e}>{END_NAME[e]}</option>)}
      </select>
      <label>Point</label>
      <select aria-label="Point" className="grow" value={index} onChange={(e) => onChange(end, Number(e.target.value))}>
        {pts.map((p, i) => <option key={p.no} value={i}>{p.no} {p.label}</option>)}
      </select>
    </div>
  );
}

/* ---------- Set Static Angles ---------- */

function StaticAnglesDialog() {
  const model = useApp((s) => s.model);
  const end = useApp((s) => s.end);
  useUnitSettings();
  const ok = canSetStaticAngles(model, end);
  const now = ok ? staticAngles(model, end) : [];
  const [vals, setVals] = useState(now.map((a) => ({ ...a })));
  const names = now.length > 1 ? ['Right (+Y) wheel', 'Left (-Y) wheel'] : ['Wheel'];
  const apply = () => { replace(setStaticAngles(model, end, vals)); close(); };
  return (
    <Dlg title={`Set static angles (${end})`} onClose={close}>
      <p className="muted small">The stub axle point moves to give the wheel this camber and toe. The wheel centre stays where it is.</p>
      {!ok && <p className="error">This suspension has no editable wheel centre and stub axle points.</p>}
      {vals.map((v, k) => (
        <div key={k}>
          {names.length > 1 && <div className="menuhead">{names[k]}</div>}
          <div className="row"><label className="vlabel">Camber angle (deg)</label><NumberCell digits={4} value={v.camber} onCommit={(x) => setVals(vals.map((q, j) => (j === k ? { ...q, camber: x } : q)))} /></div>
          <div className="row"><label className="vlabel">Toe angle, SAE (deg, +ve in)</label><NumberCell digits={4} value={v.toe} onCommit={(x) => setVals(vals.map((q, j) => (j === k ? { ...q, toe: x } : q)))} /></div>
        </div>
      ))}
      <div className="row"><button className="primary" disabled={!ok} onClick={apply}>Apply</button></div>
    </Dlg>
  );
}

/* ---------- combined motion profile ---------- */

function CombinedDialog() {
  const model = useApp((s) => s.model);
  const steps = (model.combined ?? defaultCombined(model.params)).steps;
  useUnitSettings();
  const save = (next: typeof steps) => replace({ ...model, combined: { steps: next } });
  const edit = (i: number, k: 'bump' | 'rack', v: number) => save(steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  return (
    <Dlg title="Combined motion profile" onClose={close} wide>
      <p className="muted small">
        The path the wheel follows, one step per line: bump (+) or rebound (-) travel with rack travel. Used for ball joint
        travel and wheel envelope work. Bump {unitText('mm')}, rack {unitText('mm')}; a steering box uses degrees of arm angle.
      </p>
      <div className="tblwrap" style={{ maxHeight: '50vh', overflow: 'auto' }}>
        <table className="grid" data-testid="combined-table">
          <thead><tr><th>Step</th><th>Bump travel</th><th>Rack travel</th><th /></tr></thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><NumberCell unit="mm" value={s.bump} onCommit={(v) => edit(i, 'bump', v)} /></td>
                <td><NumberCell unit="mm" value={s.rack} onCommit={(v) => edit(i, 'rack', v)} /></td>
                <td><button className="icon" aria-label={`Delete step ${i + 1}`} onClick={() => save(steps.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button onClick={() => save([...steps, steps[steps.length - 1] ?? { bump: 0, rack: 0 }])}>Add step</button>
        <button onClick={() => save(defaultCombined(model.params).steps)}>Reset to default path</button>
      </div>
    </Dlg>
  );
}

/* ---------- extended bump travel ---------- */

function ExtendedDialog() {
  const model = useApp((s) => s.model);
  const ext = model.extendedBump ?? { use: false, steps: evenBumpValues(model.params).map((bump) => ({ bump, label: '' })) };
  useUnitSettings();
  const save = (next: typeof ext) => replace({ ...model, extendedBump: next });
  const edit = (i: number, patch: Partial<(typeof ext.steps)[number]>) => save({ ...ext, steps: ext.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <Dlg title="Extended bump travel" onClose={close} wide>
      <p className="muted small">
        When in use, the bump sweep runs through exactly these positions instead of even increments. Negative is rebound,
        positive is bump. A label shows when hovering over a point in the listing.
      </p>
      <label className="row"><input type="checkbox" checked={ext.use} onChange={(e) => save({ ...ext, use: e.target.checked })} /> Use extended bump travel</label>
      <div className="tblwrap" style={{ maxHeight: '45vh', overflow: 'auto' }}>
        <table className="grid" data-testid="extended-table">
          <thead><tr><th>No</th><th>Bump travel</th><th>Label</th><th /></tr></thead>
          <tbody>
            {ext.steps.map((s, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><NumberCell unit="mm" value={s.bump} onCommit={(v) => edit(i, { bump: v })} /></td>
                <td><input aria-label={`Label ${i + 1}`} value={s.label} onChange={(e) => edit(i, { label: e.target.value })} /></td>
                <td><button className="icon" aria-label={`Delete position ${i + 1}`} onClick={() => save({ ...ext, steps: ext.steps.filter((_, j) => j !== i) })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button onClick={() => save({ ...ext, steps: [...ext.steps, { bump: ext.steps[ext.steps.length - 1]?.bump ?? 0, label: '' }] })}>Add position</button>
        <button onClick={() => save({ ...ext, steps: evenBumpValues(model.params).map((bump) => ({ bump, label: '' })) })}>Fill from even increments</button>
        <button onClick={() => save({ ...ext, steps: [...ext.steps].sort((a, b) => a.bump - b.bump) })}>Sort</button>
      </div>
    </Dlg>
  );
}

/* ---------- steering type and box ---------- */

function SteeringDialog() {
  const model = useApp((s) => s.model);
  const setEnd = useApp((s) => s.setEnd);
  const ends = (['front', 'rear'] as End[]).filter((e) => model[e]);
  const choose = (end: End, type: 'rack' | 'box') => {
    replace(setSteeringType(model, end, type));
    // SHARK asks for the box coordinates when a model first changes to a box.
    if (type === 'box' && !model.steering?.[end]) { setEnd(end); useModes.getState().set({ dialog: 'boxCoords' }); }
  };
  return (
    <Dlg title="Steering type" onClose={close}>
      <p className="muted small">A steering box turns the steering arm about an axis, so steering travel is an angle in degrees. It needs three more points: two on the box axis and the pitman joint.</p>
      {ends.map((e) => (
        <div className="row" key={e}>
          <label className="vlabel">{END_NAME[e]} steering</label>
          <select aria-label={`${END_NAME[e]} steering type`} value={steeringOf(model, e).type} onChange={(ev) => choose(e, ev.target.value as 'rack' | 'box')}>
            <option value="rack">Steering rack</option>
            <option value="box">Steering box</option>
          </select>
        </div>
      ))}
    </Dlg>
  );
}

function BoxCoordsDialog() {
  const model = useApp((s) => s.model);
  const end = useApp((s) => s.end);
  const st = steeringOf(model, end);
  useUnitSettings();
  const names = ['1st point on box axis', '2nd point on box axis', 'Pitman joint'];
  const edit = (i: number, k: number, v: number) =>
    replace(setSteeringBox(model, end, st.points.map((p, j) => (j === i ? (p.map((x, m) => (m === k ? v : x)) as Vec3) : p)) as typeof st.points));
  return (
    <Dlg title={`Steering box coordinates (${end})`} onClose={close}>
      {st.type !== 'box' && <p className="error">Steering type is a rack. Set it to a steering box to use these points.</p>}
      <table className="grid" data-testid="box-coords">
        <thead><tr><th>Point</th><th>X</th><th>Y</th><th>Z</th></tr></thead>
        <tbody>
          {st.points.map((p, i) => (
            <tr key={i}>
              <td>{101 + i} {names[i]}</td>
              {p.map((v, k) => <td key={k}><NumberCell unit="mm" value={v} onCommit={(x) => edit(i, k, x)} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Dlg>
  );
}

/* ---------- solver tolerances ---------- */

function SolverTolDialog() {
  const model = useApp((s) => s.model);
  const t = model.tolerances.length === 3 ? model.tolerances : [1e-10, 0.05, 0.05];
  const set = (i: number, v: number) => v > 0 && replace({ ...model, tolerances: t.map((x, j) => (j === i ? v : x)) });
  return (
    <Dlg title="Solver tolerances" onClose={close}>
      <div className="row"><label className="vlabel">Kinematic solution tol.</label><SciCell value={t[0]} onCommit={(v) => set(0, v)} /></div>
      <div className="row"><label className="vlabel">Bump small perturbation (mm)</label><SciCell value={t[1]} onCommit={(v) => set(1, v)} /></div>
      <div className="row"><label className="vlabel">Steer small perturbation (mm)</label><SciCell value={t[2]} onCommit={(v) => set(2, v)} /></div>
      <p className="muted small">Defaults 1e-10, 0.05 and 0.05. The perturbations set the step used for rates and for virtual steering axes.</p>
      <div className="row"><button onClick={() => replace({ ...model, tolerances: [1e-10, 0.05, 0.05] })}>Defaults</button></div>
    </Dlg>
  );
}

/* ---------- point tolerances ---------- */

function TolPointDialog() {
  const model = useApp((s) => s.model);
  const cur = useModes((s) => s.tolPoint);
  const [sel, setSel] = useState(cur ?? { end: (model.front ? 'front' : 'rear') as End, index: 0 });
  return (
    <Dlg title="Set tolerance point" onClose={close}>
      <p className="muted small">The hard point moved around its limit box (27 positions) by the tolerance analysis.</p>
      <PointPicker model={model} end={sel.end} index={sel.index} onChange={(end, index) => setSel({ end, index })} />
      <div className="row">
        <button className="primary" onClick={() => { useModes.getState().set({ tolPoint: sel, dialog: null }); }}>Set point</button>
        <button onClick={() => { useModes.getState().set({ tolPoint: sel, tolOn: true, dialog: null }); }}>Set and analyse</button>
      </div>
    </Dlg>
  );
}

const AXES = ['X', 'Y', 'Z'];

function PointTolDialog() {
  const model = useApp((s) => s.model);
  const cur = useModes((s) => s.tolPoint);
  const endNow = useApp((s) => s.end);
  const [sel, setSel] = useState(cur ?? { end: endNow, index: 0 });
  useUnitSettings();
  const box = limitOf(model, sel.end, sel.index);
  const edit = (which: 'min' | 'max', k: number, v: number) =>
    replace(setLimit(model, sel.end, sel.index, { ...box, [which]: box[which].map((x, i) => (i === k ? v : x)) as Vec3 }));
  const p = model[sel.end]?.points[sel.index];
  return (
    <Dlg title="Edit point tolerances" onClose={close}>
      <PointPicker model={model} end={sel.end} index={sel.index} onChange={(end, index) => setSel({ end, index })} />
      {p && <p className="muted small">Point at {p.map((v) => v.toFixed(1)).join(', ')} {unitText('mm')}. Limits are the lowest and highest value the point may take.</p>}
      <table className="grid" data-testid="point-tol">
        <thead><tr><th /><th>Min</th><th>Max</th></tr></thead>
        <tbody>
          {AXES.map((a, k) => (
            <tr key={a}>
              <td>{a}</td>
              <td><NumberCell unit="mm" value={box.min[k]} onCommit={(v) => edit('min', k, v)} /></td>
              <td><NumberCell unit="mm" value={box.max[k]} onCommit={(v) => edit('max', k, v)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button onClick={() => p && replace(setLimit(model, sel.end, sel.index, around(p, [DEFAULT_TOLERANCE, DEFAULT_TOLERANCE, DEFAULT_TOLERANCE], [DEFAULT_TOLERANCE, DEFAULT_TOLERANCE, DEFAULT_TOLERANCE])))}>Reset to ±{DEFAULT_TOLERANCE} mm</button>
      </div>
    </Dlg>
  );
}

function AllTolDialog() {
  const model = useApp((s) => s.model);
  const [v, setV] = useState({ neg: [DEFAULT_TOLERANCE, DEFAULT_TOLERANCE, DEFAULT_TOLERANCE] as Vec3, pos: [DEFAULT_TOLERANCE, DEFAULT_TOLERANCE, DEFAULT_TOLERANCE] as Vec3 });
  useUnitSettings();
  const set = (which: 'neg' | 'pos', k: number, x: number) => setV({ ...v, [which]: v[which].map((q, i) => (i === k ? Math.abs(x) : q)) as Vec3 });
  const apply = () => { replace(setAllLimits(model, v.neg, v.pos)); close(); };
  return (
    <Dlg title="Set all point tolerances" onClose={close}>
      <p className="muted small">Every hard point of both axles gets a limit box reaching these distances either side of its position. Enter them as positive values.</p>
      <table className="grid" data-testid="all-tol">
        <thead><tr><th /><th>-ve</th><th>+ve</th></tr></thead>
        <tbody>
          {AXES.map((a, k) => (
            <tr key={a}>
              <td>{a} tolerance ({unitText('mm')})</td>
              <td><NumberCell unit="mm" value={v.neg[k]} onCommit={(x) => set('neg', k, x)} /></td>
              <td><NumberCell unit="mm" value={v.pos[k]} onCommit={(x) => set('pos', k, x)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row"><button className="primary" onClick={apply}>Apply to all points</button></div>
    </Dlg>
  );
}
