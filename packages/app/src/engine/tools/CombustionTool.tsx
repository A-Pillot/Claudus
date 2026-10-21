import { useMemo, useState } from 'react';
import { analyseCombustion, applyWiebeToModel, fitWiebe, mfbToUserBurn, parseBurnData, wiebeBurnt, type BurnData } from '@claudus/engine';
import { useEngine } from '../store';
import { Check, DataSource, f2, Num, Sel, Stats } from './common';
import { ToolPlot } from './ToolPlot';

const SAMPLE_HINT = 'Format: 3 title lines, units (mm, bar, rpm, bar), clearance/offset (999 = calculate), speed, bore stroke rod pin-offset CR flag cycle, TDC-angle ignition IVO IVC EVO EVC, reference pressure, row count, then angle / pressure rows.';

export function CombustionTool() {
  const model = useEngine((s) => s.model);
  const setModel = useEngine((s) => s.setModel);
  const [text, setText] = useState('');
  const [data, setData] = useState<BurnData | null>(null);
  const [error, setError] = useState('');
  const [method, setMethod] = useState<'net' | 'rassweiler'>('net');
  const [gamma, setGamma] = useState(1.32);
  const [smooth, setSmooth] = useState(3);
  const [fitA, setFitA] = useState(false);
  const [offsetOverride, setOffsetOverride] = useState<number | undefined>(undefined);
  const [applyAll, setApplyAll] = useState(false);
  const [msg, setMsg] = useState('');

  const load = (t: string) => {
    setText(t);
    setMsg('');
    if (!t.trim()) { setData(null); setError(''); return; }
    try { setData(parseBurnData(t)); setError(''); setOffsetOverride(undefined); } catch (e) { setData(null); setError((e as Error).message); }
  };
  const upd = (p: Partial<BurnData>) => data && setData({ ...data, ...p });

  const res = useMemo(() => (data ? analyseCombustion(data, { gamma, method, smooth, pressureOffset: offsetOverride }) : null), [data, gamma, method, smooth, offsetOverride]);
  const fit = useMemo(() => (res ? fitWiebe(res.theta, res.mfb, { window: res.window, fitA }) : null), [res, fitA]);

  // Plot data restricted to the neighbourhood of TDC.
  const view = useMemo(() => {
    if (!res) return null;
    const idx = res.theta.map((_, i) => i).filter((i) => res.theta[i] >= -100 && res.theta[i] <= 120).sort((a, b) => res.theta[a] - res.theta[b]);
    const th = idx.map((i) => res.theta[i]);
    return {
      th,
      p: idx.map((i) => res.pressure[i]),
      mfb: idx.map((i) => res.mfb[i]),
      hrr: idx.map((i) => res.dQ[i]),
      wiebe: fit ? th.map((t) => (t <= res.window[0] || t > res.window[1] ? null : wiebeBurnt(t, fit.a, fit.m, fit.start, fit.duration))) : [],
    };
  }, [res, fit]);

  const apply = () => {
    if (!model || !fit || !data) return;
    setModel(applyWiebeToModel(model, fit, { speed: data.speed, all: applyAll }));
    setMsg('Wiebe burn and test point burn start / duration applied to the model.');
  };
  const applyUser = () => {
    if (!model || !fit || !res) return;
    const user = mfbToUserBurn(res.theta.filter((t) => t > res.window[0] && t <= res.window[1]), res.mfb.filter((_, i) => res.theta[i] > res.window[0] && res.theta[i] <= res.window[1]), fit.start, fit.duration);
    const m = applyWiebeToModel(model, fit, { speed: data?.speed, all: applyAll });
    setModel({ ...m, burn: { kind: 'user', angle: user.angle, fraction: user.fraction } });
    setMsg('Measured burn curve applied as a user-defined burn table.');
  };

  return (
    <div className="etools-body">
      <div className="etools-side">
        <DataSource label="Pressure data file" accept=".dat,.txt,.prs,.csv" text={text} onText={load} rows={6} />
        {error && <p className="ewarn">{error}</p>}
        {!data && !error && <p className="edim">{SAMPLE_HINT}</p>}
        {data && (
          <>
            <fieldset>
              <legend>Engine and conditions</legend>
              <Num label="Speed (rpm)" value={data.speed} onChange={(v) => upd({ speed: v })} />
              <Sel label="Cycle" value={data.cycle} options={[[2, 'Two stroke'], [4, 'Four stroke']]} onChange={(v) => upd({ cycle: v })} />
              <Num label="Bore (mm)" value={data.bore} onChange={(v) => upd({ bore: v })} />
              <Num label="Stroke (mm)" value={data.stroke} onChange={(v) => upd({ stroke: v })} />
              <Num label="Rod length (mm)" value={data.rod} onChange={(v) => upd({ rod: v })} />
              <Num label="Pin offset (mm)" value={data.pinOffset} onChange={(v) => upd({ pinOffset: v })} />
              <Num label="Compression ratio" value={data.compressionRatio} onChange={(v) => upd({ compressionRatio: v })} />
              <Num label="Ignition (deg BTDC)" value={data.ignition} onChange={(v) => upd({ ignition: v })} />
              <Num label="Firing TDC in data (deg)" value={data.tdcAngle} onChange={(v) => upd({ tdcAngle: v })} title="Crank angle in the file at which the firing TDC occurs" />
            </fieldset>
            <fieldset>
              <legend>Analysis</legend>
              <Sel label="Method" value={method} options={[['net', 'Net heat release (first law)'], ['rassweiler', 'Rassweiler-Withrow']]} onChange={setMethod} />
              <Num label="Gamma" value={gamma} onChange={setGamma} step={0.01} />
              <Num label="Smoothing (samples)" value={smooth} onChange={(v) => setSmooth(Math.max(1, Math.round(v)))} />
              <Num label="Pressure offset (bar)" value={offsetOverride ?? res?.pressureOffset} onChange={setOffsetOverride} step={0.01} title="Added to the measured pressure. Edit to override the pegging." />
              <Check label="Fit Wiebe a as well" value={fitA} onChange={setFitA} />
            </fieldset>
          </>
        )}
      </div>
      <div className="etools-main">
        {!res || !view || !fit ? <p className="edim">Load cylinder pressure data to analyse.</p> : (
          <>
            <Stats items={[
              ['Peak pressure (bar)', f2(res.peakPressure, 1)],
              ['At (deg ATDC)', f2(res.peakAngle, 1)],
              ['Max dp/dtheta (bar/deg)', f2(res.maxPressureRise, 2)],
              ['IMEP gross (bar)', f2(res.imepGross, 2)],
              ['IMEP net (bar)', f2(res.imepNet, 2)],
              ['Net heat (J)', f2(res.totalHeat, 0)],
              ['Burn start 2% (deg)', f2(res.burn.start, 1)],
              ['10% burn (deg)', f2(res.burn.b10, 1)],
              ['50% burn (deg)', f2(res.burn.b50, 1)],
              ['90% burn (deg)', f2(res.burn.b90, 1)],
              ['10-90% (deg)', f2(res.burn.duration1090, 1)],
              ['Pressure offset (bar)', f2(res.pressureOffset, 3)],
            ]} />
            <fieldset>
              <legend>Wiebe fit</legend>
              <Stats items={[['a', f2(fit.a, 3)], ['m', f2(fit.m, 3)], ['Start (deg ATDC)', f2(fit.start, 1)], ['Duration (deg)', f2(fit.duration, 1)], ['RMS error', f2(fit.rms, 4)]]} />
              <div className="erow">
                <Check label="All test points" value={applyAll} onChange={setApplyAll} />
                <button className="primary" disabled={!model} onClick={apply} title={model ? '' : 'No model loaded'}>Apply Wiebe to model</button>
                <button disabled={!model} onClick={applyUser}>Apply as user burn table</button>
              </div>
              {msg && <p className="egood">{msg}</p>}
            </fieldset>
            <div className="eplots">
              <ToolPlot title="Cylinder pressure" x={view.th} series={[{ label: 'Pressure (bar)', y: view.p }]} xLabel="deg ATDC" yLabel="bar" />
              <ToolPlot title="Mass fraction burned" x={view.th} series={[{ label: 'Measured', y: view.mfb }, { label: 'Wiebe fit', y: view.wiebe, dash: [5, 4] }]} xLabel="deg ATDC" yLabel="fraction" />
              <ToolPlot title="Apparent heat release rate" x={view.th} series={[{ label: 'dQ (J/deg)', y: view.hrr }]} xLabel="deg ATDC" yLabel="J/deg" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
