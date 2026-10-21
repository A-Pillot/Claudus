import { describe, expect, it } from 'vitest';
import type { EngineModel } from '../src/model';
import { simulatePoint } from '../src/solver/simulate';
import { fuelDefaults } from '../src/thermo/index';

/** A single-cylinder engine with valves straight to ambient (like LES tutorial 1). */
export function singleCylinder(): EngineModel {
  return {
    title: ['test'], name: 'single', cycle: 4,
    cylinders: [{ id: 1, label: 'cyl', bore: 87, stroke: 84, conRod: 130, pinOffset: 0, compressionRatio: 11, firingAngle: 0 }],
    fuel: fuelDefaults('gasoline'),
    burn: { kind: 'wiebe', a: 5, m: 2 },
    heatTransfer: { kind: 'woschni', scale: 1 },
    temperatures: { head: 550, piston: 590, liner: 420 },
    friction: { a: 0.4, b: 0.005, c: 0.09, d: 0.0009 },
    valves: [
      { id: 1, label: 'in', kind: 'intake', openAngle: 345, closeAngle: 600, maxLift: 8.5, diameter: 33 },
      { id: 2, label: 'ex', kind: 'exhaust', openAngle: 140, closeAngle: 380, maxLift: 8, diameter: 28 },
    ],
    ports: [], pipes: [], plenums: [], throttles: [],
    inlets: [{ id: 1, label: 'in', kind: 'inlet', pressure: 1.01325, temperature: 298 }],
    exits: [{ id: 1, label: 'out', kind: 'exit', pressure: 1.01325, temperature: 298 }],
    compressors: [], turbines: [],
    connections: [
      { a: { kind: 'cylinder', id: 1 }, b: { kind: 'inlet', id: 1 }, via: [{ kind: 'valve', id: 1 }] },
      { a: { kind: 'cylinder', id: 1 }, b: { kind: 'exit', id: 1 }, via: [{ kind: 'valve', id: 2 }] },
    ],
    tests: [{ label: 't', speed: 3000, afr: 14.5, burnStart: -20, burnDuration: 50, ambientPressure: 1.01325, ambientTemperature: 298, maxCycles: 8, tolerance: 0.01 }],
    layout: {},
  };
}

describe('engine solver', () => {
  it('runs a single cylinder engine with plausible performance', () => {
    const m = singleCylinder();
    const r = simulatePoint(m, m.tests[0]);
    console.log({ imep: r.imep, bmep: r.bmep, power: r.power, ve: r.volumetricEfficiency, bsfc: r.bsfc, pmax: r.cylinders[0].peakPressure, at: r.cylinders[0].peakPressureAngle, eff: r.thermalEfficiency, cycles: r.cycles, w: r.warnings });
    expect(r.imep).toBeGreaterThan(7);
    expect(r.imep).toBeLessThan(16);
    expect(r.volumetricEfficiency).toBeGreaterThan(0.7);
    expect(r.volumetricEfficiency).toBeLessThan(1.15);
    expect(r.cylinders[0].peakPressure).toBeGreaterThan(30);
    expect(r.bsfc).toBeGreaterThan(200);
    expect(r.bsfc).toBeLessThan(400);
  });
});

describe('engine solver with pipes', () => {
  it('runs with intake and exhaust pipes and a plenum', () => {
    const m = singleCylinder();
    m.pipes = [
      { id: 1, label: 'runner', length: 300, stations: [{ x: 0, d: 36 }, { x: 300, d: 36 }], meshLength: 15, wallTemperature: 320, frictionFactor: 0.004 },
      { id: 2, label: 'primary', length: 500, stations: [{ x: 0, d: 32 }, { x: 500, d: 32 }], meshLength: 25, wallTemperature: 600, frictionFactor: 0.004 },
    ];
    m.plenums = [{ id: 1, label: 'airbox', volume: 2000 }];
    m.connections = [
      { a: { kind: 'cylinder', id: 1 }, b: { kind: 'pipe', id: 1, end: 2 }, via: [{ kind: 'valve', id: 1 }] },
      { a: { kind: 'cylinder', id: 1 }, b: { kind: 'pipe', id: 2, end: 1 }, via: [{ kind: 'valve', id: 2 }] },
      { a: { kind: 'plenum', id: 1 }, b: { kind: 'pipe', id: 1, end: 1 }, via: [] },
      { a: { kind: 'inlet', id: 1 }, b: { kind: 'plenum', id: 1 }, via: [] },
      { a: { kind: 'pipe', id: 2, end: 2 }, b: { kind: 'exit', id: 1 }, via: [] },
    ];
    const t0 = Date.now();
    const r = simulatePoint(m, m.tests[0]);
    console.log({ ms: Date.now() - t0, imep: r.imep, ve: r.volumetricEfficiency, pmep: r.cylinders[0].pmep, cycles: r.cycles, w: r.warnings, pipeP: Math.max(...r.traces.pipes[1].pressure.start) });
    expect(r.imep).toBeGreaterThan(6);
    expect(r.volumetricEfficiency).toBeGreaterThan(0.6);
    expect(r.volumetricEfficiency).toBeLessThan(1.3);
    expect(r.traces.pipes).toHaveLength(2);
  });
});
