import { useMemo, useState } from 'react';
import { buildConceptModel, sizeConcept, type ConceptInput } from '@claudus/engine';
import { useEngine } from '../store';
import { Check, f2, Num, Sel, Stats } from './common';

export function ConceptTool({ onClose }: { onClose?: () => void }) {
  const model = useEngine((s) => s.model);
  const setModel = useEngine((s) => s.setModel);
  const [inp, setInp] = useState<ConceptInput>({ cylinders: 4, sweptVolume: 2000, maxPowerRpm: 6500, cycle: 4, compressionRatio: 10.5, intakeValves: 2, exhaustValves: 2, name: 'concept' });
  const [fixHelm, setFixHelm] = useState(false);
  const [fixBore, setFixBore] = useState(false);
  const [msg, setMsg] = useState('');
  const upd = (p: Partial<ConceptInput>) => setInp((x) => ({ ...x, ...p }));

  const eff: ConceptInput = { ...inp, helmholtzRpm: fixHelm ? inp.helmholtzRpm ?? inp.maxPowerRpm - 1500 : undefined, bore: fixBore ? inp.bore : undefined, stroke: fixBore ? inp.stroke : undefined };
  const key = JSON.stringify(eff);
  const s = useMemo(() => sizeConcept(JSON.parse(key) as ConceptInput), [key]);

  const create = () => {
    const m = buildConceptModel(JSON.parse(key) as ConceptInput, s);
    setModel(m);
    setMsg(`Model generated: ${m.cylinders.length} cylinders, ${m.pipes.length} pipes, ${m.tests.length} test points.`);
    onClose?.();
  };

  const row = (k: string, v: string, unit = '') => <tr key={k}><td className="l">{k}</td><td>{v}</td><td className="l">{unit}</td></tr>;
  return (
    <div className="etools-body">
      <div className="etools-side">
        <fieldset>
          <legend>Engine</legend>
          <Num label="Number of cylinders" value={inp.cylinders} onChange={(v) => upd({ cylinders: Math.max(1, Math.round(v)) })} />
          <Num label="Swept volume (cc, total)" value={inp.sweptVolume} onChange={(v) => upd({ sweptVolume: v })} />
          <Num label="Max power speed (rpm)" value={inp.maxPowerRpm} onChange={(v) => upd({ maxPowerRpm: v })} />
          <Sel label="Cycle" value={inp.cycle ?? 4} options={[[4, 'Four stroke'], [2, 'Two stroke']]} onChange={(v) => upd({ cycle: v })} />
          <Num label="Compression ratio" value={inp.compressionRatio} onChange={(v) => upd({ compressionRatio: v })} />
          <Num label="Intake valves / cyl" value={inp.intakeValves} onChange={(v) => upd({ intakeValves: Math.max(1, Math.round(v)) })} />
          <Num label="Exhaust valves / cyl" value={inp.exhaustValves} onChange={(v) => upd({ exhaustValves: Math.max(1, Math.round(v)) })} />
          <Num label="Intake pressure (bar)" value={inp.intakePressure ?? 1.013} onChange={(v) => upd({ intakePressure: v })} step={0.01} title="Above 1.013 bar for a boosted engine" />
        </fieldset>
        <fieldset>
          <legend>Fixed values (optional)</legend>
          <Check label="Fix bore and stroke" value={fixBore} onChange={(v) => { setFixBore(v); if (v) upd({ bore: inp.bore ?? s.bore, stroke: inp.stroke ?? s.stroke }); }} />
          {fixBore && (<><Num label="Bore (mm)" value={inp.bore} onChange={(v) => upd({ bore: v })} /><Num label="Stroke (mm)" value={inp.stroke} onChange={(v) => upd({ stroke: v })} /></>)}
          <Check label="Fix Helmholtz tuning speed" value={fixHelm} onChange={(v) => { setFixHelm(v); if (v && inp.helmholtzRpm === undefined) upd({ helmholtzRpm: inp.maxPowerRpm - 1500 }); }} />
          {fixHelm && <Num label="Helmholtz speed (rpm)" value={inp.helmholtzRpm} onChange={(v) => upd({ helmholtzRpm: v })} />}
          <Num label="Intake runner length (mm, 0 = tuned)" value={inp.runnerLength ?? 0} onChange={(v) => upd({ runnerLength: v > 0 ? v : undefined })} />
          <Num label="Exhaust primary length (mm, 0 = tuned)" value={inp.primaryLength ?? 0} onChange={(v) => upd({ primaryLength: v > 0 ? v : undefined })} />
        </fieldset>
        <fieldset>
          <legend>Model</legend>
          <label className="ef wide">Name<input type="text" value={inp.name ?? ''} onChange={(e) => upd({ name: e.target.value })} /></label>
          <button className="primary" onClick={create}>{model ? 'Generate model (replaces current)' : 'Generate model'}</button>
          {msg && <p className="egood">{msg}</p>}
        </fieldset>
      </div>
      <div className="etools-main">
        <div className="eplots">
          <div className="etable-wrap" style={{ maxHeight: 'none' }}>
            <table>
              <thead><tr><th className="l">Cylinder and ports</th><th>Value</th><th className="l">Unit</th></tr></thead>
              <tbody>
                {row('Bore', f2(s.bore, 2), 'mm')}{row('Stroke', f2(s.stroke, 2), 'mm')}{row('Con rod', f2(s.conRod, 1), 'mm')}
                {row('Swept volume / cylinder', f2(s.sweptPerCylinder, 1), 'cc')}{row('Clearance volume', f2(s.clearanceVolume, 1), 'cc')}
                {row('Mean piston speed at max power', f2(s.meanPistonSpeed, 1), 'm/s')}
                {row('Inlet throat diameter (per valve)', f2(s.inletThroatDiameter, 1), 'mm')}{row('Exhaust throat diameter (per valve)', f2(s.exhaustThroatDiameter, 1), 'mm')}
                {row('Inlet port diameter (equivalent)', f2(s.inletPortDiameter, 1), 'mm')}{row('Exhaust port diameter (equivalent)', f2(s.exhaustPortDiameter, 1), 'mm')}
                {row('Inlet throat velocity', f2(s.inletThroatVelocity, 1), 'm/s')}{row('Inlet port velocity', f2(s.inletPortVelocity, 1), 'm/s')}
                {row('Valve lift inlet / exhaust', `${f2(s.valveLift.inlet, 1)} / ${f2(s.valveLift.exhaust, 1)}`, 'mm')}
                {row('IVO / IVC', `${f2(s.timing.ivo, 0)} BTDC / ${f2(s.timing.ivc, 0)} ABDC`, 'deg')}{row('EVO / EVC', `${f2(s.timing.evo, 0)} BBDC / ${f2(s.timing.evc, 0)} ATDC`, 'deg')}
              </tbody>
            </table>
          </div>
          <div className="etable-wrap" style={{ maxHeight: 'none' }}>
            <table>
              <thead><tr><th className="l">Tuning and manifolds</th><th>Value</th><th className="l">Unit</th></tr></thead>
              <tbody>
                {row('Helmholtz (peak torque) speed', f2(s.helmholtzRpm, 0), 'rpm')}{row('Intake tuning order', String(s.intakeOrder))}
                {row('Intake runner length (to valve seat)', f2(s.runnerLength, 0), 'mm')}{row('Intake runner diameter', f2(s.runnerDiameter, 1), 'mm')}
                {row('Plenum volume', f2(s.plenumVolume, 0), 'cc')}{row('Throttle diameter', f2(s.throttleDiameter, 1), 'mm')}
                {row('Exhaust primary length', f2(s.primaryLength, 0), 'mm')}{row('Exhaust primary diameter', f2(s.primaryDiameter, 1), 'mm')}
                {row('Collector diameter / length', `${f2(s.collectorDiameter, 1)} / ${f2(s.collectorLength, 0)}`, 'mm')}
                {row('Exhaust tuned speed (120 deg return)', f2(s.exhaustTuningRpm, 0), 'rpm')}
                {row('Speed of sound intake / exhaust', `${f2(s.soundSpeedIntake, 0)} / ${f2(s.soundSpeedExhaust, 0)}`, 'm/s')}
                {row('Mach index', f2(s.mach, 3))}{row('Gulp factor', f2(s.gulpFactor, 3))}
              </tbody>
            </table>
          </div>
        </div>
        <Stats items={[['Cylinders', String(inp.cylinders)], ['Displacement (cc)', f2(inp.sweptVolume, 0)], ['Cycle', `${inp.cycle ?? 4}-stroke`]]} />
        <p className="edim">Runner and primary lengths come from the Helmholtz resonator and 120 degree wave-return equations. Generating a model builds cylinders, valves, ports, runners, plenum, throttle, exhaust primaries, collector, boundaries and a speed sweep of test points.</p>
      </div>
    </div>
  );
}
