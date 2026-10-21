import { describe, expect, it } from 'vitest';
import {
  analyse, analyse2D, applyFree, bumpSweep2D, convert2DTo3D, convertTargets, defaultSweep, evalLine, freeModes, geometry2D,
  intersectLines, isTwoDText, newModel2D, readTwoD, solveBump, solveFree, solveRoll, staticRollCentre, userLinesFromModel, writeTwoD,
  type Model2D, type P2, type UserLines,
} from '../src/index.js';
import { sample } from './helpers.js';

const dw = () => readTwoD(sample('type1_2d.dat'));
const strut = () => readTwoD(sample('type2_2d.dat'));
const sweep = defaultSweep();
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Target lines that pass through every point of a reference model's own results. */
function linesOf(ref: Model2D): UserLines {
  const r = analyse2D(ref, sweep);
  return {
    camberBump: r.bump.map((b) => [b.bump, b.camber]),
    rcBump: r.bump.map((b) => [b.bump, b.rcHeight]),
    camberRoll: r.roll.map((b) => [b.roll, b.camber]),
    rcRoll: r.roll.map((b) => [b.roll, b.rcHeight]),
    rcLateralRoll: r.roll.map((b) => [b.roll, b.rcLateral]),
  };
}

describe('2D files', () => {
  it.each(['type1_2d.dat', 'type2_2d.dat'])('%s writes back byte for byte', (f) => {
    expect(writeTwoD(readTwoD(sample(f)))).toBe(sample(f));
  });

  it('reads the double wishbone sample', () => {
    const m = dw();
    expect(m.version).toEqual([1, 2]);
    expect(m.type).toBe(1);
    expect([m.track, m.kingpinAngle, m.kingpinOffset]).toEqual([1600, 10, 20]);
    expect([m.camberBump, m.camberRebound, m.rcStatic, m.rcBump, m.rcRebound]).toEqual([-0.04, -0.04, 50, 1, 1]);
    expect([m.lowerOuterZ, m.upperOuterZ]).toEqual([200, 500]);
    expect(m.lowerInner).toEqual([248, 175]);
    expect(m.upperInner).toEqual([367, 426]);
    expect([m.rollTravel, m.camberRoll, m.rcRoll, m.rcLateralRoll]).toEqual([5, 0.5, 0, 0]);
  });

  it('reads the strut sample, which has a damper angle and no upper inner point', () => {
    const m = strut();
    expect(m.type).toBe(2);
    expect(m.damperAngle).toBe(10);
    expect(m.camberBump).toBe(-0.04);
    expect(m.upperOuterZ).toBe(500);
    expect(m.lowerInner).toEqual([248, 175]);
  });

  it('writes changed values in a form that reads back, and keeps unknown trailing lines', () => {
    const m = dw();
    m.extra = ['SOMETHING ELSE', '1 2 3'];
    m.track = 1625.5;
    m.upperInner = [370, 430];
    const back = readTwoD(writeTwoD(m));
    expect(back.track).toBe(1625.5);
    expect(back.upperInner).toEqual([370, 430]);
    expect(back.extra).toEqual(['SOMETHING ELSE', '1 2 3']);
  });

  it('keeps Free-solve outer positions in a trailing section', () => {
    const m = applyFree(dw(), 'upperOuter', [680, 510]);
    const back = readTwoD(writeTwoD(m));
    expect(back.outerY).toEqual({ upper: 680 });
    expect(back.upperOuterZ).toBe(510);
  });

  it('tells 2D files from 3D files and rejects bad input', () => {
    expect(isTwoDText(sample('type1_2d.dat'))).toBe(true);
    expect(isTwoDText(sample('type1.dat'))).toBe(false);
    expect(() => readTwoD('1 2\n7\n')).toThrow(/suspension type/);
    expect(() => readTwoD('1 2\n1\n1600. 10.\n')).toThrow(/general data/);
  });
});

describe('2D solver', () => {
  it('puts the outer joints on the kingpin axis', () => {
    const g = geometry2D(dw());
    // Axis leaves the ground at 800 - 20 = 780 and leans inboard by 10 degrees.
    expect(g.ground).toEqual([780, 0]);
    expect(g.lowerOuter[0]).toBeCloseTo(780 - 200 * Math.tan((10 * Math.PI) / 180), 9);
    expect(g.upperOuter[0]).toBeCloseTo(780 - 500 * Math.tan((10 * Math.PI) / 180), 9);
  });

  it('gives the hand-constructed static roll centre for the double wishbone', () => {
    const g = geometry2D(dw());
    // Construction: instant centre = crossing of the two arm lines; the roll centre is where the line from
    // the contact patch through it meets the centre line.
    const ic = intersectLines(g.lowerInner, [g.lowerOuter[0] - 248, g.lowerOuter[1] - 175], g.upperInner, [g.upperOuter[0] - 367, g.upperOuter[1] - 426]) as P2;
    expect(ic[0]).toBeCloseTo(-1013.5, 0);
    expect(ic[1]).toBeCloseTo(111.5, 0);
    const slope = (ic[1] - 0) / (ic[0] - 800);
    const byHand = 0 + slope * (0 - 800);
    expect(byHand).toBeCloseTo(49.19, 1);
    expect(staticRollCentre(g)).toBeCloseTo(byHand, 9);
  });

  it('gives the hand-constructed static roll centre for the strut', () => {
    const m = strut();
    const g = geometry2D(m);
    // The second link is the line through the strut top at right angles to the slider axis.
    const d = (10 * Math.PI) / 180;
    const ic = intersectLines([248, 175], [g.lowerOuter[0] - 248, g.lowerOuter[1] - 175], g.upperOuter, [Math.cos(d), Math.sin(d)]) as P2;
    expect(ic[0]).toBeCloseTo(-1709, -1);
    const byHand = ((ic[1] - 0) / (ic[0] - 800)) * (0 - 800);
    expect(byHand).toBeCloseTo(24.36, 1);
    expect(staticRollCentre(g)).toBeCloseTo(byHand, 9);
  });

  it.each([['wishbone', dw], ['strut', strut]])('keeps every rigid-body constraint in bump (%s)', (_n, load) => {
    const m = load();
    const g = geometry2D(m);
    const lowerArm = dist(g.lowerOuter, g.lowerInner);
    const upperArm = dist(g.upperOuter, g.upperInner);
    const wheel = dist(g.lowerOuter, g.contact);
    for (const b of bumpSweep2D(g, { ...sweep, bumpSteps: 6, reboundSteps: 6 })) {
      expect(b.ok).toBe(true);
      const k = b.corner;
      expect(dist(k.lowerOuter, k.lowerInner)).toBeCloseTo(lowerArm, 6);
      expect(dist(k.lowerOuter, k.contact)).toBeCloseTo(wheel, 6);
      expect(k.contact[1]).toBeCloseTo(b.bump, 6);
      if (!g.strut) expect(dist(k.upperOuter, k.upperInner)).toBeCloseTo(upperArm, 6);
    }
  });

  it('keeps the strut top on the slider axis', () => {
    const g = geometry2D(strut());
    const b = solveBump(g, 40);
    // The slider axis is fixed in the upright: it passes through the upright's copy of the top, direction rotated by the pose.
    const th = b.corner.x[2];
    const n: P2 = [Math.cos(g.damper + th), Math.sin(g.damper + th)];
    const topInUpright: P2 = [
      b.corner.x[0] + Math.cos(th) * (g.upperOuter[0] - g.lowerOuter[0]) - Math.sin(th) * (g.upperOuter[1] - g.lowerOuter[1]),
      b.corner.x[1] + Math.sin(th) * (g.upperOuter[0] - g.lowerOuter[0]) + Math.cos(th) * (g.upperOuter[1] - g.lowerOuter[1]),
    ];
    const off = (g.upperOuter[0] - topInUpright[0]) * n[0] + (g.upperOuter[1] - topInUpright[1]) * n[1];
    expect(off).toBeCloseTo(0, 8);
  });

  it('gives negative camber gain in bump and a falling roll centre, like the sample targets', () => {
    const r = analyse2D(dw(), sweep);
    const top = r.bump[r.bump.length - 1];
    expect(top.bump).toBe(60);
    expect(top.camber).toBeLessThan(-1.5);
    expect(top.camber).toBeGreaterThan(-3);
    const bottom = r.bump[0];
    expect(bottom.camber).toBeGreaterThan(1);
    expect(bottom.rcHeight).toBeGreaterThan(r.rcStatic);
  });

  it('is symmetric in roll', () => {
    for (const m of [dw(), strut()]) {
      const g = geometry2D(m);
      const pivot = staticRollCentre(g);
      const p = solveRoll(g, 3, pivot);
      const n = solveRoll(g, -3, pivot);
      expect(p.ok && n.ok).toBe(true);
      // Rolling the other way swaps the wheels; the roll centre mirrors.
      expect(p.camber).toBeCloseTo(n.camberLeft, 8);
      expect(p.camberLeft).toBeCloseTo(n.camber, 8);
      expect(p.rcHeight).toBeCloseTo(n.rcHeight, 8);
      expect(p.rcLateral).toBeCloseTo(-n.rcLateral, 8);
      const z = solveRoll(g, 0, pivot);
      expect(z.rcLateral).toBeCloseTo(0, 8);
      expect(z.rcHeight).toBeCloseTo(pivot, 8);
      expect(z.camber).toBeCloseTo(0, 10);
    }
  });

  it('puts both contact patches on the ground in roll', () => {
    const g = geometry2D(dw());
    const r = solveRoll(g, 4, staticRollCentre(g));
    expect(r.right.contact[1]).toBeCloseTo(0, 8);
    expect(r.left.contact[1]).toBeCloseTo(0, 8);
    expect(r.left.contact[0]).toBeLessThan(0);
  });

  it('agrees with the 3D solver on a double wishbone converted to 3D', () => {
    const m = dw();
    const r2 = analyse2D(m, { ...sweep, bumpSteps: 4, reboundSteps: 4 });
    const m3 = convert2DTo3D(m, { slot: 1, end: 'front', wheelbase: 2240, castor: 0, rollingRadius: 225 });
    const a = analyse(m3)[0];
    for (const b of r2.bump) {
      const row = a.bump.find((x) => Math.abs(x.bump - b.bump) < 1e-9);
      expect(row).toBeDefined();
      expect(row!.camber).toBeCloseTo(b.camber, 1);
      expect(row!.rollCentreToGround).toBeCloseTo(b.rcHeight, 0);
      expect(row!.halfTrackChange).toBeCloseTo(b.halfTrackChange, 1);
    }
  });
});

describe('2D to 3D conversion of other templates', () => {
  it.each([1, 6, 14, 15, 17, 3, 4, 7])('template %i follows the 2D camber and has little bump steer', (slot) => {
    const m = slot >= 14 || slot === 1 || slot === 6 ? dw() : strut();
    const r2 = analyse2D(m, { ...sweep, bumpSteps: 2, reboundSteps: 2 });
    const a = analyse(convert2DTo3D(m, { slot, end: 'front', wheelbase: 2240, castor: 0, rollingRadius: 225 }))[0];
    let checked = 0;
    for (const b of r2.bump) {
      const row = a.bump.find((x) => Math.abs(x.bump - b.bump) < 1e-9);
      if (!row) continue;
      expect(row.camber).toBeCloseTo(b.camber, 1);
      expect(Math.abs(row.rollCentreToGround - b.rcHeight)).toBeLessThan(5);
      expect(Math.abs(row.toeSae)).toBeLessThan(1);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});

describe('targets', () => {
  it('builds straight user lines from the general data', () => {
    const m = dw();
    m.camberBump = -0.05;
    m.camberRebound = -0.03;
    m.rcBump = 0.8;
    const l = userLinesFromModel(m, sweep);
    expect(evalLine(l.camberBump, 40)).toBeCloseTo(-2, 9);
    expect(evalLine(l.camberBump, -20)).toBeCloseTo(0.6, 9);
    expect(evalLine(l.rcBump, 0)).toBe(50);
    expect(evalLine(l.rcBump, 60)).toBeCloseTo(98, 9);
    expect(evalLine(l.camberRoll, 2)).toBeCloseTo(1, 9);
  });

  it('interpolates, and extends the end segments past the line', () => {
    const line: [number, number][] = [[0, 0], [10, 10], [20, 10]];
    expect(evalLine(line, 5)).toBe(5);
    expect(evalLine(line, 15)).toBe(10);
    expect(evalLine(line, -5)).toBe(-5);
    expect(evalLine(line, 30)).toBe(10);
  });
});

describe('Free modes', () => {
  it('offers the right points for each type', () => {
    expect(freeModes(1)).toEqual(['fixAll', 'upperOuter', 'lowerOuter', 'upperInner', 'lowerInner']);
    expect(freeModes(2)).toEqual(['fixAll', 'upperOuter', 'lowerOuter', 'lowerInner']);
  });

  it('recovers a moved upper inner point from the curves it produces', () => {
    const ref = { ...dw(), upperInner: [345, 437] as P2 };
    const r = solveFree(dw(), 'upperInner', linesOf(ref), sweep);
    expect(r.converged).toBe(true);
    expect(r.point[0]).toBeCloseTo(345, 1);
    expect(r.point[1]).toBeCloseTo(437, 1);
    expect(r.rms).toBeLessThan(1e-3);
  });

  it('recovers a moved upper outer joint', () => {
    const ref = applyFree(dw(), 'upperOuter', [680, 515]);
    const r = solveFree(dw(), 'upperOuter', linesOf(ref), sweep);
    expect(r.point[0]).toBeCloseTo(680, 1);
    expect(r.point[1]).toBeCloseTo(515, 1);
  });

  it('recovers a moved lower inner point on a strut', () => {
    const ref = { ...strut(), lowerInner: [255, 168] as P2 };
    const r = solveFree(strut(), 'lowerInner', linesOf(ref), sweep);
    expect(r.point[0]).toBeCloseTo(255, 1);
    expect(r.point[1]).toBeCloseTo(168, 1);
  });

  it('recovers a moved strut top', () => {
    const ref = applyFree(strut(), 'upperOuter', [700, 490]);
    const r = solveFree(strut(), 'upperOuter', linesOf(ref), sweep);
    expect(r.point[0]).toBeCloseTo(700, 0);
    expect(r.point[1]).toBeCloseTo(490, 0);
  });

  it('gets close to straight-line targets and applying the result reproduces them', () => {
    const m = dw();
    const lines = userLinesFromModel(m, sweep);
    // Ask for a static roll centre the sample does not have.
    lines.rcBump = lines.rcBump.map(([x, y]) => [x, y - 20 + 0.0 * x]);
    const r = solveFree(m, 'upperInner', lines, sweep);
    const applied = applyFree(m, 'upperInner', r.point);
    expect(applied.upperInner).toEqual(r.point);
    const after = analyse2D(applied, sweep);
    const before = analyse2D(m, sweep);
    // The fitted point is closer to the target static roll centre than the original.
    expect(Math.abs(after.rcStatic - (m.rcStatic - 20))).toBeLessThan(Math.abs(before.rcStatic - (m.rcStatic - 20)));
  });
});

describe('Convert 2D to 3D', () => {
  it('lists the templates each 2D type can go to', () => {
    expect(convertTargets(1)).toEqual(expect.arrayContaining([1, 6, 14, 15, 17]));
    expect(convertTargets(2)).toEqual(expect.arrayContaining([3, 4, 7]));
    expect(convertTargets(1)).not.toContain(3);
  });

  it('places the 2D points exactly and the wheel above the contact patch', () => {
    const m = dw();
    const g = geometry2D(m);
    const out = convert2DTo3D(m, { slot: 1, end: 'rear', wheelbase: 2500, castor: 0, rollingRadius: 240 });
    expect(out.rear).toBeDefined();
    expect(out.front).toBeUndefined();
    expect(out.params.wheelbase).toBe(2500);
    const p = out.rear!.points;
    // Template 1 order: 1 2 3 5 6 7 8 9 11 12 16 17 18 19
    expect([p[0][1], p[0][2]]).toEqual([248, 175]);
    expect([p[1][1], p[1][2]]).toEqual([248, 175]);
    expect(p[2][1]).toBeCloseTo(g.lowerOuter[0], 9);
    expect(p[2][2]).toBe(200);
    expect([p[3][1], p[3][2]]).toEqual([367, 426]);
    expect(p[5][1]).toBeCloseTo(g.upperOuter[0], 9);
    expect(p[5][2]).toBe(500);
    expect(p[13][1]).toBe(800);
    expect(p[13][2]).toBe(240);
    expect(out.rear!.rollingRadius).toBe(240);
  });

  it('adds castor as a fore/aft lean of the kingpin axis', () => {
    const m = dw();
    const flat = convert2DTo3D(m, { slot: 1, end: 'front', wheelbase: 2240, castor: 0, rollingRadius: 225 });
    const cast = convert2DTo3D(m, { slot: 1, end: 'front', wheelbase: 2240, castor: 5, rollingRadius: 225 });
    const lo = (x: typeof flat) => x.front!.points[2][0];
    const up = (x: typeof flat) => x.front!.points[5][0];
    expect(up(cast) - lo(cast) - (up(flat) - lo(flat))).toBeCloseTo(300 * Math.tan((5 * Math.PI) / 180), 6);
  });

  it('converts a strut model and the result solves in 3D', () => {
    const m = strut();
    const out = convert2DTo3D(m, { slot: 3, end: 'front', wheelbase: 2240, castor: 0, rollingRadius: 225 });
    const a = analyse(out)[0];
    expect(a.bump.length).toBeGreaterThan(10);
    expect(a.bump.every((r) => Number.isFinite(r.camber))).toBe(true);
    // Same suspension, same static roll centre (to a mm).
    expect(a.bump.find((r) => r.bump === 0)!.rollCentreToGround).toBeCloseTo(analyse2D(m, sweep).rcStatic, -1);
  });

  it('rejects a template of the wrong kind', () => {
    expect(() => convert2DTo3D(dw(), { slot: 3, end: 'front', wheelbase: 2240, castor: 0, rollingRadius: 225 })).toThrow();
    expect(() => convert2DTo3D(newModel2D(2), { slot: 1, end: 'front', wheelbase: 2240, castor: 0, rollingRadius: 225 })).toThrow();
  });
});
