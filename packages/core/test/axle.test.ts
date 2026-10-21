import { describe, expect, it } from 'vitest';
import { Corner } from '../src/solver/corner.js';
import { listTemplates, getTemplate } from '../src/template/registry.js';
import { convertToAxle, addRollBar, addTwoPartRack } from '../src/template/axle.js';
import { GenType, findGen, dataPoints } from '../src/template/types.js';
import { analyse, solveAxle } from '../src/results/derivatives.js';
import { newModel, newSuspension } from '../src/model/new.js';
import { readDat, writeDat } from '../src/io/dat.js';
import { rad, rotateAbout, type Vec3 } from '../src/math/vec3.js';

/** Rank of a matrix by Gram-Schmidt on its rows. */
function rank(J: number[][]): number {
  const basis: number[][] = [];
  for (const row of J) {
    let v = [...row];
    for (const b of basis) {
      const d = v.reduce((s, x, i) => s + x * b[i], 0);
      v = v.map((x, i) => x - d * b[i]);
    }
    const n = Math.hypot(...v);
    if (n > 1e-6 * Math.max(1, Math.hypot(...row))) basis.push(v.map((x) => x / n));
  }
  return basis.length;
}

/** Free motions of the mechanism without and with the tyre-on-ground equations. */
function freedom(c: Corner): { free: number; closed: number } {
  const m = c.mech;
  const x = m.initialX();
  const drive = { groundZ: c.z0, groundZ2: c.z0Left };
  const r0 = m.residuals(x, drive);
  const h = 1e-6;
  const J = r0.map(() => new Array(x.length).fill(0));
  for (let j = 0; j < x.length; j++) {
    const xp = [...x];
    xp[j] += h;
    const rp = m.residuals(xp, drive);
    for (let k = 0; k < r0.length; k++) J[k][j] = (rp[k] - r0[k]) / h;
  }
  const nWheels = m.wheels.length;
  return { free: x.length - rank(J.slice(0, -nWheels)), closed: x.length - rank(J) };
}

const FULL = [5, 8, 9, 21, 23, 26];

describe('full-axle templates', () => {
  it.each(listTemplates().map((t) => t.slot))('type %i moves once per wheel, and the tyres on the ground fix it', (slot) => {
    const c = new Corner(newSuspension(slot), 'rear');
    const { free, closed } = freedom(c);
    expect(free).toBe(c.sides.length);
    expect(closed).toBe(0);
  });

  it('lists the full-axle templates with both wheels', () => {
    for (const slot of FULL) {
      const t = getTemplate(slot);
      expect(t.fullAxle).toBe(true);
      expect(findGen(t, GenType.WheelCentre2)).toBeDefined();
    }
    expect([5, 8, 9, 21].every((s) => getTemplate(s).rigidAxle)).toBe(true);
    expect(getTemplate(23).rigidAxle).toBeUndefined();
  });

  it.each([23, 26])('type %i gives the same results as the type 1 corner it was built from', (slot) => {
    const [a] = analyse(newModel(1));
    const [b] = analyse(newModel(slot));
    expect(b.statics.camber).toBeCloseTo(a.statics.camber, 6);
    expect(b.statics.kingpin).toBeCloseTo(a.statics.kingpin, 6);
    expect(b.statics.rollCentreHeight).toBeCloseTo(a.statics.rollCentreHeight, 3);
    a.bump.forEach((r, i) => {
      expect(b.bump[i].camber).toBeCloseTo(r.camber, 5);
      expect(b.bump[i].toeSae).toBeCloseTo(r.toeSae, 5);
      expect(b.bump[i].rollCentreToBody).toBeCloseTo(r.rollCentreToBody, 2);
    });
    a.roll.forEach((r, i) => {
      expect(b.roll[i].camber).toBeCloseTo(r.camber, 5);
      expect(b.roll[i].rollCentre[2]).toBeCloseTo(r.rollCentre[2], 2);
    });
    a.steer.forEach((r, i) => {
      expect(b.steer[i].steerInner).toBeCloseTo(r.steerInner, 5);
      expect(b.steer[i].steerOuter).toBeCloseTo(r.steerOuter, 5);
    });
  });

  it('shows both wheels of a full axle in the live axle state, left in right-hand convention', () => {
    const c = new Corner(newSuspension(23), 'front');
    const st = solveAxle(c, { bump: 20 });
    expect(st.leftMirror).toBeUndefined();
    expect(st.geometryLeft.camber).toBeCloseTo(st.geometryRight.camber, 6);
    expect(st.geometryLeft.tcp[1]).toBeCloseTo(st.geometryRight.tcp[1], 4);
    expect(st.rollCentre[1]).toBeCloseTo(0, 4);
  });

  it('turns the roll bar halves together in bump and against each other in roll (type 23)', () => {
    const c = new Corner(newSuspension(23), 'front');
    const t = c.template;
    const at = (no: number) => c.mech.index.get(no)!;
    const end1 = at(findGen(t, GenType.RollBarBarAttachment)!.no);
    const end2 = t.points.findIndex((p, i) => i !== end1 && p.gen1 === GenType.RollBarBarAttachment);
    const dz = (pts: Vec3[], i: number) => pts[i][2] - c.mech.staticPoints[i][2];
    const bump = c.solve({ bump: 30 }).points;
    expect(dz(bump, end1)).toBeGreaterThan(1);
    expect(dz(bump, end2)).toBeCloseTo(dz(bump, end1), 6);
    // In the body's frame: undo the body roll (the driver rotates the body by -roll about X).
    const roll = c.solve({ roll: 2 }).points.map((q) => rotateAbout(q, [0, 0, c.rollAxisZ], [1, 0, 0], rad(2)));
    expect(Math.sign(dz(roll, end1) - dz(roll, end2))).toBe(1);
    expect(Math.abs(dz(roll, end1) - dz(roll, end2))).toBeGreaterThan(1);
  });

  it('slides the rack link with the rack and keeps the housing on the body (type 26)', () => {
    const c = new Corner(newSuspension(26), 'front');
    const t = c.template;
    const st = c.solve({ rack: 10 });
    for (const [i, p] of t.points.entries()) {
      const d = st.points[i][1] - c.mech.staticPoints[i][1];
      if (p.gen1 === GenType.RackLateralMount) expect(d).toBeCloseTo(10, 9);
      if (p.gen1 === GenType.RackMount) expect(d).toBeCloseTo(0, 9);
    }
  });

  it('puts a Panhard axle roll centre where the rod crosses the centre line (type 8)', () => {
    // Rod from (y -600, z 330) to (y 600, z 300) crosses y = 0 at z = 315. The tyre contact path adds a
    // little because the contact point slides across the tyre as the axle rolls.
    const [a] = analyse(newModel(8, 'rear'));
    expect(a.statics.rollCentreHeight).toBeGreaterThan(312);
    expect(a.statics.rollCentreHeight).toBeLessThan(322);
  });

  it('puts a Watts linkage roll centre near the cross link pivot (type 21)', () => {
    const [a] = analyse(newModel(21, 'rear'));
    expect(a.statics.rollCentreHeight).toBeGreaterThan(295);
    expect(a.statics.rollCentreHeight).toBeLessThan(315);
  });

  it.each([5, 8, 9, 21])('keeps a rigid axle (type %i) square to the ground in bump and roll', (slot) => {
    const [a] = analyse(newModel(slot, 'rear'));
    for (const r of a.bump) expect(Math.abs(r.camber)).toBeLessThan(0.01);
    for (const r of a.roll) expect(Math.abs(r.camber)).toBeLessThan(0.01);
    // In roll the axle turns about its roll centre, not the ground: the roll centre stays on the centre line.
    for (const r of a.roll) expect(Math.abs(r.rollCentre[1])).toBeLessThan(5);
  });

  it('sets a rigid-axle model to the rigid suspension type', () => {
    expect(newModel(5, 'rear').params.rearSuspensionType).toBe(2);
    expect(newModel(8, 'front').params.frontSuspensionType).toBe(2);
    expect(newModel(23).params.frontSuspensionType).toBe(1);
  });

  it.each(FULL)('writes and reads back a new type %i model', (slot) => {
    const m = newModel(slot, 'rear');
    const back = readDat(writeDat(m));
    expect(back.rear!.points).toEqual(m.rear!.points);
    expect(back.rear!.templateSlot).toBe(slot);
  });
});

describe('Edit menu template tools', () => {
  it('converts type 1 to a full axle numbered like SHARK type 23', () => {
    const t = convertToAxle(getTemplate(1), { startNo: 24 });
    const data = dataPoints(t);
    expect(data.map((p) => p.no)).toEqual([1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 16, 17, 18, 19, ...Array.from({ length: 14 }, (_, i) => 24 + i)]);
    expect(findGen(t, GenType.WheelCentre2)!.no).toBe(37);
    expect(findGen(t, GenType.StubAxle2)!.no).toBe(36);
    expect(findGen(t, GenType.SteeringAttachment2)!.no).toBe(33);
    expect(findGen(t, GenType.UpperBallJoint2)!.no).toBe(29);
    expect(findGen(t, GenType.WheelCentre2)!.def).toEqual([4092.5, -750, 313.1]);
    expect(t.parts).toHaveLength(8);
    expect(t.fullAxle).toBe(true);
  });

  it('carries dummy axis points across to the left side', () => {
    // Type 12 uses a dummy point to make its kingpost a revolute.
    const t = convertToAxle(getTemplate(12));
    const dummies = t.points.filter((p) => p.dummy);
    expect(dummies).toHaveLength(2);
    expect(dummies[1].def[1]).toBeCloseTo(-dummies[0].def[1], 9);
    const c = new Corner({ templateSlot: 12, points: dataPoints(t).map((p) => p.def), rollingRadius: 300 }, 'front', t);
    expect(freedom(c)).toEqual({ free: 2, closed: 0 });
  });

  it('refuses to add a roll bar or rack to a corner model', () => {
    expect(() => addRollBar(getTemplate(1), { part: 1, link: [0, 0, 0], barEnd: [0, 0, 0], mount: [0, 0, 0] })).toThrow(/full-axle/);
    expect(() => addTwoPartRack(getTemplate(1), { link: [0, 0, 0] })).toThrow(/full-axle/);
    expect(() => convertToAxle(getTemplate(23))).toThrow(/both sides/);
  });

  it('builds a working full axle from a strut corner (type 3 plus a two-part rack)', () => {
    const base = getTemplate(3);
    const steer = findGen(base, GenType.SteeringAttachment)!.def;
    const t = addTwoPartRack(convertToAxle(base), { link: [steer[0], steer[1] - 40, steer[2]] });
    const c = new Corner({ templateSlot: 3, points: dataPoints(t).map((p) => p.def), rollingRadius: 300 }, 'front', t);
    expect(freedom(c)).toEqual({ free: 2, closed: 0 });
    const corner = new Corner({ templateSlot: 3, points: dataPoints(base).map((p) => p.def), rollingRadius: 300 }, 'front');
    const a = corner.solve({ bump: 30, rack: 10 });
    const b = c.solve({ bump: 30, rack: 10 });
    expect(b.converged).toBe(true);
    const wc = (cc: Corner, pts: Vec3[]) => pts[cc.mech.wheelCentre];
    wc(corner, a.points).forEach((v, k) => expect(wc(c, b.points)[k]).toBeCloseTo(v, 5));
  });
});

describe('converting a model to a full axle', () => {
  it('mirrors the model points, not the template defaults', async () => {
    const { convertPointsToAxle } = await import('../src/template/axle.js');
    const t = getTemplate(1);
    const pts = dataPoints(t).map((p) => [p.def[0] + 5, p.def[1] + 7, p.def[2]] as Vec3);
    const out = convertPointsToAxle(t, pts, { slot: 31 });
    expect(out.points).toHaveLength(28);
    expect(out.points[14]).toEqual([pts[0][0], -pts[0][1], pts[0][2]]);
    const c = new Corner({ templateSlot: 31, points: out.points, rollingRadius: 225 }, 'front', out.template);
    const st = solveAxle(c, { bump: 10 });
    expect(st.geometryLeft.camber).toBeCloseTo(st.geometryRight.camber, 6);
  });
});
