import { useMemo, useState } from 'react';
import { create } from 'zustand';
import {
  ballJointSeries, getTemplate, defaultSplineOptions, formatSplineData, formatSplineFits, listJointResults, listPointAtAllPositions, listPointsAtPosition,
  listPointsForUserPosition, MOTION_LABEL, MOTION_UNIT, MOTIONS, motionValues, SWEEP_VARIABLES,
  type EndAnalysis, type JointListing, type Motion, type RotationFrame, type SplineOptions, type SweepKind,
} from '@claudus/core';
import { useApp } from '../store';
import { useEffectiveCompliance } from '../derived';
import { files } from '../files';
import { Dlg } from './ComplianceDialogs';

/** The text result windows of SHARK's Results menu. */
export type ListingId =
  | 'splineFits' | 'splineData' | 'bushDeflections' | 'bushRotations' | 'bushForces'
  | 'pointsUser' | 'pointAll' | 'pointsAt' | 'ballRotations';

export const useListings = create<{ open: ListingId | null; setOpen: (id: ListingId | null) => void }>((set) => ({ open: null, setOpen: (open) => set({ open }) }));

const TITLES: Record<ListingId, string> = {
  splineFits: 'SDF spline fits',
  splineData: 'SDF spline data',
  bushDeflections: 'Bush deflections',
  bushRotations: 'Joint / bush rotations',
  bushForces: 'Bush forces',
  pointsUser: 'Point coordinates for a user position',
  pointAll: 'A point at all positions',
  pointsAt: 'All points at a position',
  ballRotations: 'Ball joint rotations',
};

const FILE_NAMES: Record<ListingId, string> = {
  splineFits: 'splinefits.sdf', splineData: 'splinedata.sdf', bushDeflections: 'bushdeflections.txt', bushRotations: 'jointrotations.txt',
  bushForces: 'bushforces.txt', pointsUser: 'points.txt', pointAll: 'pointpositions.txt', pointsAt: 'points.txt', ballRotations: 'ballrotations.txt',
};

export function ListingDialogs({ results }: { results?: EndAnalysis[] }) {
  const open = useListings((s) => s.open);
  const close = () => useListings.getState().setOpen(null);
  if (!open) return null;
  switch (open) {
    case 'splineFits':
    case 'splineData':
      return <SplineListing id={open} results={results} onClose={close} />;
    case 'bushDeflections': return <BushListing id={open} kind="deflection" onClose={close} />;
    case 'bushForces': return <BushListing id={open} kind="force" onClose={close} />;
    case 'bushRotations': return <BushListing id={open} kind="rotation" onClose={close} />;
    case 'pointsUser': return <PointsUserListing onClose={close} />;
    case 'pointAll': return <PointAllListing onClose={close} />;
    case 'pointsAt': return <PointsAtListing onClose={close} />;
    case 'ballRotations': return <BallRotations onClose={close} />;
  }
}

/** The listing window: readable, selectable text with copy and save. */
function TextWindow({ id, text, children }: { id: ListingId; text: string; children?: React.ReactNode }) {
  const name = useApp((s) => s.fileName);
  const [note, setNote] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote('Copied');
    } catch {
      setNote('Copy failed; select the text and use Ctrl+C');
    }
    setTimeout(() => setNote(''), 2500);
  };
  const save = () => files().save(name.replace(/\.dat$/i, '') + '-' + FILE_NAMES[id], text);
  return (
    <>
      {children}
      <div className="row">
        <button onClick={copy}>Copy</button>
        <button onClick={save}>Save…</button>
        <span className="muted small">{note}</span>
      </div>
      <textarea className="listing" readOnly spellCheck={false} value={text} aria-label={TITLES[id] + ' listing'} data-testid="listing-text" />
    </>
  );
}

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
  );
}

function MotionChecks({ value, onChange }: { value: Motion[]; onChange: (m: Motion[]) => void }) {
  return (
    <div className="row">
      {MOTIONS.map((m) => (
        <Check key={m} label={m === 'steer' ? 'Steer' : m === 'bump' ? 'Bump' : 'Roll'} on={value.includes(m)} onChange={(on) => onChange(MOTIONS.filter((x) => (x === m ? on : value.includes(x))))} />
      ))}
    </div>
  );
}

function useEndModel() {
  const model = useApp((s) => s.model);
  const end = useApp((s) => s.end);
  const compliant = useApp((s) => s.compliant);
  const comp = useEffectiveCompliance();
  return { model, end, compliant, comp, name: useApp((s) => s.fileName) };
}

/** Run a listing, turning a thrown error into text. */
function safe(fn: () => string): string {
  try {
    return fn();
  } catch (e) {
    return `Could not make the listing: ${(e as Error).message}`;
  }
}

/* ---------- SDF splines ---------- */

function SplineListing({ id, results, onClose }: { id: 'splineFits' | 'splineData'; results?: EndAnalysis[]; onClose: () => void }) {
  const { model, name } = useEndModel();
  const [o, setO] = useState<SplineOptions>(() => ({ ...defaultSplineOptions(), ends: (['front', 'rear'] as const).filter((e) => model[e]) }));
  const [pick, setPick] = useState(false);
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const all = useMemo(() => {
    const seen = new Map<string, string>();
    for (const k of Object.keys(SWEEP_VARIABLES) as SweepKind[]) for (const y of SWEEP_VARIABLES[k].ys) if (!seen.has(y.key)) seen.set(y.key, y.label);
    return [...seen];
  }, []);
  const text = useMemo(() => {
    if (!results) return 'Calculating…';
    return safe(() => (id === 'splineFits' ? formatSplineFits(model, results, o, name) : formatSplineData(model, results, o, name)));
  }, [id, model, results, o, name]);
  const selected = o.variables ?? [];
  return (
    <Dlg title={TITLES[id]} onClose={onClose} wide>
      <TextWindow id={id} text={text}>
        <div className="row wrap">
          <span className="muted">Articulation</span>
          {(['bump', 'roll', 'steer'] as SweepKind[]).map((k) => <Check key={k} label={k} on={o.sweeps.includes(k)} onChange={(on) => setO({ ...o, sweeps: toggle(o.sweeps, k, on) })} />)}
          <span className="muted">Ends</span>
          {(['front', 'rear'] as const).map((e) => <Check key={e} label={e} on={o.ends.includes(e)} onChange={(on) => setO({ ...o, ends: toggle(o.ends, e, on) })} />)}
          {id === 'splineFits' && (
            <>
              <span className="muted">Fit</span>
              <select aria-label="Fit order" value={o.order} onChange={(e) => setO({ ...o, order: Number(e.target.value) as 1 | 2 | 3 })}>
                <option value={1}>Linear</option>
                <option value={2}>Quadratic</option>
                <option value={3}>Cubic</option>
              </select>
            </>
          )}
          <Check label="Hard points and header" on={o.header} onChange={(on) => setO({ ...o, header: on })} />
          <button onClick={() => setPick(!pick)}>{selected.length ? `${selected.length} results chosen` : 'All results'} ▾</button>
        </div>
        {pick && (
          <div className="varpick" aria-label="Results to list">
            <button onClick={() => setO({ ...o, variables: [] })}>All</button>
            {all.map(([key, label]) => <Check key={key} label={label} on={selected.includes(key)} onChange={(on) => setO({ ...o, variables: toggle(selected, key, on) })} />)}
          </div>
        )}
      </TextWindow>
    </Dlg>
  );
}

/* ---------- bush results ---------- */

function BushListing({ id, kind, onClose }: { id: ListingId; kind: JointListing; onClose: () => void }) {
  const { model, end, compliant, comp, name } = useEndModel();
  const [motions, setMotions] = useState<Motion[]>(['bump']);
  const text = useMemo(() => (compliant ? safe(() => listJointResults(model, end, kind, comp, motions, name)) : 'Switch on the compliant solver (3D Compliance) to list joint results.'), [compliant, model, end, kind, comp, motions, name]);
  return (
    <Dlg title={`${TITLES[id]} (${end})`} onClose={onClose} wide>
      <TextWindow id={id} text={text}>
        <MotionChecks value={motions} onChange={setMotions} />
      </TextWindow>
    </Dlg>
  );
}

/* ---------- point coordinates ---------- */

function PointsUserListing({ onClose }: { onClose: () => void }) {
  const { model, end, compliant, comp, name } = useEndModel();
  const [bump, setBump] = useState('0');
  const [rack, setRack] = useState('0');
  const text = useMemo(() => {
    const b = Number(bump);
    const r = Number(rack);
    if (!Number.isFinite(b) || !Number.isFinite(r)) return 'Enter numbers for the bump and steer positions.';
    return safe(() => listPointsForUserPosition(model, end, b, r, compliant ? comp : undefined, name));
  }, [model, end, compliant, comp, bump, rack, name]);
  return (
    <Dlg title={`${TITLES.pointsUser} (${end})`} onClose={onClose} wide>
      <TextWindow id="pointsUser" text={text}>
        <div className="row">
          <label>Bump (mm, + is bump)</label>
          <input aria-label="Bump" className="numin" value={bump} onChange={(e) => setBump(e.target.value)} />
          <label>Steer, rack travel (mm)</label>
          <input aria-label="Steer" className="numin" value={rack} onChange={(e) => setRack(e.target.value)} />
        </div>
      </TextWindow>
    </Dlg>
  );
}

function usePointChoices(end: 'front' | 'rear') {
  const model = useApp((s) => s.model);
  const templatesRev = useApp((s) => s.templatesRev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listPoints(model, end), [model, end, templatesRev]);
}

function listPoints(model: ReturnType<typeof useApp.getState>['model'], end: 'front' | 'rear') {
  const data = model[end];
  if (!data) return [];
  return getTemplate(data.templateSlot).points.filter((p) => !p.dummy).map((p) => ({ no: p.no, label: p.label }));
}

function PointAllListing({ onClose }: { onClose: () => void }) {
  const { model, end, compliant, comp, name } = useEndModel();
  const choices = usePointChoices(end);
  const [point, setPoint] = useState<number | null>(null);
  const [motions, setMotions] = useState<Motion[]>(['bump', 'roll', 'steer']);
  const no = point ?? choices[0]?.no;
  const text = useMemo(() => (no === undefined ? 'This end has no points.' : safe(() => listPointAtAllPositions(model, end, no, motions, compliant ? comp : undefined, name))), [model, end, no, motions, compliant, comp, name]);
  return (
    <Dlg title={`${TITLES.pointAll} (${end})`} onClose={onClose} wide>
      <TextWindow id="pointAll" text={text}>
        <div className="row">
          <label>Point</label>
          <select aria-label="Point" value={no ?? ''} onChange={(e) => setPoint(Number(e.target.value))}>
            {choices.map((p) => <option key={p.no} value={p.no}>{p.no} {p.label}</option>)}
          </select>
          <MotionChecks value={motions} onChange={setMotions} />
        </div>
      </TextWindow>
    </Dlg>
  );
}

function PointsAtListing({ onClose }: { onClose: () => void }) {
  const { model, end, compliant, comp, name } = useEndModel();
  const [motion, setMotion] = useState<Motion>('bump');
  const values = useMemo(() => motionValues(model.params, motion), [model.params, motion]);
  const [pos, setPos] = useState<number | null>(null);
  const position = pos !== null && values.includes(pos) ? pos : values.reduce((b, v) => (Math.abs(v) < Math.abs(b) ? v : b), values[0] ?? 0);
  const text = useMemo(() => safe(() => listPointsAtPosition(model, end, motion, position, compliant ? comp : undefined, name)), [model, end, motion, position, compliant, comp, name]);
  return (
    <Dlg title={`${TITLES.pointsAt} (${end})`} onClose={onClose} wide>
      <TextWindow id="pointsAt" text={text}>
        <div className="row">
          <label>Articulation</label>
          <select aria-label="Articulation" value={motion} onChange={(e) => { setMotion(e.target.value as Motion); setPos(null); }}>
            {MOTIONS.map((m) => <option key={m} value={m}>{MOTION_LABEL[m]}</option>)}
          </select>
          <label>Position ({MOTION_UNIT[motion]})</label>
          <select aria-label="Position" value={position} onChange={(e) => setPos(Number(e.target.value))}>
            {values.map((v) => <option key={v} value={v}>{v.toFixed(2)}</option>)}
          </select>
        </div>
      </TextWindow>
    </Dlg>
  );
}

/* ---------- ball joint rotations ---------- */

function BallRotations({ onClose }: { onClose: () => void }) {
  const { model, end, compliant, comp } = useEndModel();
  const choices = usePointChoices(end);
  const t = model[end] ? getTemplate(model[end]!.templateSlot) : undefined;
  const joints = choices.filter((p) => {
    const tp = t?.points.find((q) => q.no === p.no);
    return tp && tp.part1 !== 0 && tp.part2 !== 0;
  });
  const [point, setPoint] = useState<number | null>(null);
  const [motion, setMotion] = useState<Motion>('bump');
  const [frame, setFrame] = useState<RotationFrame>('global');
  const [h1, setH1] = useState<number | null>(null);
  const [h2, setH2] = useState<number | null>(null);
  const [b1, setB1] = useState<number | null>(null);
  const [b2, setB2] = useState<number | null>(null);
  const no = point ?? joints[0]?.no;
  const pt = (v: number | null, k: number) => v ?? choices[Math.min(k, choices.length - 1)]?.no;
  const data = useMemo(() => {
    if (!compliant || no === undefined) return undefined;
    try {
      return ballJointSeries(model, end, comp, { point: no, motion, frame, housing: [pt(h1, 0), pt(h2, 1)] as [number, number], ball: [pt(b1, 2), pt(b2, 3)] as [number, number] });
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compliant, model, end, comp, no, motion, frame, h1, h2, b1, b2]);
  const pick = (label: string, v: number | undefined, set: (n: number) => void) => (
    <select aria-label={label} value={v ?? ''} onChange={(e) => set(Number(e.target.value))}>
      {choices.map((p) => <option key={p.no} value={p.no}>{p.no} {p.label}</option>)}
    </select>
  );
  return (
    <Dlg title={`${TITLES.ballRotations} (${end})`} onClose={onClose} wide>
      {!compliant ? <p className="muted">Switch on the compliant solver (3D Compliance) to see ball joint rotations.</p> : (
        <>
          <div className="row wrap">
            <label>Joint</label>
            <select aria-label="Joint" value={no ?? ''} onChange={(e) => setPoint(Number(e.target.value))}>
              {joints.map((p) => <option key={p.no} value={p.no}>{p.no} {p.label}</option>)}
            </select>
            <label>Travel</label>
            <select aria-label="Travel" value={motion} onChange={(e) => setMotion(e.target.value as Motion)}>
              {MOTIONS.map((m) => <option key={m} value={m}>{MOTION_LABEL[m]}</option>)}
            </select>
            <label>Axes</label>
            <select aria-label="Axes" value={frame} onChange={(e) => setFrame(e.target.value as RotationFrame)}>
              <option value="global">Global axes</option>
              <option value="local">Local (bush) axes</option>
              <option value="lines">Between two user lines</option>
            </select>
          </div>
          {frame === 'lines' && (
            <div className="row wrap">
              <label>Housing axis</label>{pick('Housing point 1', pt(h1, 0), setH1)}{pick('Housing point 2', pt(h2, 1), setH2)}
              <label>Ball axis</label>{pick('Ball point 1', pt(b1, 2), setB1)}{pick('Ball point 2', pt(b2, 3), setB2)}
            </div>
          )}
          <p className="muted small">Kinematic rotation of the joint from the static position, in degrees; the extra rotation due to compliance is not included.</p>
          {data && <RotationChart x={data.x} series={data.series} unit={MOTION_UNIT[motion]} />}
          {data && (
            <div className="tblwrap">
              <table className="ctable results" data-testid="ball-table">
                <thead><tr><th>{MOTION_LABEL[motion]} ({MOTION_UNIT[motion]})</th>{data.series.map((s) => <th key={s.label}>{s.label} (deg)</th>)}</tr></thead>
                <tbody>
                  {data.x.map((x, i) => (
                    <tr key={x}><td className="num">{x.toFixed(2)}</td>{data.series.map((s) => <td key={s.label} className="num">{Number.isFinite(s.y[i]) ? s.y[i].toFixed(4) : '–'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Dlg>
  );
}

const COLOURS = ['#e5484d', '#3fb950', '#4c9aff'];

function RotationChart({ x, series, unit }: { x: number[]; series: { label: string; y: number[] }[]; unit: string }) {
  const W = 640;
  const H = 200;
  const pad = 36;
  const ys = series.flatMap((s) => s.y).filter(Number.isFinite);
  if (!ys.length || x.length < 2) return null;
  const lo = Math.min(...ys, 0);
  const hi = Math.max(...ys, 0);
  const span = hi - lo || 1;
  const sx = (v: number) => pad + ((v - x[0]) / (x[x.length - 1] - x[0] || 1)) * (W - 2 * pad);
  const sy = (v: number) => H - pad / 1.4 - ((v - lo) / span) * (H - pad * 1.4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rotchart" role="img" aria-label="Joint rotation against travel">
      <line x1={pad} x2={W - pad} y1={sy(0)} y2={sy(0)} stroke="currentColor" opacity="0.3" />
      {series.map((s, k) => (
        <polyline key={s.label} fill="none" stroke={COLOURS[k % 3]} strokeWidth="1.5" points={s.y.map((v, i) => (Number.isFinite(v) ? `${sx(x[i])},${sy(v)}` : '')).filter(Boolean).join(' ')} />
      ))}
      <text x={pad} y={12} fontSize="10" fill="currentColor">{hi.toFixed(2)} deg</text>
      <text x={pad} y={H - 4} fontSize="10" fill="currentColor">{lo.toFixed(2)} deg</text>
      <text x={W - pad} y={H - 4} fontSize="10" fill="currentColor" textAnchor="end">{x[x.length - 1]} {unit}</text>
      {series.map((s, k) => <text key={s.label} x={W - pad - 90 * (series.length - k)} y={12} fontSize="10" fill={COLOURS[k % 3]}>{s.label}</text>)}
    </svg>
  );
}
