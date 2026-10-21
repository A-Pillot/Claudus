import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyseCombustion, analysePortFlowWithLift, applyCdToValve, applyWiebeToModel, buildConceptModel, estimateFriction, exhaustTuningLength,
  fitChenFlynn, fitWiebe, helmholtzLength, helmholtzSpeed, linspace, optimiseModel, parseBurnData, parseFrictionFile, parseLiftFile,
  parsePortFlowFile, runParametric, setPath, sizeConcept, wiebeBurnt, crankVolumeFn, type BurnData,
} from '../src/tools';
import type { EngineModel } from '../src/model';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures/tools', n), 'utf8');

/** Synthetic single-zone trace: motored polytrope plus a Wiebe heat release, closed-system first law. */
function synthetic(opts: { burn: boolean; a?: number; m?: number; start?: number; dur?: number }): BurnData {
  const bore = 86, stroke = 86, rod = 145, cr = 10, gamma = 1.32;
  const vf = crankVolumeFn(bore, stroke, rod, 0, cr);
  const angle: number[] = [], pressure: number[] = [];
  let p = 1.0e5;
  const qTot = 1500; // J
  let prev = -180;
  let burnt = 0;
  for (let t = -180; t <= 180; t += 0.5) {
    if (t > -180) {
      const v0 = vf(prev), v1 = vf(t);
      const x1 = opts.burn ? wiebeBurnt(t, opts.a ?? 6.908, opts.m ?? 2, opts.start ?? -15, opts.dur ?? 50) : 0;
      const dq = qTot * (x1 - burnt);
      burnt = x1;
      // dp from first law with mid-point volume.
      const vm = (v0 + v1) / 2;
      p = p + ((gamma - 1) * dq - gamma * p * (v1 - v0)) / vm;
    }
    prev = t;
    angle.push(t + 180); pressure.push(p / 1e5);
  }
  return {
    title: ['synthetic'], speed: 3000, cycle: 4, bore, stroke, rod, pinOffset: 0, compressionRatio: cr,
    clearanceVolume: undefined, pressureOffset: 0, tdcAngle: 180, ignition: 25, ivo: 0, ivc: 0, evo: 0, evc: 0, angle, pressure,
  };
}

describe('combustion analysis', () => {
  it('motored trace has near-zero heat release', () => {
    const r = analyseCombustion(synthetic({ burn: false }), { gamma: 1.32, smooth: 1 });
    const peakMotored = Math.max(...r.pressure);
    expect(peakMotored).toBeGreaterThan(15);
    expect(Math.abs(r.totalHeat)).toBeLessThan(15);
  });
  it('recovers the heat release and burn angles of a Wiebe burn', () => {
    const d = synthetic({ burn: true });
    const r = analyseCombustion(d, { gamma: 1.32, smooth: 1, windowStart: -40, windowEnd: 80 });
    expect(r.totalHeat).toBeGreaterThan(1450);
    expect(r.totalHeat).toBeLessThan(1550);
    // Wiebe a=6.908, m=2, start -15, duration 50: x=0.5 at start + dur*(ln2/a)^(1/3)
    const b50 = -15 + 50 * Math.pow(Math.LN2 / 6.908, 1 / 3);
    expect(r.burn.b50).toBeCloseTo(b50, 0);
    expect(r.imepGross).toBeGreaterThan(5);
  });
  it('fits Wiebe parameters', () => {
    const d = synthetic({ burn: true, m: 2.5, start: -10, dur: 40 });
    const r = analyseCombustion(d, { gamma: 1.32, smooth: 1, windowStart: -40, windowEnd: 80 });
    const f = fitWiebe(r.theta, r.mfb, { window: r.window });
    expect(f.start).toBeCloseTo(-10, 0);
    expect(f.duration).toBeGreaterThan(37);
    expect(f.duration).toBeLessThan(43);
    expect(f.m).toBeGreaterThan(2.2);
    expect(f.m).toBeLessThan(2.8);
    expect(f.rms).toBeLessThan(0.01);
  });
  it('Rassweiler-Withrow gives a monotone MFB with similar 50 % point', () => {
    const d = synthetic({ burn: true });
    const net = analyseCombustion(d, { smooth: 1, windowStart: -40, windowEnd: 80 });
    const rw = analyseCombustion(d, { smooth: 1, windowStart: -40, windowEnd: 80, method: 'rassweiler' });
    expect(Math.abs(rw.burn.b50 - net.burn.b50)).toBeLessThan(4);
  });
  it('parses and analyses the measured Esprit file', () => {
    const d = parseBurnData(fx('burn_esprit_1000.dat'));
    expect(d.angle.length).toBe(721);
    expect(d.bore).toBeCloseTo(95.27);
    expect(d.compressionRatio).toBeCloseTo(7.74);
    expect(d.tdcAngle).toBeCloseTo(177);
    expect(d.ignition).toBe(37);
    expect(d.cycle).toBe(4);
    const r = analyseCombustion(d);
    expect(r.peakPressure).toBeGreaterThan(30);
    expect(r.peakAngle).toBeGreaterThan(0);
    expect(r.peakAngle).toBeLessThan(30);
    expect(r.burn.b50).toBeGreaterThan(-10);
    expect(r.burn.b50).toBeLessThan(40);
    expect(r.burn.b90).toBeGreaterThan(r.burn.b10);
    expect(r.imepGross).toBeGreaterThan(3);
    const fit = fitWiebe(r.theta, r.mfb, { window: r.window });
    expect(fit.rms).toBeLessThan(0.08);
    const m = applyWiebeToModel(buildConceptModel({ cylinders: 4, sweptVolume: 2000, maxPowerRpm: 6500 }), fit, { speed: 3000 });
    expect(m.burn.kind).toBe('wiebe');
    expect(m.tests.filter((t) => t.burnDuration === Math.round(fit.duration * 100) / 100).length).toBe(1);
  });
});

describe('friction estimator', () => {
  it('parses .fri files', () => {
    const f = parseFrictionFile(fx('dfr.fri'));
    expect(f.bore).toBe(90);
    expect(f.cylinders).toBe(8);
    expect(f.mainBearings).toBe(5);
    expect(f.mainDiameter).toBe(60);
    expect(f.valvesPerCylinder).toBe(4);
    expect(f.startRpm).toBe(7000);
    const s = parseFrictionFile(fx('jewel.fri'));
    expect(s.mainDiameter).toBeUndefined();
    const sg = parseFrictionFile(fx('sngl.fri'));
    expect(sg.loadRatio).toBeCloseTo(0.4);
  });
  it('gives 1-3 bar FMEP at mid speed for a 2 L engine', () => {
    const f = { ...parseFrictionFile(fx('jewel.fri')), bore: 86, stroke: 86, cylinders: 4, mainBearings: 5, startRpm: 1000, endRpm: 7000, stepRpm: 1000 };
    const c = estimateFriction(f);
    const i = c.rpm.indexOf(3000);
    for (const k of Object.keys(c.models) as (keyof typeof c.models)[]) {
      expect(c.models[k][i], k).toBeGreaterThan(0.7);
      expect(c.models[k][i], k).toBeLessThan(3);
      // rises with speed
      expect(c.models[k][c.rpm.length - 1]).toBeGreaterThan(c.models[k][0]);
    }
    expect(c.mean[i]).toBeGreaterThan(1);
    expect(c.power.patton[i]).toBeGreaterThan(0);
  });
  it('fits Chen-Flynn coefficients', () => {
    const f = { ...parseFrictionFile(fx('jewel.fri')), bore: 86, stroke: 86, cylinders: 4, startRpm: 1000, endRpm: 7000, stepRpm: 500 };
    const c = estimateFriction(f);
    const fit = fitChenFlynn(c.sp, c.mean);
    expect(fit.rms).toBeLessThan(0.15);
    const at = (sp: number) => fit.a + fit.b * 45 + fit.c * sp + fit.d * sp * sp;
    const j = c.rpm.indexOf(4000);
    expect(at(c.sp[j])).toBeCloseTo(c.mean[j], 0);
  });
});

describe('port flow', () => {
  it('parses a superflow intake file and gives plausible Cd', () => {
    const d = parsePortFlowFile(fx('lot01.blo'));
    expect(d.rig).toBe('superflow');
    expect(d.valve).toBe('intake');
    expect(d.rows.length).toBe(11);
    expect(d.orificeFactors.length).toBe(6);
    expect(d.throat).toBeCloseTo(31);
    const r = analysePortFlowWithLift(d, undefined);
    for (const p of r.points) { expect(p.cd).toBeGreaterThan(0.3); expect(p.cd).toBeLessThan(1.1); }
    expect(r.points[10].cd).toBeGreaterThan(0.55);
    expect(r.points[10].cd).toBeLessThan(0.8);
    expect(r.cdTable.ld[0]).toBe(0);
    const v = applyCdToValve({ id: 1, label: 'v', kind: 'intake', openAngle: 0, closeAngle: 1, maxLift: 10, diameter: 31 }, r.cdTable);
    expect(v.cd?.ld.length).toBe(12);
  });
  it('parses exhaust, old-rig, swirl and lift files', () => {
    const e = parsePortFlowFile(fx('exh1.blo'));
    expect(e.valve).toBe('exhaust');
    expect(analysePortFlowWithLift(e, undefined).points[10].cd).toBeGreaterThan(0.4);
    const o = parsePortFlowFile(fx('5v1.blo'));
    expect(o.rig).toBe('old');
    expect(o.rows.length).toBe(15);
    expect(o.lift?.file.toLowerCase()).toBe('inl.lft');
    const lft = parseLiftFile(fx('inl.lft'));
    expect(lft.angle.length).toBe(35);
    const res = analysePortFlowWithLift(o, lft);
    expect(res.summary.meanCfOverLift).toBeGreaterThan(0.05);
    const sw = parsePortFlowFile(fx('Hd0127.blo'));
    expect(sw.swirl).toBe('tumble');
    expect(sw.conRod).toBeCloseTo(141);
    expect(analysePortFlowWithLift(sw, undefined).points[0].swirl).toBeGreaterThan(0);
    const t = parsePortFlowFile(fx('dfr71.blo'));
    expect(t.swirl).toBe('swirl');
    expect(t.rows.length).toBe(13);
    expect(t.rows[0].vaneSpeed).toBe(227);
  });
});

describe('concept builder', () => {
  it('tuning equations are consistent and sensible', () => {
    const a = Math.sqrt(1.4 * 287 * 300);
    const L = helmholtzLength(a, 0.0012, 0.3e-3, 5000);
    expect(helmholtzSpeed(a, 0.0012, L, 0.3e-3)).toBeCloseTo(5000, 3);
    expect(L).toBeGreaterThan(0.2);
    expect(L).toBeLessThan(2.5);
    const ex = exhaustTuningLength(Math.sqrt(1.33 * 287 * 900), 6500);
    expect(ex).toBeGreaterThan(0.5);
    expect(ex).toBeLessThan(1.5);
  });
  it('sizes a 2 L four-cylinder', () => {
    const s = sizeConcept({ cylinders: 4, sweptVolume: 2000, maxPowerRpm: 6500 });
    expect(s.bore).toBeGreaterThan(80);
    expect(s.bore).toBeLessThan(95);
    expect(s.meanPistonSpeed).toBeLessThan(20.5);
    expect(s.inletThroatVelocity).toBeLessThanOrEqual(80.5);
    expect(s.inletPortVelocity).toBeLessThanOrEqual(110.5);
    expect(s.runnerLength).toBeGreaterThan(150);
    expect(s.runnerLength).toBeLessThan(800);
    expect(s.primaryLength).toBeGreaterThan(400);
  });
  it('generates a connected EngineModel', () => {
    const m = buildConceptModel({ cylinders: 4, sweptVolume: 2000, maxPowerRpm: 6500, name: 'x' });
    expect(m.cylinders.length).toBe(4);
    expect(m.valves.length).toBe(8);
    expect(m.pipes.length).toBe(9);
    expect(m.cylinders.map((c) => c.firingAngle).sort((a, b) => a - b)).toEqual([0, 180, 360, 540]);
    expect(m.tests.length).toBeGreaterThan(5);
    // Every pipe end is used by some connection.
    const used = new Set<string>();
    for (const c of m.connections) for (const e of [c.a, c.b]) if (e.kind === 'pipe') used.add(`${e.id}:${e.end}`);
    for (const p of m.pipes) { expect(used.has(`${p.id}:1`)).toBe(true); expect(used.has(`${p.id}:2`)).toBe(true); }
    expect(m.valves[0].openAngle).toBeLessThan(m.valves[0].closeAngle);
  });
});

describe('parametric and optimiser', () => {
  const base: EngineModel = buildConceptModel({ cylinders: 1, sweptVolume: 500, maxPowerRpm: 6000 });
  it('sets values by path', () => {
    const m = setPath(base, 'pipes[0].length', 123);
    expect(m.pipes[0].length).toBe(123);
    expect(base.pipes[0].length).not.toBe(123);
    expect(() => setPath(base, 'pipes[9].length', 1)).toThrow();
  });
  it('runs a 2-D study', async () => {
    const r = await runParametric(base, [{ path: 'pipes.0.length', values: [100, 200, 300] }, { path: 'plenums.0.volume', values: [1000, 2000] }], (m) => m.pipes[0].length + m.plenums[0].volume / 1000);
    expect(r.runs.length).toBe(6);
    expect(r.best?.values['pipes.0.length']).toBe(100);
    expect(linspace(0, 1, 3)).toEqual([0, 0.5, 1]);
  });
  it('optimises with Nelder-Mead', async () => {
    const r = await optimiseModel(base, [{ path: 'pipes.0.length', min: 100, max: 900, start: 200 }, { path: 'plenums.0.volume', min: 500, max: 5000, start: 4000 }],
      async (m) => -((m.pipes[0].length - 450) ** 2 / 1e4 + (m.plenums[0].volume - 2500) ** 2 / 1e6), { maximise: true, maxEvaluations: 120 });
    expect(Math.abs(r.values['pipes.0.length'] - 450)).toBeLessThan(20);
    expect(Math.abs(r.values['plenums.0.volume'] - 2500)).toBeLessThan(150);
  });
});
