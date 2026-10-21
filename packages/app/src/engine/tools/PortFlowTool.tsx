import { useMemo, useState } from 'react';
import { analysePortFlowWithLift, applyCdToValve, parseLiftFile, parsePortFlowFile, type AreaBasis, type PortFlowData } from '@claudus/engine';
import { useEngine } from '../store';
import { DataSource, f2, Num, Sel, Stats } from './common';
import { ToolPlot } from './ToolPlot';

export function PortFlowTool() {
  const model = useEngine((s) => s.model);
  const setModel = useEngine((s) => s.setModel);
  const [text, setText] = useState('');
  const [liftText, setLiftText] = useState('');
  const [data, setData] = useState<PortFlowData | null>(null);
  const [error, setError] = useState('');
  const [basis, setBasis] = useState<AreaBasis>('min');
  const [targets, setTargets] = useState<number[]>([]);
  const [msg, setMsg] = useState('');

  const load = (t: string) => {
    setText(t);
    setMsg('');
    if (!t.trim()) { setData(null); setError(''); return; }
    try {
      const d = parsePortFlowFile(t);
      if (!d.rows.length) throw new Error('No flow rows found in the file');
      setData(d); setError('');
      setTargets([]);
    } catch (e) { setData(null); setError((e as Error).message); }
  };
  const upd = (p: Partial<PortFlowData>) => data && setData({ ...data, ...p });

  const lft = useMemo(() => (liftText.trim() ? parseLiftFile(liftText) : undefined), [liftText]);
  const res = useMemo(() => (data ? analysePortFlowWithLift(data, lft, { areaBasis: basis }) : null), [data, lft, basis]);

  const candidates = model ? model.valves.filter((v) => v.kind === (data?.valve ?? 'intake')) : [];
  const apply = () => {
    if (!model || !res) return;
    const ids = new Set(targets);
    setModel({ ...model, valves: model.valves.map((v) => (ids.has(v.id) ? applyCdToValve(v, res.cdTable) : v)) });
    setMsg(`Cd table applied to ${ids.size} valve${ids.size === 1 ? '' : 's'}.`);
  };
  const swirlRows = res?.points.some((p) => p.swirl !== undefined);

  return (
    <div className="etools-body">
      <div className="etools-side">
        <DataSource label="Port flow file (.blo)" accept=".blo,.txt" text={text} onText={load} rows={6} />
        <DataSource label="Lift curve (.lft, optional)" accept=".lft,.txt" text={liftText} onText={setLiftText} rows={3} />
        {error && <p className="ewarn">{error}</p>}
        {data && (
          <>
            <fieldset>
              <legend>{data.title || 'Port flow data'}</legend>
              <Sel label="Rig" value={data.rig} options={[['superflow', 'Superflow'], ['old', 'Old rig']]} onChange={(v) => upd({ rig: v })} />
              <Sel label="Valve" value={data.valve} options={[['intake', 'Intake'], ['exhaust', 'Exhaust']]} onChange={(v) => upd({ valve: v })} />
              <Num label="Bore (mm)" value={data.bore} onChange={(v) => upd({ bore: v })} />
              <Num label="Stroke (mm)" value={data.stroke} onChange={(v) => upd({ stroke: v })} />
              <Num label="Number of valves" value={data.nValves} onChange={(v) => upd({ nValves: Math.max(1, Math.round(v)) })} />
              <Num label="Throat diameter (mm)" value={data.throat} onChange={(v) => upd({ throat: v })} />
              <Num label="Seat angle (deg)" value={data.seatAngle} onChange={(v) => upd({ seatAngle: v })} />
              <Num label="Ambient pressure (mbar)" value={data.ambientPressure} onChange={(v) => upd({ ambientPressure: v })} />
              <Num label="Ambient temperature (C)" value={data.ambientTemperature} onChange={(v) => upd({ ambientTemperature: v })} />
              {data.swirl !== 'none' && <Num label="Rig bore (mm)" value={data.rigBore ?? data.bore} onChange={(v) => upd({ rigBore: v })} />}
            </fieldset>
            <fieldset>
              <legend>Analysis</legend>
              <Sel<AreaBasis> label="Cd reference area" value={basis} options={[['min', 'Smaller of curtain and throat'], ['curtain', 'Curtain (seat) area'], ['throat', 'Throat area']]} onChange={setBasis} />
            </fieldset>
          </>
        )}
      </div>
      <div className="etools-main">
        {!data || !res ? <p className="edim">Load a bench file to analyse. Intake data uses negative pressure factors, exhaust positive.</p> : (
          <>
            <Stats items={[
              ['Throat / bore area ratio', f2(res.summary.throatBoreRatio, 3)],
              ['Cf at 0.3 L/D', f2(res.summary.cfAt03, 3)],
              ['Cd at 0.3 L/D', f2(res.summary.cdAt03, 3)],
              ['Mean Cf 0 to 0.3 L/D', f2(res.summary.meanCf03, 3)],
              ['Mean Cd 0 to 0.3 L/D', f2(res.summary.meanCd03, 3)],
              ['Maximum Cd', f2(res.summary.maxCd, 3)],
              ['Mean Cf over lift curve', f2(res.summary.meanCfOverLift, 3)],
              ['Mean flow area / bore area', f2(res.summary.meanAreaRatio, 3)],
            ]} />
            <div className="etable-wrap">
              <table>
                <thead><tr><th className="l">Lift (mm)</th><th>L/D</th><th>Flow (l/s)</th><th>Mass flow (g/s)</th><th>Curtain (mm2)</th><th>Cd</th><th>Cf</th>{swirlRows && <th>Swirl no.</th>}</tr></thead>
                <tbody>
                  {res.points.map((p, i) => (
                    <tr key={i}><td className="l">{f2(p.lift, 1)}</td><td>{f2(p.ld, 3)}</td><td>{f2(p.volumeFlow * 1000, 1)}</td><td>{f2(p.massFlow * 1000, 1)}</td><td>{f2(p.curtainArea, 0)}</td><td>{f2(p.cd, 3)}</td><td>{f2(p.cf, 3)}</td>{swirlRows && <td>{f2(p.swirl, 2)}</td>}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="eplots">
              <ToolPlot title="Discharge and flow coefficient" x={res.points.map((p) => p.ld)} series={[{ label: 'Cd', y: res.points.map((p) => p.cd), points: true }, { label: 'Cf', y: res.points.map((p) => p.cf), points: true }]} xLabel="L/D" yLabel="coefficient" />
              {swirlRows ? <ToolPlot title={data.swirl === 'tumble' ? 'Tumble number' : 'Swirl number'} x={res.points.map((p) => p.ld)} series={[{ label: data.swirl, y: res.points.map((p) => p.swirl ?? null), points: true }]} xLabel="L/D" yLabel="rig number" />
                : <ToolPlot title="Volume flow" x={res.points.map((p) => p.lift)} series={[{ label: 'l/s', y: res.points.map((p) => p.volumeFlow * 1000), points: true }]} xLabel="lift (mm)" yLabel="l/s" />}
            </div>
            <fieldset>
              <legend>Apply Cd table to model valves</legend>
              {!model ? <p className="edim">No model loaded.</p> : (
                <div className="erow">
                  {candidates.map((v) => (
                    <label key={v.id} className="echeck">
                      <input type="checkbox" checked={targets.includes(v.id)} onChange={(e) => setTargets((t) => (e.target.checked ? [...t, v.id] : t.filter((x) => x !== v.id)))} />{v.label || `Valve ${v.id}`}
                    </label>
                  ))}
                  {!candidates.length && <span className="edim">The model has no {data.valve} valves.</span>}
                </div>
              )}
              <div className="erow">
                <button className="primary" disabled={!model || !targets.length} onClick={apply}>Apply to model</button>
                {candidates.length > 1 && <button onClick={() => setTargets(candidates.map((v) => v.id))}>Select all</button>}
                {msg && <span className="egood">{msg}</span>}
              </div>
            </fieldset>
          </>
        )}
      </div>
    </div>
  );
}
