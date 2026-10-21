import { describe, expect, it } from 'vitest';
import { dist, type Vec3 } from '../src/math/vec3.js';
import { Corner } from '../src/solver/corner.js';
import { wheelLowestZ } from '../src/solver/mechanism.js';
import { listTemplates, getTemplate } from '../src/template/registry.js';
import { GenType, hasGen } from '../src/template/types.js';
import { bumpSweep, rollSweep, staticValues, steerSweep, wheelGeometry } from '../src/results/derivatives.js';
import { defaultParams } from '../src/model/types.js';
import { hasSample, sampleModel } from './helpers.js';
import { newSuspension } from '../src/model/new.js';

/** A corner from SHARK's sample file when there is one, otherwise from the template defaults. */
const cornerFor = (slot: number) => {
  if (!hasSample(`type${slot}.dat`)) return new Corner(newSuspension(slot), 'front');
  const m = sampleModel(`type${slot}.dat`);
  const data = m.front ?? m.rear!;
  return new Corner(data, m.front ? 'front' : 'rear');
};

/** Distance between every pair of points on each part, which a rigid mechanism must keep. */
function partDistances(c: Corner, pts: Vec3[]): number[] {
  const t = c.template;
  const out: number[] = [];
  t.parts.forEach((_, k) => {
    const idx = t.points.map((p, i) => (p.part1 === k + 1 || p.part2 === k + 1 ? i : -1)).filter((i) => i >= 0);
    // A rack housing is a compliant mount: in kinematics the rack link slides through it.
    if (idx.some((i) => hasGen(t.points[i], GenType.RackMount))) return;
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) out.push(dist(pts[idx[a]], pts[idx[b]]));
  });
  return out;
}

describe('kinematic solver', () => {
  const slots = listTemplates().map((t) => t.slot);

  it.each(slots)('type %i keeps every part rigid and the tyre on the ground through bump, roll and steer', (slot) => {
    const c = cornerFor(slot);
    const d0 = partDistances(c, c.mech.staticPoints);
    const cases = [{ bump: 50 }, { bump: -50 }, { roll: 2.5 }, { roll: -2.5 }, { bump: 30, rack: c.mech.rackPoint !== undefined ? 15 : 0 }];
    let warm: number[] | undefined;
    for (const a of cases) {
      const st = c.solve(a, warm);
      expect(st.converged).toBe(true);
      const d = partDistances(c, st.points);
      d.forEach((v, i) => expect(v).toBeCloseTo(d0[i], 5));
      c.sides.forEach((w, k) => {
        const low = wheelLowestZ(st.points[w.wc], st.points[w.stub], c.radius);
        expect(low).toBeCloseTo(k === 0 ? st.groundZ : st.drive.groundZ2!, 6);
      });
    }
  });

  it.each(slots)('type %i static solve returns the input points', (slot) => {
    const c = cornerFor(slot);
    const st = c.solve({});
    st.points.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(c.mech.staticPoints[i][k], 3)));
  });

  it('moves the wheel centre up by roughly the bump travel', () => {
    const c = cornerFor(1);
    const st = c.solve({ bump: 40 });
    expect(st.points[c.mech.wheelCentre][2] - c.mech.staticPoints[c.mech.wheelCentre][2]).toBeCloseTo(40, 0);
  });

  it('keeps the strut top on the strut axis (type 3)', () => {
    const c = cornerFor(3);
    const st = c.solve({ bump: 60 });
    const idx = (no: number) => c.mech.index.get(no)!;
    const [P, E, T] = [st.points[idx(6)], st.points[idx(8)], st.points[idx(7)]];
    const u = [E[0] - P[0], E[1] - P[1], E[2] - P[2]];
    const w = [T[0] - P[0], T[1] - P[1], T[2] - P[2]];
    const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    expect(Math.hypot(...cr) / Math.hypot(...u)).toBeLessThan(1e-6);
  });
});

/**
 * A double wishbone whose pivot axes run along X and whose ball joints lie in one YZ plane moves purely in
 * front view, so the classical construction applies: the instant centre is where the wishbone lines meet,
 * and the roll centre is where the line from the contact patch through the instant centre crosses y = 0.
 */
describe('roll centre against the front-view construction', () => {
  const pts: Record<number, Vec3> = {
    1: [-150, 300, 200], 2: [150, 300, 200], 3: [0, 700, 170],
    5: [-150, 420, 440], 6: [150, 420, 440], 7: [0, 680, 470],
    8: [0, 600, 180], 9: [0, 500, 600], 11: [120, 710, 260], 12: [120, 320, 264.75],
    16: [0, 510, 650], 17: [0, 620, 180], 18: [0, 700, 320], 19: [0, 750, 320],
  };
  const t = getTemplate(1);
  const data = { templateSlot: 1, points: t.points.map((p) => pts[p.no]), rollingRadius: 300 };
  const c = new Corner(data, 'front');

  const lineMeet = (a: [number, number], b: [number, number], p: [number, number], q: [number, number]): [number, number] => {
    const d1 = [b[0] - a[0], b[1] - a[1]];
    const d2 = [q[0] - p[0], q[1] - p[1]];
    const det = d1[0] * -d2[1] + d2[0] * d1[1];
    const s = ((p[0] - a[0]) * -d2[1] + d2[0] * (p[1] - a[1])) / det;
    return [a[0] + s * d1[0], a[1] + s * d1[1]];
  };

  const classical = (points: Vec3[], groundZ: number) => {
    const P = (no: number) => points[c.mech.index.get(no)!];
    const yz = (v: Vec3): [number, number] => [v[1], v[2]];
    const ic = lineMeet(yz(P(1)), yz(P(3)), yz(P(5)), yz(P(7)));
    const tcp = c.tcp(points);
    const rc = lineMeet(yz(tcp), ic, [0, -1000], [0, 1000]);
    return rc[1] - groundZ;
  };

  it('matches at static', () => {
    const s = staticValues(c);
    expect(s.rollCentreHeight).toBeCloseTo(classical(c.mech.staticPoints, c.z0), 1);
  });

  it('matches through bump travel', () => {
    const p = defaultParams();
    for (const row of bumpSweep(c, p, [-40, -20, 20, 40])) {
      const st = c.solve({ bump: row.bump });
      // The track rod is placed for near-zero bump steer; what remains keeps the motion slightly out of plane.
      expect(Math.abs(row.rollCentreToGround - classical(st.points, st.groundZ))).toBeLessThan(0.25);
    }
  });

  it('roll centre sits on the centreline at zero roll and moves sideways with roll', () => {
    const rows = rollSweep(c, defaultParams(), [-2, 0, 2]);
    const zero = rows[1];
    expect(zero.rollCentre[1]).toBeCloseTo(0, 6);
    expect(zero.rollCentre[2]).toBeCloseTo(staticValues(c).rollCentreHeight, 3);
    expect(rows[0].rollCentre[1]).toBeCloseTo(-rows[2].rollCentre[1], 3);
  });
});

describe('derivative sign conventions', () => {
  const t = getTemplate(1);
  const base = sampleModel('type1.dat').front!;
  const corner = (move: (no: number, p: Vec3) => Vec3) =>
    new Corner({ ...base, points: base.points.map((p, i) => move(t.points[i].no, [...p] as Vec3)) }, 'front');

  it('reports positive camber when the top of the wheel leans out', () => {
    // tilt the spindle so the wheel centre end drops: wheel top leans outboard
    const c = corner((no, p) => (no === 19 ? [p[0], p[1], p[2] - 2] : p));
    expect(wheelGeometry(c, c.mech.staticPoints, c.z0).camber).toBeGreaterThan(0);
  });

  it('reports positive toe when the front of the wheel points inward', () => {
    // the wheel centre end of the spindle moves forward: the wheel's front turns toward the car
    const c = corner((no, p) => (no === 19 ? [p[0] - 2, p[1], p[2]] : p));
    const g = wheelGeometry(c, c.mech.staticPoints, c.z0);
    expect(g.toeSae).toBeGreaterThan(0);
    expect(g.toePlane).toBeGreaterThan(0);
  });

  it('reports positive castor and kingpin for an axis leaning back and in at the top', () => {
    const c = corner((no, p) => (no === 7 ? [p[0] + 20, p[1], p[2]] : p));
    const g = wheelGeometry(c, c.mech.staticPoints, c.z0);
    expect(g.castor).toBeGreaterThan(0);
    expect(g.kingpin).toBeGreaterThan(0);
    expect(g.castorOffset).toBeGreaterThan(0);
    expect(g.mechanicalTrail).toBeGreaterThan(0);
    expect(g.kingpinOffsetWheel).toBeGreaterThan(0);
  });

  it('steers symmetrically and gives a finite Ackermann figure', () => {
    const c = cornerFor(1);
    const rows = steerSweep(c, defaultParams(), [-10, 0, 10]);
    expect(rows[1].toeInner).toBeCloseTo(0, 6);
    expect(rows[0].steerInner).toBeCloseTo(rows[2].steerInner, 6);
    expect(rows[2].steerInner).toBeGreaterThan(0);
    expect(Number.isFinite(rows[2].ackermann)).toBe(true);
  });

  it('gives a positive damper ratio and travel that shortens the damper in bump', () => {
    const rows = bumpSweep(cornerFor(1), defaultParams(), [0, 20]);
    expect(rows[0].damperRatio).toBeGreaterThan(1);
    expect(rows[1].damperTravel).toBeLessThan(0);
  });
});

describe('solveAxle', () => {
  it('is symmetric at static and puts the roll centre on the centreline', async () => {
    const { solveAxle, staticValues } = await import('../src/results/derivatives.js');
    const c = cornerFor(1);
    const s = solveAxle(c, {});
    expect(s.geometryLeft.camber).toBeCloseTo(s.geometryRight.camber, 9);
    expect(s.rollCentre[1]).toBeCloseTo(0, 6);
    expect(s.rollCentre[2] - c.z0).toBeCloseTo(staticValues(c).rollCentreHeight, 4);
  });

  it('matches the roll sweep roll centre when the body rolls', async () => {
    const { solveAxle } = await import('../src/results/derivatives.js');
    const c = cornerFor(1);
    const [row] = rollSweep(c, defaultParams(), [1.5]);
    const s = solveAxle(c, { roll: 1.5 });
    expect(s.rollCentre[1]).toBeCloseTo(row.rollCentre[1], 3);
    expect(s.rollCentre[2] - c.z0).toBeCloseTo(row.rollCentre[2], 3);
  });
});

describe('virtual steering axis', () => {
  it.each([1, 3])('type %i: the steer screw axis matches the ball-joint kingpin axis', (slot) => {
    const c = cornerFor(slot);
    for (const a of [{}, { bump: 30 }]) {
      const st = c.solve(a);
      const [lo, hi] = c.steeringAxis(st.points)!;
      const [slo, shi] = c.screwAxis(st)!;
      const u = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const s = [shi[0] - slo[0], shi[1] - slo[1], shi[2] - slo[2]];
      const nu = Math.hypot(...u), ns = Math.hypot(...s);
      const cos = (u[0] * s[0] + u[1] * s[1] + u[2] * s[2]) / (nu * ns);
      expect(cos).toBeGreaterThan(0.99999);
      // The screw axis passes (very nearly) through the lower ball joint. Steering a strut also lifts the
      // wheel slightly to keep it on the ground, which shifts the screw axis a fraction of a millimetre.
      const d = [lo[0] - slo[0], lo[1] - slo[1], lo[2] - slo[2]];
      const cr = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]];
      expect(Math.hypot(...cr) / ns).toBeLessThan(1);
    }
  });
});
