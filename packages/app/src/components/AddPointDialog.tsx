import { useState } from 'react';
import { dataPoints, getTemplate, GROUND, hasTemplate, type Vec3 } from '@claudus/core';
import { useApp } from '../store';
import { addPointNow, pickInView, placement, setCogNow, useDataUi, type PlaceMode } from '../dataUi';
import { fmtUnit, unitText, useUnitSettings } from '../units';
import { Dlg } from './ComplianceDialogs';
import { NumberCell } from './PointTable';

const MODES: [PlaceMode, string][] = [['abs', 'Absolute position'], ['rel', 'Relative to a point'], ['between', 'Between two points']];

/** Edit / Add Point (to the body or a part) and Edit / Add to Model / Part C of G, each absolute, relative or between points. */
export function AddPointDialog() {
  useUnitSettings();
  const add = useDataUi((s) => s.add);
  const setAdd = useDataUi((s) => s.setAdd);
  const setDialog = useDataUi((s) => s.setDialog);
  const data = useApp((s) => s.model[s.end]);
  const end = useApp((s) => s.end);
  const [error, setError] = useState<string | null>(null);
  const t = data && hasTemplate(data.templateSlot) ? getTemplate(data.templateSlot) : undefined;
  if (!data || !t) return <Dlg title="Add point" onClose={() => setDialog(null)}><p className="bad">There is no suspension at the {end} end.</p></Dlg>;

  const cog = add.what === 'cog';
  const onPart = (no: number) => {
    const p = dataPoints(t).find((q) => q.no === no);
    return !!p && (add.part === GROUND ? p.part1 === GROUND || p.part2 === GROUND : p.part1 === add.part || p.part2 === add.part);
  };
  const choices = dataPoints(t).filter((p) => onPart(p.no));
  const refs = add.refs.filter(onPart);
  let preview = '';
  try {
    preview = (placement({ ...add, refs }, t, data.points) as Vec3).map((v) => fmtUnit('mm', v, 1)).join(', ');
  } catch {
    preview = '–';
  }
  const need = add.mode === 'rel' ? 1 : add.mode === 'between' ? 2 : 0;

  const pick = () => {
    setDialog(null);
    pickInView(cog ? 'Part C of G' : 'Add point', need === 1 ? ['point on the part to measure from'] : ['first point', 'second point'], (picked) => {
      setAdd({ refs: picked });
      setDialog('addPoint');
    });
  };
  const submit = () => {
    try {
      if (need && refs.length < need) throw new Error(need === 1 ? 'Choose the point to measure from.' : 'Choose two points.');
      const a = { ...add, refs };
      if (cog) setCogNow(a);
      else addPointNow(a);
      setDialog(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const setRef = (i: number, no: number) => setAdd({ refs: [0, 1].slice(0, Math.max(need, i + 1)).map((k) => (k === i ? no : refs[k] ?? choices[0]?.no ?? 0)) });
  const pointSelect = (i: number) => (
    <select aria-label={`Point ${i + 1}`} value={refs[i] ?? ''} onChange={(e) => setRef(i, Number(e.target.value))}>
      <option value="" disabled>choose…</option>
      {choices.map((p) => <option key={p.no} value={p.no}>{p.no} {p.label}</option>)}
    </select>
  );

  return (
    <Dlg title={cog ? 'Add part C of G' : `Add point to ${add.part === GROUND ? 'the body' : 'a part'}`} onClose={() => setDialog(null)}>
      <div className="row">
        <label className="vlabel">{cog ? 'Part' : 'Attach to'}</label>
        <select aria-label="Part" value={add.part} onChange={(e) => setAdd({ part: Number(e.target.value), refs: [] })}>
          {!cog && <option value={GROUND}>Body (ground)</option>}
          {t.parts.map((p, i) => <option key={i} value={i + 1}>{i + 1} {p}</option>)}
        </select>
      </div>
      {!cog && (
        <div className="row">
          <label className="vlabel">Label</label>
          <input className="grow" aria-label="Label" value={add.label} placeholder={`Point ${Math.max(0, ...t.points.map((p) => p.no)) + 1}`} onChange={(e) => setAdd({ label: e.target.value })} />
        </div>
      )}
      <div className="seg" role="group" aria-label="Placement">
        {MODES.map(([m, label]) => <button key={m} className={add.mode === m ? 'on' : ''} onClick={() => setAdd({ mode: m, refs: [] })}>{label}</button>)}
      </div>
      {add.mode === 'abs' && (
        <div className="row">
          <label className="vlabel">Position ({unitText('mm')})</label>
          {[0, 1, 2].map((k) => <NumberCell key={k} unit="mm" value={add.abs[k]} onCommit={(v) => setAdd({ abs: add.abs.map((q, j) => (j === k ? v : q)) as Vec3 })} />)}
        </div>
      )}
      {add.mode === 'rel' && (
        <>
          <div className="row"><label className="vlabel">Measured from</label>{pointSelect(0)}<button onClick={pick}>Pick in view</button></div>
          <div className="row">
            <label className="vlabel">Offset ({unitText('mm')})</label>
            {[0, 1, 2].map((k) => <NumberCell key={k} unit="mm" value={add.offset[k]} onCommit={(v) => setAdd({ offset: add.offset.map((q, j) => (j === k ? v : q)) as Vec3 })} />)}
          </div>
        </>
      )}
      {add.mode === 'between' && (
        <>
          <div className="row"><label className="vlabel">From</label>{pointSelect(0)}<label>to</label>{pointSelect(1)}<button onClick={pick}>Pick in view</button></div>
          <div className="row">
            <label className="vlabel">Fraction of the way</label>
            <NumberCell value={add.fraction} digits={3} onCommit={(v) => setAdd({ fraction: v })} />
            <span className="muted small">0.5 is midway</span>
          </div>
        </>
      )}
      <p className="muted small" data-testid="add-preview">Position: {preview} {unitText('mm')}</p>
      {!cog && <p className="muted small">The point is added to the template (a built-in template is copied to a new custom number first); save the template to keep it.</p>}
      {error && <p className="bad">{error}</p>}
      <div className="row"><span className="grow" /><button className="primary" onClick={submit}>{cog ? 'Set C of G' : 'Add point'}</button></div>
    </Dlg>
  );
}

/** Start the dialog for a body or part point, or a part C of G. */
export function openAddPoint(what: 'point' | 'cog', part: 'ground' | 'part', mode: PlaceMode): void {
  const { setAdd, setDialog } = useDataUi.getState();
  const last = useDataUi.getState().add.part;
  setAdd({ what, part: part === 'ground' ? GROUND : last > 0 ? last : 1, mode, refs: [], label: '' });
  setDialog('addPoint');
}
