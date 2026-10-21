import { describe, expect, it } from 'vitest';
import { newModel } from '../src/model/new.js';
import { Corner } from '../src/solver/corner.js';
import { bumpSweep } from '../src/results/derivatives.js';
import { deviation, interpolate, lineFromData, sortUserLine } from '../src/optimise/lines.js';
import { kinematicSum, type SumTarget } from '../src/optimise/sum.js';
import { optimise, parameterValue, runOptimiser, withParameter, type OptimiserParameter } from '../src/optimise/optimiser.js';
import { getTemplate } from '../src/template/registry.js';
import { dataPoints } from '../src/template/types.js';
import { defaultBush, defaultCompliance, defaultEndCompliance } from '../src/compliance/types.js';
import { complianceCoefficients } from '../src/compliance/analysis.js';
import type { Model } from '../src/model/types.js';

const bumpRows = (m: Model) => bumpSweep(new Corner(m.front!, 'front'), m.params);
const idx = (no: number) => dataPoints(getTemplate(1)).findIndex((p) => p.no === no);

describe('user lines', () => {
  it('interpolates and only counts the overlap', () => {
    const pts: [number, number][] = [[0, 0], [10, 10]];
    expect(interpolate(pts, 5)).toBe(5);
    expect(interpolate(pts, 11)).toBeUndefined();
    expect(sortUserLine({ sweep: 'bump', variable: 'camber', end: 'front', points: [[10, 1], [0, 2]] }).points[0][0]).toBe(0);
  });

  it('a line copied from the data has zero deviation, and an offset line deviates by the offset', () => {
    const rows = bumpRows(newModel(1));
    const line = lineFromData(rows, 'bump', 'camber', 'front');
    expect(deviation(rows, line)).toBeCloseTo(0, 12);
    expect(deviation(rows, { ...line, points: line.points.map(([x, y]) => [x, y + 0.5]) })).toBeCloseTo(0.5, 9);
  });
});

describe('kinematic sum', () => {
  it('weights graph deviations and skips targets that are off or have no line', () => {
    const m = newModel(1);
    const line = lineFromData(bumpRows(m), 'bump', 'camber', 'front');
    const shifted = { ...line, points: line.points.map(([x, y]) => [x, y + 0.2] as [number, number]) };
    const targets: SumTarget[] = [
      { kind: 'graph', end: 'front', sweep: 'bump', variable: 'camber', weight: 3, on: true },
      { kind: 'graph', end: 'front', sweep: 'bump', variable: 'toeSae', weight: 1, on: true },
      { kind: 'graph', end: 'front', sweep: 'bump', variable: 'camber', weight: 5, on: false },
    ];
    const s = kinematicSum(m, targets, [shifted]);
    expect(s.total).toBeCloseTo(0.6, 9);
    expect(s.items[1].deviation).toBeUndefined();
    expect(s.items[2].weighted).toBe(0);
  });
});

describe('optimiser', () => {
  it('moves a hard point back onto the camber and toe curves it came from', () => {
    const base = newModel(1);
    const rows = bumpRows(base);
    const lines = [lineFromData(rows, 'bump', 'camber', 'front'), lineFromData(rows, 'bump', 'toeSae', 'front')];
    const targets: SumTarget[] = [
      { kind: 'graph', end: 'front', sweep: 'bump', variable: 'camber', weight: 1, on: true },
      { kind: 'graph', end: 'front', sweep: 'bump', variable: 'toeSae', weight: 1, on: true },
    ];
    const ubjZ: OptimiserParameter = { kind: 'point', end: 'front', point: 7, axis: 2, range: 10, increment: 1, on: true };
    const tieZ: OptimiserParameter = { kind: 'point', end: 'front', point: 12, axis: 2, range: 10, increment: 1, on: true };
    const start = withParameter(withParameter(base, ubjZ, parameterValue(base, ubjZ) + 6), tieZ, parameterValue(base, tieZ) - 4);
    const before = kinematicSum(start, targets, lines).total;
    const events = [...optimise({ model: start, targets, lines, parameters: [ubjZ, tieZ] })];
    const done = events[events.length - 1];
    if (done.type !== 'done') throw new Error('no result');
    expect(events[0].type).toBe('start');
    expect(events.some((e) => e.type === 'step')).toBe(true);
    expect(done.sum.total).toBeLessThan(before * 0.01);
    expect(done.model.front!.points[idx(7)][2]).toBeCloseTo(base.front!.points[idx(7)][2], 5);
    expect(done.model.front!.points[idx(12)][2]).toBeCloseTo(base.front!.points[idx(12)][2], 5);
    // The model passed in is not changed.
    expect(start.front!.points[idx(7)][2]).toBeCloseTo(base.front!.points[idx(7)][2] + 6, 9);
  });

  it('screens a parameter that does not change the sum', () => {
    const base = newModel(1);
    const lines = [lineFromData(bumpRows(base), 'bump', 'camber', 'front')];
    const targets: SumTarget[] = [{ kind: 'graph', end: 'front', sweep: 'bump', variable: 'camber', weight: 1, on: true }];
    // Moving the damper body end does not change camber.
    const damper: OptimiserParameter = { kind: 'point', end: 'front', point: 9, axis: 2, range: 10, increment: 1, on: true };
    const start = withParameter(base, damper, parameterValue(base, damper) + 3);
    const done = runOptimiser({ model: start, targets, lines, parameters: [damper] });
    expect(done.parameters[0].screened).toBe(true);
    expect(done.model.front!.points[idx(9)][2]).toBeCloseTo(start.front!.points[idx(9)][2], 9);
  });

  it('tunes a bush stiffness to a compliance coefficient target', () => {
    const m = newModel(1);
    m.compliance = defaultCompliance();
    m.compliance.front = { ...defaultEndCompliance(), bushes: [defaultBush(1), defaultBush(2)] };
    const goal = (k: number) => {
      const t = structuredClone(m.compliance!);
      t.front!.bushes.forEach((b) => (b.stiffness[1] = k));
      return complianceCoefficients(new Corner(m.front!, 'front'), t)[1].values.wcY;
    };
    const target = goal(600);
    const targets: SumTarget[] = [{ kind: 'compliance', end: 'front', set: 1, coefficient: 'wcY', target, weight: 1, on: true }];
    const params: OptimiserParameter[] = [1, 2].map((point) => ({ kind: 'bushStiffness', end: 'front', point, component: 1, range: 800, increment: 100, on: true }));
    const done = runOptimiser({ model: m, targets, lines: [], parameters: params });
    expect(done.sum.total).toBeLessThan(Math.abs(goal(1000) - target) * 0.2);
  });

  it('turns a bush axis', () => {
    const m = newModel(1);
    const p: OptimiserParameter = { kind: 'bushOrientation', end: 'front', point: 1, axis: 0, range: 90, increment: 10, on: true };
    const turned = withParameter(m, p, 90);
    const z = turned.compliance!.front!.bushes[0].zAxis;
    expect(z.kind).toBe('rel');
    if (z.kind === 'rel') {
      expect(z.v[1]).toBeCloseTo(-100, 9);
      expect(z.v[2]).toBeCloseTo(0, 9);
    }
  });
});
