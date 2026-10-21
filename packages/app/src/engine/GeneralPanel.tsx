// General settings: cycle, fuel, combustion, heat transfer, friction, temperatures, auto-mesh.
import { useState } from 'react';
import type { BurnModel, HeatTransferModel } from '@claudus/engine';
import { NumField, Row, TextField } from './fields';
import { useEngine } from './store';
import { autoMesh, evenFiring } from './testpoints';

const FUELS = { gasoline: [43.5e6, 1.87, 0, 745, 'spark-ignition'], diesel: [42.5e6, 1.8, 0, 840, 'direct-injection-diesel'], methanol: [19.9e6, 4, 1, 792, 'spark-ignition'], ethanol: [26.8e6, 3, 0.5, 789, 'spark-ignition'], 'natural-gas': [50e6, 3.9, 0, 0.72, 'spark-ignition'], lpg: [46e6, 2.7, 0, 540, 'spark-ignition'], hydrogen: [120e6, 1e3, 0, 0.09, 'spark-ignition'] } as const;

export function GeneralPanel() {
  const model = useEngine((s) => s.model);
  const edit = useEngine((s) => s.edit);
  const [mesh, setMesh] = useState(25);
  if (!model) return null;
  const k = (key: string) => ({ key });
  void k;
  const burn = model.burn;
  const ht = model.heatTransfer;
  const setBurnKind = (kind: BurnModel['kind']) => edit((m) => {
    m.burn = kind === 'wiebe' ? { kind, a: 5, m: 2 } : kind === 'wiebe2' ? { kind, premixFraction: 0.2, a1: 5, m1: 1, a2: 5, m2: 3 } : { kind, angle: [0, 1], fraction: [0, 1] };
  });
  const setHt = (kind: HeatTransferModel['kind']) => edit((m) => {
    m.heatTransfer = kind === 'woschni' ? { kind, scale: 1 } : kind === 'eichelberg' ? { kind, scale: 1 } : kind === 'annand' ? { kind, a: 0.4, b: 0.7, c: 0 } : { kind: 'none' };
  });
  return (
    <div className="props">
      <h3>General data</h3>
      <Row label="Model name"><TextField value={model.name} onChange={(v) => edit((m) => { m.name = v; }, { key: 'name' })} /></Row>
      <Row label="Cycle type">
        <select value={model.cycle} onChange={(e) => edit((m) => { m.cycle = Number(e.target.value) as 2 | 4; })}><option value={4}>4-stroke</option><option value={2}>2-stroke</option></select>
      </Row>
      <h4>Fuel</h4>
      <Row label="Fuel">
        <select value={model.fuel.type} onChange={(e) => edit((m) => {
          const t = e.target.value as keyof typeof FUELS;
          const f = FUELS[t];
          if (f) m.fuel = { type: t, lowerHeatingValue: f[0], hcRatio: f[1], ocRatio: f[2], density: f[3], system: f[4] };
        })}>
          {Object.keys(FUELS).map((f) => <option key={f}>{f}</option>)}
        </select>
      </Row>
      <Row label="Lower heating value" unit="MJ/kg"><NumField value={model.fuel.lowerHeatingValue / 1e6} onChange={(v) => edit((m) => { m.fuel.lowerHeatingValue = v * 1e6; }, { key: 'lhv' })} /></Row>
      <Row label="H/C ratio"><NumField value={model.fuel.hcRatio} onChange={(v) => edit((m) => { m.fuel.hcRatio = v; }, { key: 'hc' })} /></Row>
      <Row label="O/C ratio"><NumField value={model.fuel.ocRatio} onChange={(v) => edit((m) => { m.fuel.ocRatio = v; }, { key: 'oc' })} /></Row>
      <h4>Combustion</h4>
      <Row label="Burn model">
        <select value={burn.kind} onChange={(e) => setBurnKind(e.target.value as BurnModel['kind'])}><option value="wiebe">Wiebe</option><option value="wiebe2">Double Wiebe</option><option value="user">User profile</option></select>
      </Row>
      {burn.kind === 'wiebe' && <>
        <Row label="Wiebe a"><NumField value={burn.a} onChange={(v) => edit((m) => { if (m.burn.kind === 'wiebe') m.burn.a = v; }, { key: 'wa' })} /></Row>
        <Row label="Wiebe m"><NumField value={burn.m} onChange={(v) => edit((m) => { if (m.burn.kind === 'wiebe') m.burn.m = v; }, { key: 'wm' })} /></Row>
      </>}
      {burn.kind === 'wiebe2' && (['premixFraction', 'a1', 'm1', 'a2', 'm2'] as const).map((f) => (
        <Row key={f} label={f}><NumField value={burn[f]} onChange={(v) => edit((m) => { if (m.burn.kind === 'wiebe2') m.burn[f] = v; }, { key: `b${f}` })} /></Row>
      ))}
      {burn.kind === 'user' && <p className="muted small">User burn profile with {burn.angle.length} points (edit through the .sim file).</p>}
      <Row label="Heat transfer">
        <select value={ht.kind} onChange={(e) => setHt(e.target.value as HeatTransferModel['kind'])}><option value="woschni">Woschni</option><option value="annand">Annand</option><option value="eichelberg">Eichelberg</option><option value="none">None</option></select>
      </Row>
      {(ht.kind === 'woschni' || ht.kind === 'eichelberg') && <Row label="Scale"><NumField value={ht.scale} step={0.05} onChange={(v) => edit((m) => { if (m.heatTransfer.kind === 'woschni' || m.heatTransfer.kind === 'eichelberg') m.heatTransfer.scale = v; }, { key: 'hts' })} /></Row>}
      <h4>Wall temperatures</h4>
      {(['head', 'piston', 'liner'] as const).map((f) => <Row key={f} label={f} unit="K"><NumField value={model.temperatures[f]} onChange={(v) => edit((m) => { m.temperatures[f] = v; }, { key: `t${f}` })} /></Row>)}
      <h4>Friction (FMEP = a + b·pmax + c·Sp + d·Sp²)</h4>
      {(['a', 'b', 'c', 'd'] as const).map((f) => <Row key={f} label={f}><NumField value={model.friction[f]} step={0.001} onChange={(v) => edit((m) => { m.friction[f] = v; }, { key: `f${f}` })} /></Row>)}
      <h4>Mesh and firing</h4>
      <Row label="Target mesh length" unit="mm"><NumField value={mesh} onChange={setMesh} /></Row>
      <div className="dlg-actions"><button onClick={() => edit((m) => autoMesh(m, mesh))}>Auto-mesh all pipes</button></div>
      <div className="dlg-actions"><button onClick={() => edit((m) => evenFiring(m, m.cylinders.map((c) => c.id)))}>Even firing in cylinder order</button></div>
    </div>
  );
}
