import { useMemo, useState } from 'react';
import {
  checkTemplate, dataPoints, expandPoints, GenType, GROUND, isCustomTemplate, NONE, nextFreeSlot, normaliseTemplate, remapPoints,
  type GraphicKind, type Template, type TemplatePoint, type Vec3,
} from '@claudus/core';
import { useApp } from '../store';
import { NumberCell } from './PointTable';
import { fmtUnit, unitText, useUnitSettings } from '../units';

/** General type names, as SHARK's template settings panel lists them. */
export const GEN_LABELS: [GenType, string][] = [
  [GenType.None, '0 None'],
  [GenType.WheelCentre, '1 Wheel centre'],
  [GenType.StubAxle, '2 Stub axle'],
  [GenType.SteeringAttachment, '3 Steering attachment'],
  [GenType.Damper1ToSuspension, '4 Damper 1 to suspension'],
  [GenType.Damper1ToBody, '5 Damper 1 to body / strut top'],
  [GenType.Spring1ToSuspension, '6 Spring 1 to suspension'],
  [GenType.Spring1ToBody, '7 Spring 1 to body'],
  [GenType.UpperBallJoint, '8 Upper ball joint'],
  [GenType.LowerBallJoint, '9 Lower ball joint'],
  [GenType.StrutSliderPoint, '10 Strut slider'],
  [GenType.StrutEndPoint, '11 Strut lower end'],
  [GenType.RollBarBarAttachment, '12 Roll bar, bar end'],
  [GenType.RollBarAxisPoint, '13 Roll bar axis'],
  [GenType.RollBarLinkAttachment, '14 Roll bar, link end'],
  [GenType.RackLateralMount, '15 Rack lateral mount'],
  [GenType.RackMount, '16 Rack mount'],
  [GenType.WheelCentre2, '17 Wheel centre (2)'],
  [GenType.Damper2ToSuspension, '18 Damper 2 to suspension'],
  [GenType.Damper2ToBody, '19 Damper 2 to body'],
  [GenType.Spring2ToSuspension, '20 Spring 2 to suspension'],
  [GenType.Spring2ToBody, '21 Spring 2 to body'],
  [GenType.RigidAxleRevolute, '22 Rigid axle revolute'],
  [GenType.StubAxle2, '23 Stub axle (2)'],
  [GenType.ShearPoint, '24 Shear point'],
  [GenType.PartCofG, '25 Part C of G'],
  [GenType.UpperBallJoint2, '26 Upper ball joint (2)'],
  [GenType.LowerBallJoint2, '27 Lower ball joint (2)'],
  [GenType.StrutSliderPoint2, '28 Strut slider (2)'],
  [GenType.StrutEndPoint2, '29 Strut lower end (2)'],
  [GenType.RollBarLinkAttachment2, '32 Roll bar, link end (2)'],
  [GenType.SteeringAttachment2, '33 Steering attachment (2)'],
  [GenType.RollBarRevolute, '34 Roll bar revolute'],
];

const KINDS: GraphicKind[] = ['line', 'tube', 'pivot', 'cylinder', 'circle', 'sphere', 'facet3', 'facet4', 'plane', 'distance', 'components', 'angle'];

type Tab = 'parts' | 'points' | 'settings' | 'graphics' | 'check';

const clone = (t: Template): Template => JSON.parse(JSON.stringify(t));

/**
 * SHARK's File / Edit Templates: parts, points, settings (which parts each point joins, and what it is) and
 * graphics, with a check that the template moves like a suspension. Changes apply to the end being shown.
 */
export function TemplateEditor({ template, onClose }: { template: Template; onClose: () => void }) {
  const data = useApp((s) => s.model[s.end]);
  const applyTemplate = useApp((s) => s.applyTemplate);
  // A built-in template is edited as a copy in a new slot, so the original stays available.
  const [draft, setDraft] = useState<Template>(() => {
    const t = clone(template);
    if (!isCustomTemplate(t.slot)) {
      t.slot = nextFreeSlot();
      t.label = `${t.label} (custom)`;
    }
    t.source = 'custom';
    return t;
  });
  const [tab, setTab] = useState<Tab>('points');
  const update = (f: (t: Template) => void) => setDraft((d) => {
    const t = clone(d);
    f(t);
    return t;
  });

  // The model's own points, carried across to the draft, are what the check and Apply use.
  const modelPoints = useMemo(
    () => (data ? remapPoints(template, draft, data.points) : dataPoints(draft).map((p) => p.def)),
    [data, template, draft],
  );
  const result = useMemo(() => (tab === 'check' ? checkTemplate(normaliseTemplate(draft), modelPoints, data?.rollingRadius ?? 300) : undefined), [tab, draft, modelPoints, data]);

  const apply = () => {
    const t = normaliseTemplate(draft);
    const r = checkTemplate(t, modelPoints, data?.rollingRadius ?? 300);
    if (r.errors.length) {
      setTab('check');
      return;
    }
    applyTemplate(t, modelPoints);
    onClose();
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h3>Edit template</h3>
        <div className="row">
          <label>Number</label>
          <NumberCell value={draft.slot} digits={0} onCommit={(v) => update((t) => { t.slot = Math.round(v); })} />
          <label>Label</label>
          <input className="grow" value={draft.label} onChange={(e) => update((t) => { t.label = e.target.value; })} />
        </div>
        <div className="seg tabs">
          {(['parts', 'points', 'settings', 'graphics', 'check'] as Tab[]).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
          ))}
        </div>
        <div className="tplbody">
          {tab === 'parts' && <PartsTab draft={draft} update={update} />}
          {tab === 'points' && <PointsTab draft={draft} update={update} />}
          {tab === 'settings' && <SettingsTab draft={draft} update={update} />}
          {tab === 'graphics' && <GraphicsTab draft={draft} update={update} />}
          {tab === 'check' && result && (
            <div className="check">
              {result.freedom && (
                <p>
                  {result.freedom.unknowns} unknowns, {result.freedom.equations} equations. Free motions: {result.freedom.free} (needs{' '}
                  {result.wheels}, one per wheel); with the tyre{result.wheels > 1 ? 's' : ''} on the ground: {result.freedom.closed} (needs 0).
                </p>
              )}
              {result.errors.length === 0 && <p className="ok">The template works: Apply will use it for this end.</p>}
              {result.errors.map((e, i) => <p key={`e${i}`} className="bad">{e}</p>)}
              {result.warnings.map((w, i) => <p key={`w${i}`} className="warn">{w}</p>)}
            </div>
          )}
        </div>
        <div className="actions">
          <span className="muted">Saved to your template library as type {draft.slot}.</span>
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => setTab('check')}>Check</button>
          <button className="primary" onClick={apply} disabled={!data}>Apply</button>
        </div>
      </div>
    </div>
  );
}

type Edit = { draft: Template; update: (f: (t: Template) => void) => void };

const partName = (t: Template, k: number) => (k === GROUND ? 'Body' : k === NONE ? '—' : `${k} ${t.parts[k - 1] ?? '?'}`);

function PartsTab({ draft, update }: Edit) {
  const used = (k: number) => draft.points.some((p) => p.part1 === k || p.part2 === k);
  return (
    <table className="grid">
      <thead><tr><th>Part</th><th>Label</th><th>Points</th><th /></tr></thead>
      <tbody>
        {draft.parts.map((label, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td><input value={label} onChange={(e) => update((t) => { t.parts[i] = e.target.value; })} /></td>
            <td className="muted">{draft.points.filter((p) => p.part1 === i + 1 || p.part2 === i + 1).map((p) => p.no).join(', ')}</td>
            <td>
              <button
                disabled={used(i + 1)}
                title={used(i + 1) ? 'Take its points off this part first' : 'Delete part'}
                onClick={() => update((t) => {
                  t.parts.splice(i, 1);
                  // Parts after it move down one.
                  for (const p of t.points) for (const key of ['part1', 'part2'] as const) if (p[key] > i + 1) p[key] -= 1;
                })}
              >✕</button>
            </td>
          </tr>
        ))}
        <tr><td colSpan={4}><button onClick={() => update((t) => { t.parts.push(`Part ${t.parts.length + 1}`); })}>Add part</button>
          <span className="muted"> By convention the upright is the last part.</span></td></tr>
      </tbody>
    </table>
  );
}

function PointsTab({ draft, update }: Edit) {
  useUnitSettings();
  const nextNo = () => Math.max(0, ...draft.points.map((p) => p.no)) + 1;
  const addPoint = (dummy: boolean) => update((t) => {
    const first = t.points.find((p) => !p.dummy);
    const p: TemplatePoint = {
      no: nextNo(), label: dummy ? 'Axis point' : 'New point', def: [...(first?.def ?? [0, 0, 0])] as Vec3,
      part1: t.parts.length ? 1 : GROUND, part2: NONE, gen1: GenType.None, gen2: GenType.None,
    };
    if (dummy && first) p.dummy = { at: first.no, vec: [0, 1, 0], offset: 100 };
    t.points.push(p);
  });
  const placed = useMemo(() => {
    try { return expandPoints(draft, dataPoints(draft).map((p) => p.def)); } catch { return draft.points.map((p) => p.def); }
  }, [draft]);
  return (
    <table className="grid">
      <thead><tr><th>No</th><th>Label</th><th>X</th><th>Y</th><th>Z</th><th /></tr></thead>
      <tbody>
        {draft.points.map((p, i) => (
          <tr key={i}>
            <td><NumberCell value={p.no} digits={0} onCommit={(v) => update((t) => { renumber(t, p.no, Math.round(v)); })} /></td>
            <td><input value={p.label} onChange={(e) => update((t) => { t.points[i].label = e.target.value; })} /></td>
            {[0, 1, 2].map((k) => (
              <td key={k}>
                {p.dummy ? <span className="muted">{placed[i]?.[k] === undefined ? '' : fmtUnit('mm', placed[i][k], 1)}</span> : (
                  <NumberCell unit="mm" value={p.def[k]} onCommit={(v) => update((t) => { t.points[i].def[k] = v; })} />
                )}
              </td>
            ))}
            <td><button title="Delete point" onClick={() => update((t) => {
              t.points.splice(i, 1);
              t.graphics = t.graphics.filter((g) => !g.points.includes(p.no));
            })}>✕</button></td>
          </tr>
        ))}
        <tr><td colSpan={6}>
          <button onClick={() => addPoint(false)}>Add point</button>{' '}
          <button onClick={() => addPoint(true)} title="A construction point that is not stored in model files, e.g. a second point on a revolute axis">Add axis point</button>
          <span className="muted"> Axis points are worked out from other points (Settings tab) and are not saved in model files.</span>
        </td></tr>
      </tbody>
    </table>
  );
}

/** Change a point number everywhere it is used. */
function renumber(t: Template, from: number, to: number) {
  if (from === to || !(to > 0)) return;
  const map = (n: number) => (n === from ? to : n);
  for (const p of t.points) {
    if (p.no === from) p.no = to;
    if (p.dummy) {
      p.dummy.at = map(p.dummy.at);
      if (p.dummy.dir) p.dummy.dir = [map(p.dummy.dir[0]), map(p.dummy.dir[1])];
    }
  }
  for (const g of t.graphics) g.points = g.points.map(map);
}

function SettingsTab({ draft, update }: Edit) {
  const partOptions = [NONE, GROUND, ...draft.parts.map((_, i) => i + 1)];
  const genSelect = (p: TemplatePoint, i: number, key: 'gen1' | 'gen2') => (
    <select value={p[key]} onChange={(e) => update((t) => { t.points[i][key] = Number(e.target.value); })}>
      {GEN_LABELS.map(([g, l]) => <option key={g} value={g}>{l}</option>)}
    </select>
  );
  const partSelect = (p: TemplatePoint, i: number, key: 'part1' | 'part2') => (
    <select value={p[key]} onChange={(e) => update((t) => { t.points[i][key] = Number(e.target.value); })}>
      {partOptions.map((k) => <option key={k} value={k}>{partName(draft, k)}</option>)}
    </select>
  );
  return (
    <table className="grid">
      <thead><tr><th>No</th><th>Label</th><th>Part 1</th><th>Part 2</th><th>Gen. type 1</th><th>Gen. type 2</th><th>Axis point</th></tr></thead>
      <tbody>
        {draft.points.map((p, i) => (
          <tr key={i}>
            <td>{p.no}</td>
            <td className="lbl">{p.label}</td>
            <td>{partSelect(p, i, 'part1')}</td>
            <td>{partSelect(p, i, 'part2')}</td>
            <td>{genSelect(p, i, 'gen1')}</td>
            <td>{genSelect(p, i, 'gen2')}</td>
            <td>{p.dummy ? <DummyCells p={p} i={i} update={update} /> : <span className="muted">—</span>}</td>
          </tr>
        ))}
        <tr><td colSpan={7} className="muted">
          A point on two parts (or a part and the body) is a joint between them. Two shared points make a revolute.
        </td></tr>
      </tbody>
    </table>
  );
}

function DummyCells({ p, i, update }: { p: TemplatePoint; i: number; update: Edit['update'] }) {
  useUnitSettings();
  const d = p.dummy!;
  const set = (f: (d: NonNullable<TemplatePoint['dummy']>) => void) => update((t) => f(t.points[i].dummy!));
  return (
    <span className="dummy">
      at <NumberCell value={d.at} digits={0} onCommit={(v) => set((x) => { x.at = Math.round(v); })} />
      {d.dir ? (
        <>from <NumberCell value={d.dir[0]} digits={0} onCommit={(v) => set((x) => { x.dir![0] = Math.round(v); })} />
          to <NumberCell value={d.dir[1]} digits={0} onCommit={(v) => set((x) => { x.dir![1] = Math.round(v); })} /></>
      ) : (
        <select value={JSON.stringify(d.vec)} onChange={(e) => set((x) => { x.vec = JSON.parse(e.target.value); })}>
          <option value="[1,0,0]">along X</option>
          <option value="[0,1,0]">along Y</option>
          <option value="[0,0,1]">along Z</option>
        </select>
      )}
      by <NumberCell unit="mm" value={d.offset} onCommit={(v) => set((x) => { x.offset = v; })} /> {unitText('mm')}
    </span>
  );
}

function GraphicsTab({ draft, update }: Edit) {
  return (
    <table className="grid">
      <thead><tr><th>#</th><th>Kind</th><th>Points</th><th /></tr></thead>
      <tbody>
        {draft.graphics.map((g, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td>
              <select value={g.kind} onChange={(e) => update((t) => { t.graphics[i].kind = e.target.value as GraphicKind; })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </td>
            <td>
              <input
                defaultValue={g.points.join(' ')}
                onBlur={(e) => update((t) => { t.graphics[i].points = e.target.value.trim().split(/[\s,]+/).map(Number).filter((n) => n > 0); })}
              />
            </td>
            <td><button onClick={() => update((t) => { t.graphics.splice(i, 1); })}>✕</button></td>
          </tr>
        ))}
        <tr><td colSpan={4}>
          <button onClick={() => update((t) => { t.graphics.push({ kind: 'line', points: t.points.slice(0, 2).map((p) => p.no) }); })}>Add line</button>
          <span className="muted"> Wheels, springs and dampers are drawn automatically.</span>
        </td></tr>
      </tbody>
    </table>
  );
}
