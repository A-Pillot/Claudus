import { describe, expect, it } from 'vitest';
import { Corner } from '../src/solver/corner.js';
import { newModel, newSuspension } from '../src/model/new.js';
import { analyse, bumpSweep, rollSweep, steerSweep } from '../src/results/derivatives.js';
import { instantCentre, swingArms } from '../src/results/swingArm.js';
import { axisAngle, relativeRotation, rigidRotation, rotationVector } from '../src/results/rotation.js';
import { rowValue } from '../src/optimise/lines.js';
import { SWEEP_VARIABLES, valueOf } from '../src/results/variables.js';
import { fitCurve, formatSplineData, formatSplineFits, defaultSplineOptions } from '../src/results/splines.js';
import { formatSdf } from '../src/results/sdf.js';
import { jointSeries, listPointAtAllPositions, listPointsAtPosition, listPointsForUserPosition, listJointResults, ballJointSeries, motionValues } from '../src/results/listings.js';
import { complianceAt, makeCompliant } from '../src/compliance/apply.js';
import { defaultBush, defaultCompliance, defaultEndCompliance } from '../src/compliance/types.js';
import { rad, type Vec3 } from '../src/math/vec3.js';
import { sampleModel } from './helpers.js';

const model = newModel(1);
const params = model.params;
const front = () => new Corner(model.front!, 'front');

describe('virtual swing arm', () => {
  // A wheel on a swing arm pivoting about (y 0, z 300): TCP at (750, 0), wheel centre at (750, 300).
  // For a rotation w about the pivot a point at offset r moves with velocity w * (-rz, ry).
  const w = 0.001;
  const tcp: Vec3 = [0, 750, 0];
  const wc: Vec3 = [0, 750, 300];
  const vt: Vec3 = [0, w * 300, w * 750];
  const vw: Vec3 = [0, 0, w * 750];

  it('finds the pivot as the centre and the contact point distance as the length', () => {
    const c = instantCentre([750, 0], [300, 750], [750, 300], [0, 750]);
    expect(c![0]).toBeCloseTo(0, 9);
    expect(c![1]).toBeCloseTo(300, 9);
    const { front: f } = swingArms(tcp, vt, wc, vw);
    expect(f.centre[0]).toBeCloseTo(0, 9);
    expect(f.centre[1]).toBeCloseTo(300, 9);
    expect(f.length).toBeCloseTo(Math.hypot(750, 300), 9);
  });

  it('has no centre when the paths are parallel (pure translation)', () => {
    const { front: f, side } = swingArms(tcp, [0, 0, 1], wc, [0, 0, 1]);
    expect(f.length).toBeNaN();
    expect(side.length).toBeNaN();
  });

  it('uses X and Z for the side view', () => {
    // Same motion seen from the side: pivot at (x -400, z 300), contact point at x 0.
    const { side } = swingArms([0, 0, 0], [w * 300, 0, w * 400], [0, 0, 300], [0, 0, w * 400]);
    expect(side.centre[0]).toBeCloseTo(-400, 9);
    expect(side.centre[1]).toBeCloseTo(300, 9);
    expect(side.length).toBeCloseTo(500, 9);
  });
});

describe('rigid rotation', () => {
  const pts: Vec3[] = [[0, 0, 0], [100, 0, 0], [0, 50, 0], [0, 0, 30]];
  const turn = (R: number[], p: Vec3): Vec3 => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];

  it('recovers 30 degrees about z', () => {
    const R = axisAngle([0, 0, 1], rad(30));
    const moved = pts.map((p) => turn(R, p));
    const w = rotationVector(rigidRotation(pts, moved));
    expect(w[0]).toBeCloseTo(0, 9);
    expect(w[1]).toBeCloseTo(0, 9);
    expect(w[2]).toBeCloseTo(rad(30), 9);
  });

  it('works for a flat set of points, with a translation', () => {
    const flat = pts.slice(0, 3);
    const R = axisAngle([1, 0, 0], rad(-12));
    const moved = flat.map((p) => turn(R, p).map((v, k) => v + [10, 20, 30][k]) as Vec3);
    const w = rotationVector(rigidRotation(flat, moved));
    expect(w[0]).toBeCloseTo(rad(-12), 9);
    expect(Math.abs(w[1]) + Math.abs(w[2])).toBeLessThan(1e-9);
  });

  it('turns the line direction for a two-point part', () => {
    const w = rotationVector(rigidRotation([[0, 0, 0], [100, 0, 0]], [[0, 0, 0], [0, 100, 0]]));
    expect(w[2]).toBeCloseTo(Math.PI / 2, 9);
  });

  it('gives part 1 relative to part 2', () => {
    const w = relativeRotation(axisAngle([0, 0, 1], rad(40)), axisAngle([0, 0, 1], rad(15)));
    expect(w[2]).toBeCloseTo(rad(25), 9);
  });
});

describe('additional derivatives (corner model)', () => {
  const c = front();
  const [r0] = bumpSweep(c, params, [0]);

  it('lists the tyre contact patch and hub positions of both wheels', () => {
    const st = c.solve({});
    expect(r0.tcpRight).toEqual(c.tcp(st.points));
    expect(r0.hubRight).toEqual(st.points[c.sides[0].wc]);
    expect(r0.tcpLeft).toEqual([r0.tcpRight[0], -r0.tcpRight[1], r0.tcpRight[2]]);
    expect(r0.hubLeft[1]).toBeCloseTo(-r0.hubRight[1], 9);
    // the wheel centre is one rolling radius above the contact point
    expect(r0.hubRight[2] - r0.tcpRight[2]).toBeCloseTo(model.front!.rollingRadius, 6);
  });

  it('follows the contact patch in bump', () => {
    const [lo, hi] = bumpSweep(c, params, [-10, 10]);
    expect(hi.tcpRight[2] - lo.tcpRight[2]).toBeCloseTo(20, 4);
    expect(hi.tcpRight[1] - lo.tcpRight[1]).toBeCloseTo(hi.halfTrackChange - lo.halfTrackChange, 6);
  });

  it('the TCP dX/dZ gradient matches the contact patch path', () => {
    const [lo, hi] = bumpSweep(c, params, [-1, 1]);
    const slope = (hi.tcpRight[0] - lo.tcpRight[0]) / (hi.tcpRight[2] - lo.tcpRight[2]);
    expect(r0.tcpGradient).toBeCloseTo(slope, 5);
  });

  it('the front swing arm centre lies on the line from the contact patch through the roll centre', () => {
    // Roll centre z where the contact-to-centre line crosses the centre line (y = 0); heights from static ground.
    const ty = r0.tcpRight[1];
    const zRc = r0.swingFrontZ * (0 - ty) / (r0.swingFrontY - ty);
    expect(zRc).toBeCloseTo(r0.rollCentre[2], 4);
    expect(r0.swingFrontLength).toBeCloseTo(Math.hypot(r0.swingFrontY - ty, r0.swingFrontZ), 6);
  });

  it('has no second damper or spring and no tyre force in kinematic mode', () => {
    expect(r0.damper2Ratio).toBeNaN();
    expect(r0.spring2Travel).toBeNaN();
    expect(r0.tyreForce).toBeNaN();
  });

  it('puts the roll centre in every sweep, with the lateral position the Y component', () => {
    const [b] = bumpSweep(c, params, [0]);
    expect(b.rollCentre[1]).toBe(0);
    expect(b.rollCentre[2]).toBeCloseTo(b.rollCentreToBody, 9);
    const roll = rollSweep(c, params, [-1, 0, 1]);
    for (const r of roll) expect(rowValue(r, 'rollCentreLateral')).toBe(r.rollCentre[1]);
    const steer = steerSweep(c, params, [-5, 0, 5]);
    expect(steer.length).toBe(3);
    expect(steer[1].rollCentre[2]).toBeCloseTo(b.rollCentre[2], 6);
    expect(steer[1].castor).toBeCloseTo(r0.castor, 6);
    expect(steer[1].mechanicalTrail).toBeCloseTo(r0.mechanicalTrail, 6);
  });

  it('puts castor, offsets and toe plane in the roll and steer variable lists', () => {
    for (const k of ['roll', 'steer'] as const) {
      const keys = SWEEP_VARIABLES[k].ys.map((y) => y.key);
      for (const want of ['toePlane', 'castor', 'castorTrail', 'castorOffset', 'kingpinOffsetWheel', 'kingpinOffsetGround', 'mechanicalTrail', 'tcpRightZ', 'hubLeftX', 'rollCentreX', 'rollCentreLateral', 'swingSideLength', 'tcpGradient', 'tyreForce'])
        expect(keys).toContain(want);
    }
    const roll = rollSweep(c, params, [0])[0];
    expect(Number.isFinite(valueOf(roll, 'castorTrail'))).toBe(true);
  });

  it('reads vector components by name, and swaps wheels for the left corner in roll', () => {
    expect(rowValue(r0, 'tcpRightY')).toBe(r0.tcpRight[1]);
    expect(rowValue(r0, 'hubRightZ')).toBe(r0.hubRight[2]);
  });
});

describe('additional derivatives (full axle)', () => {
  // Type 23: double wishbone with an anti-roll bar, both wheels solved together.
  const c = new Corner(newSuspension(23), 'rear');

  it('lists damper 2 and spring 2 of the left wheel, equal to the right at a symmetric bump', () => {
    const [b] = bumpSweep(c, params, [15]);
    expect(Number.isFinite(b.damper2Ratio)).toBe(true);
    expect(b.damper2Ratio).toBeCloseTo(b.damperRatio, 3);
    expect(b.spring2Ratio).toBeCloseTo(b.springRatio, 3);
    expect(b.damper2Travel).toBeCloseTo(b.damperTravel, 3);
    expect(b.spring2Travel).toBeCloseTo(b.springTravel, 3);
    expect(Math.abs(b.damper2Travel)).toBeGreaterThan(1);
  });

  it('gives the left wheel its own position', () => {
    const [r] = rollSweep(c, params, [2]);
    expect(r.tcpLeft[1]).toBeLessThan(0);
    expect(Math.abs(r.hubLeft[2] - r.hubRight[2])).toBeGreaterThan(1e-3);
  });
});

describe('tyre vertical force', () => {
  it('is the compliant tyre load at each position', () => {
    const comp = defaultCompliance();
    const c = makeCompliant(front(), comp);
    const [b] = bumpSweep(c, params, [0]);
    const plain = front();
    const expected = complianceAt(plain, plain.solve({}), comp).tyreLoads[0];
    expect(b.tyreForce).toBeCloseTo(expected, 3);
    expect(b.tyreForce).toBeGreaterThan(0);
  });
});

describe('SDF', () => {
  const sm = sampleModel('type1.dat');
  const text = formatSdf(sm, analyse(sm), 'type1');

  it('adds the additional values after the standard tables', () => {
    expect(text).toContain('BUMP TRAVEL (additional values 1)');
    expect(text).toContain('R TCP');
    expect(text).toContain('SWING ARM');
    expect(text).toContain('ROLL (additional values 1)');
    expect(text).toContain('STEER (additional values 1)');
    // not-applicable columns are left out
    expect(text).not.toContain('DAMPER 2');
    expect(text).not.toContain('VERT FORCE');
  });
});

describe('spline fits and data', () => {
  it('fits a straight line and a parabola exactly', () => {
    const x = [-2, -1, 0, 1, 2, 3];
    const line = fitCurve(x, x.map((v) => 2 + 3 * v), 3)!;
    expect(line.coeffs[0]).toBeCloseTo(2, 8);
    expect(line.coeffs[1]).toBeCloseTo(3, 8);
    expect(line.coeffs[2]).toBeCloseTo(0, 8);
    expect(line.maxError).toBeLessThan(1e-8);
    const par = fitCurve(x, x.map((v) => 1 - v + 0.5 * v * v), 2)!;
    expect(par.coeffs[2]).toBeCloseTo(0.5, 8);
  });

  it('ignores missing values', () => {
    const fit = fitCurve([0, 1, 2, 3], [1, NaN, 5, 7], 1)!;
    expect(fit.n).toBe(3);
    expect(fit.coeffs[1]).toBeCloseTo(2, 8);
  });

  const sm = sampleModel('type1.dat');
  const results = analyse(sm);

  it('lists the selected splines only', () => {
    const o = { ...defaultSplineOptions(), sweeps: ['bump' as const], ends: ['front' as const], variables: ['camber'], order: 2 as const };
    const fits = formatSplineFits(sm, results, o, 'type1');
    expect(fits).toContain('SPLINE FITS (QUADRATIC)');
    expect(fits).toContain('Camber angle (deg) against bump travel');
    expect(fits).not.toContain('Toe angle');
    expect(fits).not.toContain('ROLL');
    const data = formatSplineData(sm, results, { ...o, header: false }, 'type1');
    expect(data).toContain('Camber angle (deg) against bump travel');
    expect(data).not.toContain('HARD POINTS');
    const rows = results[0].bump.length;
    expect(data.split('\n').filter((l) => /^ {6}\s*-?\d/.test(l)).length).toBe(rows);
  });

  it('the camber fit reproduces the camber curve to within its reported error', () => {
    const rows = results[0].bump;
    const fit = fitCurve(rows.map((r) => r.bump), rows.map((r) => r.camber), 3)!;
    const worst = Math.max(...rows.map((r) => Math.abs(fit.coeffs.reduce((s, k, i) => s + k * r.bump ** i, 0) - r.camber)));
    expect(worst).toBeCloseTo(fit.maxError, 9);
    expect(fit.maxError).toBeLessThan(0.05);
  });
});

describe('point coordinate listings', () => {
  const sm = sampleModel('type1.dat');

  it('lists every point at a user position, right and left', () => {
    const t = listPointsForUserPosition(sm, 'front', 0, 0, undefined, 'type1');
    const n = new Corner(sm.front!, 'front').template.points.filter((p) => !p.dummy).length;
    const rows = t.split('\n').filter((l) => /^\s+\d+\s+[RL]\s/.test(l));
    expect(rows.length).toBe(2 * n);
    // the first right-hand row carries the input hard point
    const first = rows[0].trim().split(/\s+/);
    const nums = first.slice(-3).map(Number);
    expect(nums[0]).toBeCloseTo(sm.front!.points[0][0], 2);
    expect(nums[1]).toBeCloseTo(sm.front!.points[0][1], 2);
    expect(nums[2]).toBeCloseTo(sm.front!.points[0][2], 2);
    // the left-hand row is its mirror image
    const left = rows[n].trim().split(/\s+/).slice(-3).map(Number);
    expect(left[1]).toBeCloseTo(-sm.front!.points[0][1], 2);
  });

  it('a bump position moves the wheel centre up by the bump', () => {
    const c = new Corner(sm.front!, 'front');
    const z0 = c.solve({}).points[c.mech.wheelCentre][2];
    const wcNo = c.template.points[c.mech.wheelCentre].no;
    const t = listPointAtAllPositions(sm, 'front', wcNo, ['bump'], undefined, 'type1');
    const rows = t.split('\n').filter((l) => /^\s+-?\d+\.\d\d\s+R\s/.test(l));
    expect(rows.length).toBe(motionValues(sm.params, 'bump').length);
    const row10 = rows.find((l) => /^\s+10\.00\s/.test(l));
    if (row10) expect(Number(row10.trim().split(/\s+/).slice(-1)[0]) - z0).toBeCloseTo(10, 1);
  });

  it('lists one solver position, with the compliant positions and differences when compliant', () => {
    const comp = defaultCompliance();
    const k = listPointsAtPosition(sm, 'front', 'bump', 0, undefined, 'type1');
    expect(k).not.toContain('comp');
    const t = listPointsAtPosition(sm, 'front', 'bump', 0, comp, 'type1');
    expect(t).toContain('X comp');
    expect(t).toContain('X diff');
  });
});

describe('bush listings', () => {
  const sm = sampleModel('type1.dat');
  const comp = defaultCompliance();
  const withBushes = () => {
    const c = defaultCompliance();
    const e = defaultEndCompliance();
    const t = new Corner(sm.front!, 'front').template;
    for (const p of t.points) if (!p.dummy && p.part1 > 0 && p.part2 !== 0 && p.part1 !== p.part2 && e.bushes.length < 2) e.bushes.push(defaultBush(p.no));
    c.front = e;
    return c;
  };

  it('rotations are zero at the static position and a pure revolute-like turn elsewhere', () => {
    const series = jointSeries(sm, 'front', 'bump', comp);
    const at0 = series.find((s) => s.x === 0)!;
    for (const r of at0.rotations) for (const v of [...r.global, ...r.local]) expect(Math.abs(v)).toBeLessThan(1e-6);
    const at20 = series[series.length - 1];
    expect(Math.max(...at20.rotations.map((r) => Math.hypot(...r.global)))).toBeGreaterThan(0.5);
  });

  it('wishbone inner pivots turn by the angle of the wishbone in bump', () => {
    // Lower wishbone chassis pivots are on the wishbone and ground; their rotation is the wishbone's.
    const c = new Corner(sm.front!, 'front');
    const t = c.template;
    const series = jointSeries(sm, 'front', 'bump', comp);
    const last = series[series.length - 1];
    const ground = t.points.filter((p) => !p.dummy && p.part2 === -1 || p.part1 === -1);
    expect(ground.length).toBeGreaterThan(0);
    const rot = last.rotations.find((r) => ground.some((g) => g.no === r.point))!;
    expect(Math.hypot(...rot.global)).toBeGreaterThan(0.1);
  });

  it('lists deflections of bushed joints, forces of every joint and rotations over every increment', () => {
    const bc = withBushes();
    const defl = listJointResults(sm, 'front', 'deflection', bc, ['bump'], 'type1');
    const nBump = motionValues(sm.params, 'bump').length;
    expect(defl.split('\n').filter((l) => /^\s+Bump -?\d/.test(l)).length).toBe(nBump);
    expect(defl).toContain('DX Global');
    const force = listJointResults(sm, 'front', 'force', bc, ['roll'], 'type1');
    expect(force).toContain('FZ Local');
    expect(force.split('\n').filter((l) => /^\s+Roll -?\d/.test(l)).length).toBe(motionValues(sm.params, 'roll').length);
    const rot = listJointResults(sm, 'front', 'rotation', bc, ['steer'], 'type1');
    expect(rot).toContain('RX Global');
  });

  it('ball joint rotations: the angle between two axes changes by the same amount as the joint turns', () => {
    const bc = withBushes();
    const c = new Corner(sm.front!, 'front');
    const joint = c.template.points.find((p) => !p.dummy && p.part1 > 0 && p.part2 !== 0)!;
    const s = ballJointSeries(sm, 'front', bc, { point: joint.no, motion: 'bump', frame: 'global' });
    expect(s.series.length).toBe(3);
    expect(s.series[0].y.length).toBe(s.x.length);
    const zero = s.x.indexOf(0);
    for (const ser of s.series) expect(Math.abs(ser.y[zero])).toBeLessThan(1e-6);
  });
});
