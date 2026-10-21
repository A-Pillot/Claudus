import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COEFFICIENTS, Corner, GenType, NONE, complianceCoefficients, defaultBush, defaultCompliance, defaultSettings, endCompliance, findGen, getTemplate, hasTemplate,
  type AxisRef, type AxleState, type BushData, type ComplianceResult, type End, type EndCompliance, type Template, type Vec3,
} from '@claudus/core';
import { useApp } from '../store';
import { NumberCell } from './PointTable';
import { CoefficientsDialog } from './CoefficientBars';
import { DamperDialog, TyreDialog } from './DataDialogs';
import { fmtUnit, labelUnit, unitText, useUnitSettings } from '../units';

/** A text input that commits on Enter or blur. */
export function TextCell({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={className}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Dlg({ title, onClose, wide, float, children }: { title: string; onClose: () => void; wide?: boolean; float?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className={'modal' + (float ? ' float' : '')} onClick={onClose}>
      <div className={'dialog compl' + (wide ? ' wide' : '')} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <div className="actions"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

export function useEndInfo() {
  const end = useApp((s) => s.end);
  const sdata = useApp((s) => s.model[s.end]);
  const compliance = useApp((s) => s.model.compliance);
  const template: Template | undefined = sdata && hasTemplate(sdata.templateSlot) ? getTemplate(sdata.templateSlot) : undefined;
  return { end, template, data: endCompliance(compliance, end), compliance };
}

export const fmt = (v: number, d = 3, unit?: string) => (unit ? fmtUnit(unit, v, d) : Number.isFinite(v) ? v.toFixed(d) : '–');

export function ComplianceDialogs({ corner, state, detail }: { corner?: Corner; state?: AxleState; detail?: ComplianceResult }) {
  const dialog = useApp((s) => s.dialog);
  const setDialog = useApp((s) => s.setDialog);
  const close = () => setDialog(null);
  switch (dialog) {
    case 'bushes': return <BushDialog onClose={close} />;
    case 'bushSliders': return <SliderDialog onClose={close} state={state} />;
    case 'springs': return <SpringDialog onClose={close} />;
    case 'dampers': return <DamperDialog onClose={close} />;
    case 'tyre': return <TyreDialog onClose={close} showRate />;
    case 'rollbar': return <ValuesDialog title="Roll bar rate" onClose={close} note="Used only when the template has a roll bar." fields={(e) => [['Torsional rate (N.mm/deg)', e.rollBarRate, (x, v) => { x.rollBarRate = v; }]]} />;
    case 'general': return <GeneralDialog onClose={close} />;
    case 'forces': return <ForcesDialog onClose={close} />;
    case 'coefficients': return <CoefficientsDialog onClose={close} />;
    case 'joints': return <JointsDialog onClose={close} corner={corner} detail={detail} />;
    case 'loads': return <LoadsDialog onClose={close} corner={corner} detail={detail} />;
    default: return null;
  }
}

/* ---------- bushes ---------- */

const KIND_LABEL: Record<AxisRef['kind'], string> = { none: 'None (global axes)', point: 'Model point', rel: 'Relative', abs: 'Absolute' };

export function AxisEditor({ label, value, onChange, fallback }: { label: string; value: AxisRef; onChange: (r: AxisRef) => void; fallback: Vec3 }) {
  const { template } = useEndInfo();
  const first = template?.points.find((p) => !p.dummy)?.no ?? 1;
  const pick = (kind: AxisRef['kind']) => {
    if (kind === value.kind) return;
    onChange(kind === 'none' ? { kind } : kind === 'point' ? { kind, point: first } : { kind, v: fallback });
  };
  return (
    <div className="row">
      <label className="vlabel">{label}</label>
      <select aria-label={label + ' definition'} value={value.kind} onChange={(e) => pick(e.target.value as AxisRef['kind'])}>
        {(Object.keys(KIND_LABEL) as AxisRef['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      {value.kind === 'point' && (
        <select aria-label={label + ' point'} value={value.point} onChange={(e) => onChange({ kind: 'point', point: Number(e.target.value) })}>
          {template?.points.filter((p) => !p.dummy).map((p) => <option key={p.no} value={p.no}>{p.no} {p.label}</option>)}
        </select>
      )}
      {(value.kind === 'rel' || value.kind === 'abs') && [0, 1, 2].map((k) => (
        <NumberCell key={k} unit="mm" value={value.v[k]} onCommit={(x) => onChange({ kind: value.kind, v: value.v.map((q, j) => (j === k ? x : q)) as Vec3 } as AxisRef)} />
      ))}
    </div>
  );
}

const STIFF_HEAD = ['kx', 'ky', 'kz', 'krx', 'kry', 'krz'];

function BushDialog({ onClose }: { onClose: () => void }) {
  useUnitSettings();
  const { end, template, data, compliance } = useEndInfo();
  const edit = useApp((s) => s.editEndCompliance);
  const lossDefault = compliance?.settings.lossAngle ?? defaultSettings().lossAngle;
  const [sel, setSel] = useState<number | null>(null);
  const joints = template?.points.filter((p) => !p.dummy && p.part1 !== NONE && p.part2 !== NONE) ?? [];
  const bush = (no: number) => data.bushes.find((b) => b.point === no);
  const setBush = (no: number, fn: (b: BushData) => void) => edit((e) => { const b = e.bushes.find((x) => x.point === no); if (b) fn(b); });
  const toggle = (no: number, on: boolean) => edit((e) => {
    e.bushes = e.bushes.filter((b) => b.point !== no);
    if (on) e.bushes.push(defaultBush(no));
  });
  const b = sel !== null ? bush(sel) : undefined;
  const jp = joints.find((p) => p.no === sel);
  return (
    <Dlg title={`Bush properties (${end})`} onClose={onClose} wide>
      <p className="muted small">Joints are rigid ball joints until made a bush. Translational stiffness in {unitText('N/mm')}, rotational in {unitText('N·m/rad')}, in the bush's own axes.</p>
      <div className="tblwrap">
        <table className="ctable">
          <thead><tr><th>No</th><th>Joint</th><th>Bush</th>{STIFF_HEAD.map((h) => <th key={h}>{h}</th>)}<th>Z axis</th></tr></thead>
          <tbody>
            {joints.map((p) => {
              const bu = bush(p.no);
              return (
                <tr key={p.no} className={sel === p.no ? 'sel' : ''} onClick={() => setSel(p.no)}>
                  <td className="no">{p.no}</td>
                  <td className="label" title={p.label}>{p.label}</td>
                  <td><input type="checkbox" aria-label={`Bush at point ${p.no}`} checked={!!bu} onChange={(e) => toggle(p.no, e.target.checked)} /></td>
                  {STIFF_HEAD.map((_, k) => (
                    <td key={k}>{bu ? <NumberCell unit={k < 3 ? 'N/mm' : 'N·m/rad'} value={bu.stiffness[k]} onCommit={(v) => setBush(p.no, (x) => { x.stiffness[k] = v; })} /> : <span className="muted">rigid</span>}</td>
                  ))}
                  <td className="muted">{bu ? KIND_LABEL[bu.zAxis.kind] : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {b && jp && (
        <div className="bushdetail">
          <b>Point {jp.no}: {jp.label}</b>
          <AxisEditor label="Local z axis" value={b.zAxis} fallback={[0, 0, 100]} onChange={(r) => setBush(b.point, (x) => { x.zAxis = r; })} />
          <AxisEditor label="Point in x-z plane" value={b.xzPlane} fallback={[100, 0, 0]} onChange={(r) => setBush(b.point, (x) => { x.xzPlane = r; })} />
          <div className="row">
            <label className="vlabel">Loss angle ({unitText('deg')})</label>
            <NumberCell unit="deg" value={b.lossAngle ?? lossDefault} onCommit={(v) => setBush(b.point, (x) => { x.lossAngle = v; })} />
            <span className="muted small">default {fmtUnit('deg', lossDefault, 3).replace(/\.?0+$/, '')}</span>
          </div>
        </div>
      )}
      {sel !== null && !b && <p className="muted small">Point {sel} is a rigid ball joint. Tick Bush to make it compliant.</p>}
    </Dlg>
  );
}

/** Slider position (0..600) to stiffness: 0 is zero, then a log scale from 1 up to about 1e6. */
const toStiff = (t: number) => (t <= 0 ? 0 : Math.round(10 ** ((t - 1) / 100) * 100) / 100);
const fromStiff = (v: number) => (v <= 0 ? 0 : Math.min(600, Math.max(1, Math.round(Math.log10(v) * 100) + 1)));

function SliderDialog({ onClose, state }: { onClose: () => void; state?: AxleState }) {
  useUnitSettings();
  const { end, template, data } = useEndInfo();
  const bushPoint = useApp((s) => s.bushPoint);
  const setBushPoint = useApp((s) => s.setBushPoint);
  const edit = useApp((s) => s.editEndCompliance);
  const bush = data.bushes.find((b) => b.point === bushPoint) ?? data.bushes[0];
  const label = (no: number) => template?.points.find((p) => p.no === no)?.label ?? '';
  const set = (k: number, v: number) => edit((e) => { const b = e.bushes.find((x) => x.point === bush.point); if (b) b.stiffness[k] = v; });
  const g = state?.geometryRight;
  return (
    <Dlg title={`Bush stiffness (${end})`} onClose={onClose} float>
      {bush ? (
        <>
          <select aria-label="Bush" value={bush.point} onChange={(e) => setBushPoint(Number(e.target.value))}>
            {data.bushes.map((b) => <option key={b.point} value={b.point}>{b.point} {label(b.point)}</option>)}
          </select>
          {STIFF_HEAD.map((h, k) => (
            <div className="row" key={h}>
              <label className="vlabel short">{h} ({unitText(k < 3 ? 'N/mm' : 'N·m/rad')})</label>
              <input type="range" aria-label={h} min={0} max={600} value={fromStiff(bush.stiffness[k])} onChange={(e) => set(k, toStiff(Number(e.target.value)))} />
              <NumberCell unit={k < 3 ? 'N/mm' : 'N·m/rad'} value={bush.stiffness[k]} onCommit={(v) => set(k, Math.max(0, v))} />
            </div>
          ))}
          {g && <div className="live-line" data-testid="slider-live">Toe {fmt(g.toeSae, 3, 'deg')}{unitText('°')}  Camber {fmt(g.camber, 3, 'deg')}{unitText('°')}  Castor {fmt(g.castor, 3, 'deg')}{unitText('°')}</div>}
        </>
      ) : (
        <p className="muted">This end has no bushes yet. Make a joint compliant in Bush properties first.</p>
      )}
    </Dlg>
  );
}

/* ---------- simple property dialogs ---------- */

function ValuesDialog({ title, onClose, fields, note }: { title: string; onClose: () => void; note?: string; fields: (e: EndCompliance) => [string, number, (e: EndCompliance, v: number) => void][] }) {
  const { end, data } = useEndInfo();
  const edit = useApp((s) => s.editEndCompliance);
  useUnitSettings();
  return (
    <Dlg title={`${title} (${end})`} onClose={onClose}>
      {fields(data).map(([label, value, apply]) => (
        <div className="row" key={label}>
          <label className="vlabel wide">{labelUnit(label).label}</label>
          <NumberCell unit={labelUnit(label).unit} value={value} onCommit={(v) => edit((e) => apply(e, v))} />
        </div>
      ))}
      {note && <p className="muted small">{note}</p>}
    </Dlg>
  );
}

function SpringDialog({ onClose }: { onClose: () => void }) {
  useUnitSettings();
  const { end, template, data } = useEndInfo();
  const edit = useApp((s) => s.editEndCompliance);
  const has = [template && findGen(template, GenType.Spring1ToSuspension), template && findGen(template, GenType.Spring2ToSuspension)];
  return (
    <Dlg title={`Spring properties (${end})`} onClose={onClose}>
      {[0, 1].map((k) => (
        <fieldset key={k} disabled={!has[k]}>
          <legend>Spring {k + 1}{has[k] ? '' : ' (not in this template)'}</legend>
          {([['Rate (N/mm)', 'rate'], ['Free length (mm)', 'freeLength'], ['Fitted length (mm)', 'fittedLength']] as const).map(([label, key]) => (
            <div className="row" key={key}>
              <label className="vlabel">{labelUnit(label).label}</label>
              <NumberCell unit={labelUnit(label).unit} value={data.springs[k][key]} onCommit={(v) => edit((e) => { e.springs[k][key] = v; })} />
            </div>
          ))}
        </fieldset>
      ))}
    </Dlg>
  );
}

function GeneralDialog({ onClose }: { onClose: () => void }) {
  useUnitSettings();
  const settings = useApp((s) => s.model.compliance?.settings) ?? defaultSettings();
  const edit = useApp((s) => s.editCompliance);
  const num: [string, 'singularity' | 'rigid' | 'rigidRotation' | 'lossAngle'][] = [
    ['Singularity stiffness (N/mm)', 'singularity'], ['Rigid joint stiffness (N/mm)', 'rigid'],
    ['Rigid rotation stiffness (N.mm/deg)', 'rigidRotation'], ['Default bush loss angle (deg)', 'lossAngle'],
  ];
  return (
    <Dlg title="General compliance data" onClose={onClose}>
      {num.map(([label, key]) => (
        <div className="row" key={key}>
          <label className="vlabel wide">{labelUnit(label).label}</label>
          <NumberCell unit={labelUnit(label).unit} value={settings[key]} onCommit={(v) => edit((c) => { c.settings[key] = v; })} />
        </div>
      ))}
      <label className="check"><input type="checkbox" checked={settings.includeSpring} onChange={(e) => edit((c) => { c.settings.includeSpring = e.target.checked; })} /> Include spring force</label>
    </Dlg>
  );
}

/* ---------- external forces ---------- */

function ForcesDialog({ onClose }: { onClose: () => void }) {
  useUnitSettings();
  const stored = useApp((s) => s.model.compliance);
  const edit = useApp((s) => s.editCompliance);
  const model = useApp((s) => s.model);
  // Until the first edit the model has no compliance data; show the defaults it would get.
  const compliance = useMemo(() => stored ?? defaultCompliance(), [stored]);
  const sets = compliance.forceSets;
  const [si, setSi] = useState(0);
  const [fi, setFi] = useState(0);
  const set = sets[Math.min(si, sets.length - 1)];
  const force = set?.forces[Math.min(fi, set.forces.length - 1)];
  const partsOf = (e: End) => { const d = model[e]; return d && hasTemplate(d.templateSlot) ? getTemplate(d.templateSlot).parts.length : 0; };
  const front = useApp.getState().end;
  return (
    <Dlg title="External forces" onClose={onClose} wide>
      {!stored && <p className="muted small">This model has no compliance data yet. Any edit here creates the default data.</p>}
      <div className="forcesgrid">
        <div className="setlist">
          <b>Force sets</b>
          {sets.map((s, i) => (
            <div key={i} className={'setrow' + (i === si ? ' sel' : '')} onClick={() => { setSi(i); setFi(0); }}>
              <input type="checkbox" aria-label={`Set ${i} on`} title="On" checked={s.on} onChange={(e) => edit((c) => { c.forceSets[i].on = e.target.checked; })} />
              <input type="radio" aria-label={`Set ${i} active`} title="Active set" checked={compliance.activeSet === i} onChange={() => edit((c) => { c.activeSet = i; })} />
              <span className="no">{i}</span>
              <TextCell value={s.label} onCommit={(v) => edit((c) => { c.forceSets[i].label = v; })} />
            </div>
          ))}
          <div className="row">
            <button onClick={() => { edit((c) => { c.forceSets.push({ label: `Set ${c.forceSets.length}`, on: true, forces: [] }); }); setSi(sets.length); setFi(0); }}>Add set</button>
            <button disabled={!set || sets.length <= 1} onClick={() => { edit((c) => { c.forceSets.splice(si, 1); c.activeSet = Math.min(c.activeSet > si ? c.activeSet - 1 : c.activeSet, c.forceSets.length - 1); }); setSi(0); setFi(0); }}>Delete set</button>
          </div>
        </div>
        <div>
          <b>Forces in set {si}{set ? `: ${set.label}` : ''}</b>
          <div className="tblwrap">
            <table className="ctable">
              <thead><tr><th>On</th><th>Label</th><th>End</th><th>Part</th><th>At pt</th><th colSpan={3}>Head (x y z, {unitText('mm')})</th><th colSpan={3}>Tail (x y z, {unitText('mm')})</th><th>Force {unitText('N')}</th></tr></thead>
              <tbody>
                {set?.forces.map((f, i) => (
                  <tr key={i} className={i === fi ? 'sel' : ''} onClick={() => setFi(i)}>
                    <td><input type="checkbox" aria-label={`Force ${i} on`} checked={f.on} onChange={(e) => edit((c) => { c.forceSets[si].forces[i].on = e.target.checked; })} /></td>
                    <td><TextCell className="textcell" value={f.label} onCommit={(v) => edit((c) => { c.forceSets[si].forces[i].label = v; })} /></td>
                    <td>
                      <select aria-label="End" value={f.end} onChange={(e) => edit((c) => { c.forceSets[si].forces[i].end = e.target.value as End; })}>
                        {(['front', 'rear'] as End[]).filter((e) => model[e]).map((e) => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </td>
                    <td title={`0 = wheel part, 1..${partsOf(f.end)}`}><NumberCell value={f.part} digits={0} onCommit={(v) => edit((c) => { c.forceSets[si].forces[i].part = Math.max(0, Math.round(v)); })} /></td>
                    <td title="0 = tyre contact point"><NumberCell value={f.at} digits={0} onCommit={(v) => edit((c) => { c.forceSets[si].forces[i].at = Math.max(0, Math.round(v)); })} /></td>
                    {(['head', 'tail'] as const).flatMap((key) => [0, 1, 2].map((k) => (
                      <td key={key + k}><NumberCell unit="mm" value={f[key][k]} onCommit={(v) => edit((c) => { c.forceSets[si].forces[i][key][k] = v; })} /></td>
                    )))}
                    <td><NumberCell unit="N" value={f.magnitude} onCommit={(v) => edit((c) => { c.forceSets[si].forces[i].magnitude = v; })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">The force acts at the head, pointing from tail to head. Head and tail are offsets from the point "At pt" (0 is the tyre contact point). Part 0 is the part carrying the wheel.</p>
          <div className="row">
            <button disabled={!set} onClick={() => { edit((c) => { c.forceSets[si].forces.push({ label: `Force ${c.forceSets[si].forces.length + 1}`, on: true, end: front, part: 0, at: 0, head: [0, 0, 0], tail: [0, 0, -100], magnitude: 1000 }); }); setFi(set?.forces.length ?? 0); }}>Add force</button>
            <button disabled={!force} onClick={() => { edit((c) => { c.forceSets[si].forces.splice(fi, 1); }); setFi(0); }}>Delete force</button>
          </div>
        </div>
      </div>
    </Dlg>
  );
}

/* ---------- result tables ---------- */

function JointsDialog({ onClose, corner, detail }: { onClose: () => void; corner?: Corner; detail?: ComplianceResult }) {
  useUnitSettings();
  const [frame, setFrame] = useState<'global' | 'local'>('global');
  const compliant = useApp((s) => s.compliant);
  const label = (no: number) => corner?.template.points.find((p) => p.no === no)?.label ?? '';
  return (
    <Dlg title="Joint deflections and forces" onClose={onClose} wide>
      {!compliant || !detail ? <p className="muted">Switch on the compliant solver to see joint results.</p> : (
        <>
          <div className="seg">
            <button className={frame === 'global' ? 'on' : ''} onClick={() => setFrame('global')}>Global axes</button>
            <button className={frame === 'local' ? 'on' : ''} onClick={() => setFrame('local')}>Bush local axes</button>
          </div>
          <p className="muted small">Right-hand corner at the current position. Deflection of part 1 relative to part 2 ({unitText('mm')}); force carried by the joint ({unitText('N')}).</p>
          <div className="tblwrap">
            <table className="ctable results">
              <thead><tr><th>No</th><th>Joint</th><th>Type</th><th>Defl X</th><th>Defl Y</th><th>Defl Z</th><th>Force X</th><th>Force Y</th><th>Force Z</th></tr></thead>
              <tbody>
                {detail.joints.map((j, i) => {
                  const d = frame === 'global' ? j.deflection : j.deflectionLocal;
                  const f = frame === 'global' ? j.force : j.forceLocal;
                  return (
                    <tr key={i}>
                      <td className="no">{j.point}</td>
                      <td className="label">{label(j.point)}</td>
                      <td>{j.bushed ? 'Bush' : 'Rigid'}</td>
                      {d.map((v, k) => <td key={'d' + k} className="num">{fmt(v, 4, 'mm')}</td>)}
                      {f.map((v, k) => <td key={'f' + k} className="num">{fmt(v, 1, 'N')}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Dlg>
  );
}

function LoadsDialog({ onClose, corner, detail }: { onClose: () => void; corner?: Corner; detail?: ComplianceResult }) {
  useUnitSettings();
  const compliant = useApp((s) => s.compliant);
  return (
    <Dlg title="Spring and tyre loads" onClose={onClose}>
      {!compliant || !detail ? <p className="muted">Switch on the compliant solver to see loads.</p> : (
        <table className="ctable results">
          <thead><tr><th>Item</th><th>Load ({unitText('N')})</th></tr></thead>
          <tbody>
            {detail.springForces.map((f, k) => Number.isFinite(f) && <tr key={'s' + k}><td>Spring {k + 1} (+ compression)</td><td className="num">{fmt(f, 1, 'N')}</td></tr>)}
            {detail.tyreLoads.map((f, k) => <tr key={'t' + k}><td>Tyre vertical load{corner && corner.sides.length > 1 ? (k === 0 ? ' (right)' : ' (left)') : ''}</td><td className="num">{fmt(f, 1, 'N')}</td></tr>)}
          </tbody>
        </table>
      )}
    </Dlg>
  );
}
