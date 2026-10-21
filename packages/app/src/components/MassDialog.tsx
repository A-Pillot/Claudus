import { useState } from 'react';
import { partMasses, type AxisRef, type Corner, type AxleState, type PartMass, type Vec3 } from '@claudus/core';
import { useApp } from '../store';
import { AxisEditor, Dlg, useEndInfo } from './ComplianceDialogs';
import { NumberCell } from './PointTable';

const COG_LABEL: Record<AxisRef['kind'], string> = { none: 'Part centroid', point: 'Model point', rel: 'Offset from centroid', abs: 'Absolute position' };
const INERTIA = ['Ixx', 'Iyy', 'Izz', 'Ixy', 'Ixz', 'Iyz'];

/** Data / Mass Data / C of G Properties: mass, C of G, local axes and inertia of every part of the end being shown. */
export function MassDialog({ corner, state }: { corner?: Corner; state?: AxleState }) {
  const open = useApp((s) => s.dialog === 'massData');
  const setDialog = useApp((s) => s.setDialog);
  if (!open) return null;
  return <MassBody corner={corner} state={state} onClose={() => setDialog(null)} />;
}

function MassBody({ corner, state, onClose }: { corner?: Corner; state?: AxleState; onClose: () => void }) {
  const { end, template, data } = useEndInfo();
  const edit = useApp((s) => s.editEndCompliance);
  const [sel, setSel] = useState(1);
  const parts = template?.parts ?? [];
  const resolved = corner && state ? partMasses(corner, state.right, data) : [];
  const total = resolved.reduce((s, m) => s + m.mass, 0);
  const r = resolved[sel - 1];
  const given = data.masses?.find((m) => m.part === sel);

  /** The entry as the solver sees it: the stored one, or the defaults laid out as an editable entry. */
  const entry = (): PartMass => given ?? {
    part: sel, cog: { kind: 'none' }, zAxis: { kind: 'none' }, xzPlane: { kind: 'none' },
    mass: r?.mass ?? 1,
    inertia: r ? [r.J[0][0], r.J[1][1], r.J[2][2], r.J[0][1], r.J[0][2], r.J[1][2]] : [1, 1, 1, 0, 0, 0],
  };
  const update = (fn: (m: PartMass) => void) => edit((e) => {
    e.masses ??= [];
    let m = e.masses.find((x) => x.part === sel);
    if (!m) { m = structuredClone(entry()); e.masses.push(m); }
    fn(m);
  });
  const m = entry();
  const pickCog = (kind: AxisRef['kind']) => {
    if (kind === m.cog.kind) return;
    const first = template?.points.find((p) => !p.dummy)?.no ?? 1;
    update((x) => { x.cog = kind === 'none' ? { kind } : kind === 'point' ? { kind, point: first } : { kind, v: kind === 'rel' ? [0, 0, 0] : (r?.cog ?? [0, 0, 0]) }; });
  };
  const cog = m.cog;
  const fmt = (v: number) => v.toFixed(1);

  return (
    <Dlg title={`Part mass data and C of G (${end})`} onClose={onClose} wide>
      <div className="massgrid">
        <div className="partlist" role="listbox" aria-label="Parts">
          {parts.map((name, i) => {
            const has = data.masses?.some((x) => x.part === i + 1);
            return (
              <button key={i} role="option" aria-selected={sel === i + 1} className={sel === i + 1 ? 'on' : ''} onClick={() => setSel(i + 1)}>
                <b>{i + 1}</b> {name} <span className="muted small">{resolved[i] ? `${resolved[i].mass} kg` : ''}{has ? '' : ' default'}</span>
              </button>
            );
          })}
          <div className="muted small pad">Total mass {total.toFixed(2)} kg</div>
        </div>
        <div className="massdetail" data-testid="mass-detail">
          <b>Part {sel}: {parts[sel - 1]}</b>
          <div className="row">
            <label className="vlabel">Mass (kg)</label>
            <NumberCell value={m.mass} onCommit={(v) => update((x) => { x.mass = Math.max(0, v); })} />
            {!given && <span className="muted small">default; edit to set</span>}
          </div>
          <div className="row">
            <label className="vlabel">C of G</label>
            <select aria-label="C of G definition" value={cog.kind} onChange={(e) => pickCog(e.target.value as AxisRef['kind'])}>
              {(Object.keys(COG_LABEL) as AxisRef['kind'][]).map((k) => <option key={k} value={k}>{COG_LABEL[k]}</option>)}
            </select>
            {cog.kind === 'point' && (
              <select aria-label="C of G point" value={cog.point} onChange={(e) => update((x) => { x.cog = { kind: 'point', point: Number(e.target.value) }; })}>
                {template?.points.filter((p) => !p.dummy).map((p) => <option key={p.no} value={p.no}>{p.no} {p.label}</option>)}
              </select>
            )}
            {(cog.kind === 'rel' || cog.kind === 'abs') && [0, 1, 2].map((k) => (
              <NumberCell key={k} value={cog.v[k]} onCommit={(v) => update((x) => { if (x.cog.kind === 'rel' || x.cog.kind === 'abs') x.cog = { kind: x.cog.kind, v: x.cog.v.map((q, j) => (j === k ? v : q)) as Vec3 }; })} />
            ))}
          </div>
          {r && <div className="muted small" data-testid="mass-cog">C of G at ({r.cog.map(fmt).join(', ')}) mm in the current position</div>}
          <AxisEditor label="Point on local z axis" value={m.zAxis} fallback={[0, 0, 100]} onChange={(v) => update((x) => { x.zAxis = v; })} />
          <AxisEditor label="Point in local x-z plane" value={m.xzPlane} fallback={[100, 0, 0]} onChange={(v) => update((x) => { x.xzPlane = v; })} />
          <p className="muted small">Axis points are measured from the C of G; with none, the local axes are the global axes.</p>
          <div className="inertia">
            {INERTIA.map((h, k) => (
              <label key={h}>{h}<NumberCell value={m.inertia[k]} digits={2} onCommit={(v) => update((x) => { x.inertia[k] = v; })} /></label>
            ))}
          </div>
          <div className="muted small">Inertias in kg.mm² about the C of G, in the local axes.</div>
          <div className="row">
            <button disabled={!given} onClick={() => edit((e) => { e.masses = (e.masses ?? []).filter((x) => x.part !== sel); })}>Reset part to default</button>
          </div>
        </div>
      </div>
    </Dlg>
  );
}
