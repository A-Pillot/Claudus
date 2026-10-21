import { useMemo, useState } from 'react';
import {
  FRICTION_MODEL_LABELS, defaultFrictionInput, estimateFriction, fitChenFlynn, parseFrictionFile, type FollowerType, type FrictionInput, type FrictionModelName,
  type ValvetrainType,
} from '@claudus/engine';
import { useEngine } from '../store';
import { Check, DataSource, f2, Num, Sel, Stats } from './common';
import { ToolPlot } from './ToolPlot';

const NAMES = Object.keys(FRICTION_MODEL_LABELS) as FrictionModelName[];

export function FrictionTool() {
  const model = useEngine((s) => s.model);
  const setModel = useEngine((s) => s.setModel);
  const [text, setText] = useState('');
  const [f, setF] = useState<FrictionInput>(() => {
    const d = defaultFrictionInput();
    const c = useEngine.getState().model?.cylinders[0];
    const n = useEngine.getState().model?.cylinders.length;
    return c ? { ...d, bore: c.bore, stroke: c.stroke, compressionRatio: c.compressionRatio, cylinders: n ?? 4, mainBearings: (n ?? 4) + 1 } : d;
  });
  const [error, setError] = useState('');
  const [source, setSource] = useState<'mean' | FrictionModelName>('mean');
  const [pmaxRef, setPmaxRef] = useState(45);
  const [userBearings, setUserBearings] = useState(false);
  const [msg, setMsg] = useState('');
  const upd = (p: Partial<FrictionInput>) => setF((x) => ({ ...x, ...p }));

  const load = (t: string) => {
    setText(t);
    if (!t.trim()) return;
    try { const p = parseFrictionFile(t); setF(p); setUserBearings(p.mainDiameter !== undefined); setError(''); } catch (e) { setError((e as Error).message); }
  };

  const eff: FrictionInput = userBearings ? f : { ...f, mainDiameter: undefined, mainLength: undefined, crankpinDiameter: undefined, crankpinLength: undefined, camBearingDiameter: undefined, camBearingLength: undefined };
  const effKey = JSON.stringify(eff);
  const curves = useMemo(() => estimateFriction(JSON.parse(effKey) as FrictionInput), [effKey]);
  const fitY = source === 'mean' ? curves.mean : curves.models[source];
  const fit = useMemo(() => fitChenFlynn(curves.sp, fitY, { pmaxRef }), [curves, fitY, pmaxRef]);

  const apply = () => {
    if (!model) return;
    const r = (x: number) => Math.round(x * 1e5) / 1e5;
    setModel({ ...model, friction: { a: r(fit.a), b: r(fit.b), c: r(fit.c), d: r(fit.d) } });
    setMsg('Chen-Flynn coefficients applied to the model.');
  };
  const mid = curves.rpm.reduce((b, r, i) => (Math.abs(r - 3000) < Math.abs(curves.rpm[b] - 3000) ? i : b), 0);

  return (
    <div className="etools-body">
      <div className="etools-side">
        <DataSource label="Friction file (.fri)" accept=".fri,.txt" text={text} onText={load} rows={4} />
        {error && <p className="ewarn">{error}</p>}
        <fieldset>
          <legend>Engine</legend>
          <Num label="Bore (mm)" value={f.bore} onChange={(v) => upd({ bore: v })} />
          <Num label="Stroke (mm)" value={f.stroke} onChange={(v) => upd({ stroke: v })} />
          <Num label="Compression ratio" value={f.compressionRatio} onChange={(v) => upd({ compressionRatio: v })} />
          <Num label="Cylinders" value={f.cylinders} onChange={(v) => upd({ cylinders: Math.max(1, Math.round(v)) })} />
          <Num label="Main bearings" value={f.mainBearings} onChange={(v) => upd({ mainBearings: Math.max(1, Math.round(v)) })} />
          <Check label="User defined bearing sizes" value={userBearings} onChange={(v) => { setUserBearings(v); if (v) setF((x) => ({ ...x, mainDiameter: x.mainDiameter ?? 0.64 * x.bore, mainLength: x.mainLength ?? 0.26 * x.bore, crankpinDiameter: x.crankpinDiameter ?? 0.56 * x.bore, crankpinLength: x.crankpinLength ?? 0.23 * x.bore, camBearingDiameter: x.camBearingDiameter ?? 0.32 * x.bore, camBearingLength: x.camBearingLength ?? 0.19 * x.bore })); }} />
          {userBearings && (
            <>
              <Num label="Main dia / length (mm)" value={f.mainDiameter} onChange={(v) => upd({ mainDiameter: v })} />
              <Num label="" value={f.mainLength} onChange={(v) => upd({ mainLength: v })} />
              <Num label="Crankpin dia / length" value={f.crankpinDiameter} onChange={(v) => upd({ crankpinDiameter: v })} />
              <Num label="" value={f.crankpinLength} onChange={(v) => upd({ crankpinLength: v })} />
              <Num label="Cam bearing dia / length" value={f.camBearingDiameter} onChange={(v) => upd({ camBearingDiameter: v })} />
              <Num label="" value={f.camBearingLength} onChange={(v) => upd({ camBearingLength: v })} />
            </>
          )}
        </fieldset>
        <fieldset>
          <legend>Valvetrain</legend>
          <Sel<ValvetrainType> label="Type" value={f.valvetrain} options={[[1, 'Direct acting'], [2, 'Finger follower'], [3, 'Rocker arm'], [4, 'Pushrod']]} onChange={(v) => upd({ valvetrain: v })} />
          <Sel<FollowerType> label="Follower" value={f.follower} options={[['flat', 'Flat'], ['roller', 'Roller']]} onChange={(v) => upd({ follower: v })} />
          <Num label="Valves per cylinder" value={f.valvesPerCylinder} onChange={(v) => upd({ valvesPerCylinder: Math.round(v) })} />
          <Num label="Max valve lift (mm)" value={f.maxValveLift} onChange={(v) => upd({ maxValveLift: v })} />
        </fieldset>
        <fieldset>
          <legend>Load case</legend>
          <Num label="Start rpm" value={f.startRpm} onChange={(v) => upd({ startRpm: v })} />
          <Num label="End rpm" value={f.endRpm} onChange={(v) => upd({ endRpm: v })} />
          <Num label="Interval" value={f.stepRpm} onChange={(v) => upd({ stepRpm: Math.max(1, v) })} />
          <Num label="Load ratio" value={f.loadRatio} onChange={(v) => upd({ loadRatio: v })} step={0.05} />
          <Num label="Oil temperature (C)" value={f.oilTemperature ?? 90} onChange={(v) => upd({ oilTemperature: v })} />
        </fieldset>
      </div>
      <div className="etools-main">
        <p className="edim">FMEP excludes pumping work (the simulation calculates it).</p>
        <div className="etable-wrap">
          <table>
            <thead><tr><th className="l">Speed (rpm)</th><th>Sp (m/s)</th>{NAMES.map((n) => <th key={n} title={FRICTION_MODEL_LABELS[n]}>{n}</th>)}<th>Mean</th></tr></thead>
            <tbody>
              {curves.rpm.map((r, i) => (
                <tr key={r}><td className="l">{r}</td><td>{f2(curves.sp[i])}</td>{NAMES.map((n) => <td key={n}>{f2(curves.models[n][i], 3)}</td>)}<td>{f2(curves.mean[i], 3)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="eplots">
          <ToolPlot title="FMEP (bar)" x={curves.rpm} series={[...NAMES.map((n) => ({ label: FRICTION_MODEL_LABELS[n], y: curves.models[n] })), { label: 'Mean', y: curves.mean, dash: [6, 4], colour: '#ffffff' }]} xLabel="rpm" yLabel="FMEP (bar)" />
          <ToolPlot title="Friction power (kW)" x={curves.rpm} series={NAMES.map((n) => ({ label: n, y: curves.power[n] }))} xLabel="rpm" yLabel="kW" />
        </div>
        <fieldset>
          <legend>Chen-Flynn fit: FMEP = a + b pmax + c Sp + d Sp^2</legend>
          <div className="erow">
            <label className="ef wide" style={{ width: 280 }}>Fit to
              <select value={source} onChange={(e) => setSource(e.target.value as 'mean' | FrictionModelName)}>
                <option value="mean">Mean of models</option>
                {NAMES.map((n) => <option key={n} value={n}>{FRICTION_MODEL_LABELS[n]}</option>)}
              </select>
            </label>
            <Num label="Reference pmax (bar)" value={pmaxRef} onChange={setPmaxRef} />
          </div>
          <Stats items={[['a (bar)', f2(fit.a, 4)], ['b', f2(fit.b, 4)], ['c', f2(fit.c, 4)], ['d', f2(fit.d, 5)], ['RMS error (bar)', f2(fit.rms, 3)], ['FMEP near 3000 rpm', f2(fitY[mid], 2)]]} />
          <div className="erow">
            <button className="primary" disabled={!model} onClick={apply}>Apply to model</button>
            {msg && <span className="egood">{msg}</span>}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
