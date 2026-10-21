import { describe, expect, it } from 'vitest';
import { readDat, writeDat } from '../src/io/dat.js';
import { Corner } from '../src/solver/corner.js';
import { solverOptionsFor, defaultSolverOptions } from '../src/solver/options.js';
import { analyse, bumpSweep, rollSweep, steerSweep } from '../src/results/derivatives.js';
import { toleranceAnalysis, spread } from '../src/results/tolerance.js';
import { boxPositions, constrainToLimit, limitOf, parseLimits, limitsLines, setAllLimits, setLimit } from '../src/model/limits.js';
import { defaultSteeringBox, setSteeringType } from '../src/model/steering.js';
import { fitAddedEnd } from '../src/model/axleFit.js';
import { addEndFromModel } from '../src/model/coordSets.js';
import { newModel } from '../src/model/new.js';
import { complianceAt } from '../src/compliance/apply.js';
import { defaultCompliance, defaultEndCompliance, defaultBush } from '../src/compliance/types.js';
import type { Model } from '../src/model/types.js';
import { sampleModel } from './helpers.js';

const type1 = () => sampleModel('type1.dat');

describe('solver options', () => {
  it('reads the model tolerances', () => {
    const o = solverOptionsFor({ tolerances: [1e-8, 0.1, 0.2], rollSolution: 2, steering: undefined });
    expect(o).toMatchObject({ kinTol: 1e-8, bumpPerturb: 0.1, steerPerturb: 0.2, rollOld: true, motion: 'ground' });
    // The older four-value layout falls back to the defaults.
    expect(solverOptionsFor({ tolerances: [1, 1e-5, 1, 1e-5], rollSolution: 1, steering: undefined })).toEqual(defaultSolverOptions());
  });

  it('moving body gives the same derivatives as moving ground, in the body-lowered frame', () => {
    const m = type1();
    const ground = new Corner(m.front!, 'front');
    const body = new Corner(m.front!, 'front', undefined, { ...defaultSolverOptions(), motion: 'body' });
    const a = bumpSweep(ground, m.params);
    const b = bumpSweep(body, m.params);
    expect(b).toHaveLength(a.length);
    a.forEach((r, i) => {
      for (const k of ['camber', 'toeSae', 'castor', 'damperRatio', 'rollCentreToBody', 'rollCentreToGround', 'halfTrackChange', 'wheelbaseChange', 'damperTravel'] as const)
        expect(b[i][k]).toBeCloseTo(r[k], 4);
    });
    // The ground stays at its static height and the body drops by the bump.
    const g = ground.solve({ bump: 30 });
    const s = body.solve({ bump: 30 });
    expect(s.groundZ).toBeCloseTo(body.z0, 9);
    expect(g.groundZ).toBeCloseTo(ground.z0 + 30, 9);
    const wc = ground.sides[0].wc;
    expect(s.points[wc][2]).toBeCloseTo(g.points[wc][2] - 30, 6);
  });

  it('the old roll solution rolls about the previous step centre', () => {
    const m = type1();
    const nu = new Corner(m.front!, 'front');
    const old = new Corner(m.front!, 'front', undefined, { ...defaultSolverOptions(), rollOld: true });
    const a = rollSweep(nu, { ...m.params, rollAngle: 4, rollIncrement: 1 });
    const b = rollSweep(old, { ...m.params, rollAngle: 4, rollIncrement: 1 });
    // Static agrees; a large roll differs a little (the roll centre moves) but stays close.
    const i0 = a.findIndex((r) => r.roll === 0);
    expect(b[i0].camber).toBeCloseTo(a[i0].camber, 6);
    const last = a.length - 1;
    expect(b[last].camber).not.toBeCloseTo(a[last].camber, 5);
    expect(Math.abs(b[last].camber - a[last].camber)).toBeLessThan(0.5);
  });

  it('tolerances change the perturbation sizes without changing the answer much', () => {
    const m = type1();
    const a = new Corner(m.front!, 'front');
    const b = new Corner(m.front!, 'front', undefined, { ...defaultSolverOptions(), bumpPerturb: 0.5 });
    expect(b.rates(b.solve({})).tcp[2]).toBeCloseTo(a.rates(a.solve({})).tcp[2], 3);
  });

  it('analyse takes the roll solution type from the model', () => {
    const m = type1();
    const r1 = analyse({ ...m, rollSolution: 1 })[0].roll;
    const r2 = analyse({ ...m, rollSolution: 2 })[0].roll;
    expect(r1.length).toBe(r2.length);
  });
});

describe('steering box', () => {
  it('turns the steering attachment about the box axis, with travel in degrees', () => {
    const m = type1();
    const box = setSteeringType(m, 'front', 'box');
    expect(box.steering?.front?.points).toEqual(defaultSteeringBox(m, 'front'));
    const rack = analyse(m)[0].steer;
    const sw = analyse({ ...box, params: { ...m.params, steerTravel: 20, steerIncrement: 10 } })[0].steer;
    expect(sw.map((r) => r.rack)).toEqual([-20, -10, 0, 10, 20]);
    expect(Math.abs(sw[4].toeOuter - sw[2].toeOuter)).toBeGreaterThan(0.1);
    expect(rack.length).toBeGreaterThan(0);
    const back = readDat(writeDat(box));
    expect(back.steering).toEqual(box.steering);
  });
});

describe('limit boxes', () => {
  it('defaults to 25 mm around the point and stores edits', () => {
    const m = type1();
    const b = limitOf(m, 'front', 0);
    expect(b.max[0] - b.min[0]).toBe(50);
    const set = setLimit(m, 'front', 0, { min: [0, 0, 0], max: [1, 2, 3] });
    expect(limitOf(set, 'front', 0).max).toEqual([1, 2, 3]);
    expect(limitOf(set, 'front', 1)).toEqual(limitOf(m, 'front', 1));
  });

  it('sets every point at once and round-trips through the file', () => {
    const m = setAllLimits(type1(), [1, 2, 3], [4, 5, 6]);
    const p = m.front!.points[2];
    expect(limitOf(m, 'front', 2).min).toEqual([p[0] - 1, p[1] - 2, p[2] - 3]);
    expect(limitOf(m, 'front', 2).max).toEqual([p[0] + 4, p[1] + 5, p[2] + 6]);
    const back = readDat(writeDat(m));
    expect(back.limits).toEqual(m.limits);
    expect(parseLimits(limitsLines(m.limits!))).toEqual(m.limits);
  });

  it('clamps a point in use and grows the box otherwise', () => {
    const box = { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    expect(constrainToLimit(box, [20, 5, -3], true).point).toEqual([10, 5, 0]);
    const grown = constrainToLimit(box, [20, 5, -3], false);
    expect(grown.point).toEqual([20, 5, -3]);
    expect(grown.box).toEqual({ min: [0, 0, -3], max: [20, 10, 10] });
  });

  it('has 27 positions', () => {
    const pts = boxPositions({ min: [0, 0, 0], max: [2, 4, 6] }, [1, 2, 3]);
    expect(pts).toHaveLength(27);
    expect(new Set(pts.map((p) => p.join())).size).toBe(27);
  });
});

describe('point tolerance analysis', () => {
  it('spreads camber when the upper ball joint moves within its box', () => {
    const m = setAllLimits(type1(), [2, 2, 2], [2, 2, 2]);
    const ubj = 5; // point 7, the upper ball joint, is the sixth data point
    const t = toleranceAnalysis({ ...m, params: { ...m.params, bumpTravel: 20, reboundTravel: 20, bumpIncrement: 20 } }, 'front', ubj);
    expect(t.runs).toHaveLength(27);
    const sp = spread(t, 'bump', (r) => r.bump, (r) => r.camber);
    expect(sp.map((s) => s.x)).toEqual([-20, 0, 20]);
    // Static camber comes from the wheel centre and stub axle, so only the moved positions spread.
    expect(sp[1].max - sp[1].min).toBeLessThan(1e-6);
    for (const s of [sp[0], sp[2]]) expect(s.max - s.min).toBeGreaterThan(0.02);
    // The centre run is the nominal result.
    const nominal = analyse({ ...m, params: { ...m.params, bumpTravel: 20, reboundTravel: 20, bumpIncrement: 20 } })[0].bump;
    sp.forEach((s, i) => {
      expect(nominal[i].camber).toBeGreaterThanOrEqual(s.min - 1e-9);
      expect(nominal[i].camber).toBeLessThanOrEqual(s.max + 1e-9);
    });
  });
});

describe('compliance switches', () => {
  it('bush rotation pre-loads act only away from static and change the deflection', () => {
    const c = new Corner(type1().front!, 'front');
    const data = defaultCompliance();
    data.front = { ...defaultEndCompliance(), bushes: [{ ...defaultBush(1), stiffness: [1000, 1000, 2000, 500, 500, 500] }, { ...defaultBush(2), stiffness: [1000, 1000, 2000, 500, 500, 500] }] };
    const on = { ...data, switches: { bushPreload: true } };
    const at = (d: typeof data, art: { bump?: number }) => complianceAt(c, c.solve(art), d).points[c.sides[0].wc];
    // Static: identical.
    expect(at(on, {})).toEqual(at(data, {}));
    // In bump the pre-load moves the wheel centre.
    const a = at(on, { bump: 40 });
    const b = at(data, { bump: 40 });
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(1e-4);
  });
});

describe('wheelbase and ground plane differences', () => {
  const both = () => {
    const front = newModel(1, 'front');
    const rear = newModel(1, 'rear');
    // Put the rear 2000 mm behind and 5 mm higher.
    rear.rear = { ...rear.rear!, points: rear.rear!.points.map((p) => [p[0] + 2000, p[1], p[2] + 5]) };
    return { front, rear };
  };

  it('can change the wheelbase parameter or move the added end', () => {
    const { front, rear } = both();
    const a = addEndFromModel(front, rear, { wheelbase: 'parameter', ground: 'translate' }).model;
    expect(a.params.wheelbase).toBeCloseTo(2000, 6);
    const b = addEndFromModel(front, rear, { wheelbase: 'move', ground: 'translate' }).model;
    expect(b.params.wheelbase).toBe(front.params.wheelbase);
    const wcx = (mm: Model, e: 'front' | 'rear') => { const c = new Corner(mm[e]!, e); return c.mech.staticPoints[c.mech.wheels[0].wc][0]; };
    expect(wcx(b, 'rear') - wcx(b, 'front')).toBeCloseTo(b.params.wheelbase, 6);
    expect(wcx(b, 'rear')).toBeGreaterThan(wcx(b, 'front'));
  });

  it('matches the ground planes by translation or by bump', () => {
    const { front, rear } = both();
    const merged = { ...front, rear: rear.rear };
    const z0 = (mm: Model, e: 'front' | 'rear') => new Corner(mm[e]!, e).z0;
    expect(z0(merged, 'rear') - z0(merged, 'front')).toBeCloseTo(5, 6);
    const t = fitAddedEnd(merged, 'rear', { wheelbase: 'parameter', ground: 'translate' });
    expect(z0(t, 'rear')).toBeCloseTo(z0(t, 'front'), 6);
    const b = fitAddedEnd(merged, 'rear', { wheelbase: 'parameter', ground: 'bump' });
    expect(z0(b, 'rear')).toBeCloseTo(z0(b, 'front'), 4);
    // Bump moves the points relative to the wheels, translation does not.
    expect(b.rear!.points[0][2]).not.toBeCloseTo(t.rear!.points[0][2], 3);
  });
});

void steerSweep;

describe('sweeps beyond the reach of the suspension', () => {
  it('stop at the first position that does not solve instead of reporting it', () => {
    const m = sampleModel('type1.dat');
    const c = new Corner(m.front!, 'front');
    const values = [-50, 0, 100, 200, 300, 400, 500, 600, 700, 800];
    const rows = bumpSweep(c, m.params, values);
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.length).toBeLessThan(values.length);
    // Every row that is reported is a converged solve that reached its bump.
    for (const r of rows) expect(c.solve({ bump: r.bump }).converged).toBe(true);
    expect(rows.map((r) => r.bump)).toEqual(values.slice(0, rows.length));
  });
});
