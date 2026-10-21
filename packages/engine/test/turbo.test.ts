import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineModel } from '../src/model';
import { parseSim, writeSim } from '../src/sim/index';
import { compileExpression } from '../src/sim/turbo';
import { simulatePoint } from '../src/solver/simulate';
import { singleCylinder } from './solver.test';

const dir = new URL('./fixtures/', import.meta.url);
const load = (n: string): EngineModel => parseSim(readFileSync(new URL(`${n}.sim`, dir), 'utf8'));

describe('turbo decoding', () => {
  it('reads compressor and turbine maps with scale factors', () => {
    const m = load('tutorial_8');
    const c = m.compressors[0];
    expect(c.map?.speed).toHaveLength(6);
    expect(c.map?.flow[0]).toHaveLength(7);
    expect(c.map?.scale).toEqual({ speed: 1.5, flow: 0.35, pr: 0.7, eff: 1 });
    expect(c.inertia).toBeCloseTo(4e-6, 9);
    const t = m.turbines[0];
    expect(t.map?.scale.flow).toBeCloseTo(0.25, 6);
    expect(m.turbo?.links).toEqual([{ a: { kind: 'compressor', id: 1 }, b: { kind: 'turbine', id: 1 } }]);
  });

  it('reads sensors, actuators and controls of the waste-gate tutorials', () => {
    const m9 = load('tutorial_9');
    expect(m9.turbo?.sensors[0]).toMatchObject({ quantity: 'plenum-pressure', element: 3 });
    expect(m9.turbo?.actuators[0]).toMatchObject({ target: 'throttle-area', element: 3 });
    expect(m9.turbo?.controls.map((c) => c.kind)).toEqual(['function', 'limit']);
    const m9b = load('tutorial_9b');
    expect(m9b.turbo?.sensors.map((s) => s.quantity)).toEqual(['plenum-pressure', 'engine-speed']);
    expect(m9b.turbo?.controls.map((c) => c.kind)).toEqual(['limit', 'lookup', 'function']);
    const m10 = load('tutorial_10');
    expect(m10.turbo?.coolers[0].massFlow).toHaveLength(5);
    expect(m10.turbo?.coolers[0].effectiveness[3]).toBeCloseTo(0.7, 6);
    expect(m10.compressors[0].mechEff).toBeCloseTo(0.95, 6);
    expect(load('tutorial_11').turbo?.shafts[0].inertia).toBeCloseTo(0.12, 6);
  });

  it('evaluates Fortran style control expressions', () => {
    expect(compileExpression('(((F1*0.002)-360.0)/4000.0)*70000.0')([200000])).toBeCloseTo(700, 6);
    expect(compileExpression('((F1-F2)/(20000.0))*700.0')([200000, 180000])).toBeCloseTo(700, 6);
    expect(compileExpression('F1/180.0')([1])).toBeCloseTo(0.00556, 5);
    expect(compileExpression('2.0**3 + SQRT(F1) - 1.5D0')([16])).toBeCloseTo(10.5, 9);
  });

  it('keeps every fixture exactly round-trippable', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sim'))) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      expect(writeSim(parseSim(text)) === text, f).toBe(true);
    }
  });
});

/** The same model with the turbo machines replaced by plain openings (naturally aspirated equivalent). */
function naturallyAspirated(m: EngineModel): EngineModel {
  return {
    ...m,
    connections: m.connections.map((c) => ({ ...c, via: c.via.filter((v) => v.kind !== 'compressor' && v.kind !== 'turbine') })),
    turbo: undefined,
  };
}

describe('turbocharged tutorials', () => {
  const rpmIndex = (m: EngineModel, rpm: number) => m.tests.findIndex((t) => t.speed === rpm);

  it('tutorial_8 boosts well above ambient and out-performs the naturally aspirated engine', () => {
    const m = load('tutorial_8');
    const t = m.tests[rpmIndex(m, 3000)];
    const r = simulatePoint(m, t, { maxCycles: 9 });
    const na = simulatePoint(naturallyAspirated(m), t, { maxCycles: 6 });
    const tb = r.turbos![0];
    expect(tb.boostPressure).toBeGreaterThan(1.3);
    expect(tb.speed).toBeGreaterThan(60000);
    expect(tb.compressorEfficiency).toBeGreaterThan(0.4);
    expect(tb.turbinePower).toBeGreaterThan(0);
    expect(r.power).toBeGreaterThan(1.3 * na.power);
    expect(r.traces.turbos?.[0].speed).toHaveLength(720);
  }, 120000);

  it('tutorial_9 waste-gate limits boost and the shaft power balance converges', () => {
    const m9 = load('tutorial_9');
    const m8 = load('tutorial_8');
    const t = m9.tests[rpmIndex(m9, 5000)];
    const r9 = simulatePoint(m9, t, { maxCycles: 20 });
    const r8 = simulatePoint(m8, m8.tests[rpmIndex(m8, 5000)], { maxCycles: 6 });
    const tb = r9.turbos![0];
    expect(r9.converged).toBe(true);
    expect(tb.boostPressure).toBeGreaterThan(1.5);
    expect(tb.boostPressure).toBeLessThan(2.2);
    expect(tb.wastegateArea).toBeGreaterThan(50);
    expect(r8.turbos![0].boostPressure).toBeGreaterThan(tb.boostPressure + 0.5);
    expect(Math.abs(tb.turbinePower - tb.compressorPower) / tb.compressorPower).toBeLessThan(0.05);
    expect(r9.traces.turbos?.[0].wastegateArea).toBeDefined();
  }, 120000);

  it('tutorial_9b lets the opening pressure vary with engine speed', () => {
    const m = load('tutorial_9b');
    const r = simulatePoint(m, m.tests[rpmIndex(m, 4000)], { maxCycles: 14 });
    // lookup gives 200 kPa to 4000 rpm, so the gate holds boost near 2 bar
    expect(r.turbos![0].boostPressure).toBeGreaterThan(1.7);
    expect(r.turbos![0].boostPressure).toBeLessThan(2.3);
  }, 120000);

  it('tutorial_10 runs with a charge cooler and a waste-gate controller', () => {
    const m = load('tutorial_10');
    const r = simulatePoint(m, m.tests[2], { maxCycles: 8 });
    expect(r.turbos![0].boostPressure).toBeGreaterThan(1.2);
    expect(r.warnings.filter((w) => /not simulated/i.test(w))).toHaveLength(0);
    expect(m.turbo?.coolers.length).toBe(1);
  }, 120000);
});

describe('synthetic charge devices', () => {
  function withPlenum(): EngineModel {
    const m = singleCylinder();
    m.plenums = [{ id: 1, label: 'plenum', volume: 2000 }];
    m.tests[0].maxCycles = 8;
    m.connections = [
      { a: { kind: 'cylinder', id: 1 }, b: { kind: 'plenum', id: 1 }, via: [{ kind: 'valve', id: 1 }] },
      { a: { kind: 'cylinder', id: 1 }, b: { kind: 'exit', id: 1 }, via: [{ kind: 'valve', id: 2 }] },
    ];
    return m;
  }

  it('a crank driven positive displacement supercharger raises intake pressure and costs power', () => {
    const m = withPlenum();
    const base = simulatePoint({ ...m, connections: [{ ...m.connections[0], b: { kind: 'plenum', id: 1 } }, m.connections[1], { a: { kind: 'inlet', id: 1 }, b: { kind: 'plenum', id: 1 }, via: [] }] }, m.tests[0]);
    m.compressors = [{
      id: 1, label: 'roots', drive: { kind: 'crank', ratio: 2.5 }, mechEff: 0.95,
      positive: { swept: 0.5, pr: [1, 2], volEff: [0.9, 0.8], adiabaticEff: [0.6, 0.6], isentropicEff: [0.6, 0.6] },
    }];
    m.connections.push({ a: { kind: 'inlet', id: 1 }, b: { kind: 'plenum', id: 1 }, via: [{ kind: 'compressor', id: 1 }] });
    const r = simulatePoint(m, m.tests[0]);
    const tb = r.turbos![0];
    expect(tb.boostPressure).toBeGreaterThan(1.1);
    expect(tb.compressorPower).toBeGreaterThan(0.5);
    expect(r.imep).toBeGreaterThan(base.imep);
    expect(r.bmep).toBeLessThan(r.imep - r.fmep - 0.05); // the drive load is taken from the crankshaft
  }, 60000);

  it('a charge cooler lowers the charge temperature', () => {
    const m = withPlenum();
    m.turbo = {
      coolers: [{ id: 1, label: 'ic', massFlow: [0, 0.01, 0.05], pressureLoss: [0, 0.001, 0.02], coolantTemp: [280, 280, 280], effectiveness: [0.8, 0.8, 0.8] }],
      shafts: [], links: [], sensors: [], actuators: [], controls: [],
    };
    m.connections.push({ a: { kind: 'inlet', id: 1 }, b: { kind: 'plenum', id: 1 }, via: [{ kind: 'cooler', id: 1 }] });
    const r = simulatePoint(m, m.tests[0]);
    const Tp = r.traces.plenums[0].temperature;
    const mean = Tp.reduce((a, b) => a + b, 0) / Tp.length;
    expect(mean).toBeLessThan(m.tests[0].ambientTemperature - 5);
    expect(r.volumetricEfficiency).toBeGreaterThan(0.6);
  }, 60000);
});
