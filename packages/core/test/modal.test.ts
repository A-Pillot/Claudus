import { describe, expect, it } from 'vitest';
import { Corner } from '../src/solver/corner.js';
import { newModel, newSuspension } from '../src/model/new.js';
import { partCentroids, partMasses, forcedSweep, modalAnalysis, displacedPoints, responseAtPhase, forcedSetup, forcedResponseAt } from '../src/compliance/modal.js';
import { defaultCompliance, defaultEndCompliance, type ComplianceData, type PartMass } from '../src/compliance/types.js';
import { generalizedEigen, symmetricEigen } from '../src/math/eigen.js';
import { readDat, writeDat } from '../src/io/dat.js';

/** A heavy upright on light links, so the lowest mode is wheel hop. */
function hopModel(slot: number): { c: Corner; data: ComplianceData; kw: number } {
  const c = new Corner(newSuspension(slot), 'front');
  const st = c.solve({});
  const upright = c.template.points[c.mech.wheelCentre].part1;
  const data = defaultCompliance();
  const masses: PartMass[] = c.template.parts.map((_, b) => ({
    part: b + 1, cog: { kind: 'none' }, zAxis: { kind: 'none' }, xzPlane: { kind: 'none' },
    mass: b + 1 === upright ? 30 : 0.01,
    inertia: b + 1 === upright ? [3e5, 3e5, 3e5, 0, 0, 0] : [10, 10, 10, 0, 0, 0],
  }));
  data.front = { ...defaultEndCompliance(), masses };
  const ratio = Math.abs(c.rates(st).springLength);
  return { c, data, kw: 41.5 * ratio * ratio };
}

describe('eigen solvers', () => {
  it('finds the eigenvalues of a symmetric matrix', () => {
    const { values } = symmetricEigen([[2, 1, 0], [1, 2, 1], [0, 1, 2]]);
    expect([...values].sort((a, b) => a - b).map((v) => +v.toFixed(9))).toEqual([2 - Math.SQRT2, 2, 2 + Math.SQRT2].map((v) => +v.toFixed(9)));
  });

  it('solves a two-mass spring chain', () => {
    // m1 = m2 = 1, k1 = k2 = 1: λ = (3 ∓ √5) / 2
    const { values, vectors } = generalizedEigen([[2, -1], [-1, 1]], [[1, 0], [0, 1]]);
    expect(values[0]).toBeCloseTo((3 - Math.sqrt(5)) / 2, 10);
    expect(values[1]).toBeCloseTo((3 + Math.sqrt(5)) / 2, 10);
    expect(Math.hypot(...vectors[0])).toBeCloseTo(1, 10);
  });
});

describe('modal analysis', () => {
  for (const slot of [1, 3, 15]) {
    it(`type ${slot}: the lowest mode is wheel hop on the tyre and spring`, () => {
      const { c, data, kw } = hopModel(slot);
      const r = modalAnalysis(c, c.solve({}), data);
      expect(r.modes).toHaveLength(6 * c.template.parts.length);
      const hop = Math.sqrt(((400 + kw) * 1000) / 30) / (2 * Math.PI);
      expect(r.modes[0].frequency).toBeGreaterThan(hop * 0.97);
      expect(r.modes[0].frequency).toBeLessThan(hop * 1.03);
      expect(r.modes[1].frequency).toBeGreaterThan(5 * hop);
      // Frequencies come out in ascending order.
      for (let i = 1; i < r.modes.length; i++) expect(r.modes[i].frequency).toBeGreaterThanOrEqual(r.modes[i - 1].frequency);
    });
  }

  it('runs with default masses and moves the points in a mode shape', () => {
    const c = new Corner(newSuspension(1), 'front');
    const st = c.solve({});
    const r = modalAnalysis(c, st, defaultCompliance());
    expect(r.masses.every((m) => m.isDefault && m.mass === 1)).toBe(true);
    expect(r.modes[0].frequency).toBeGreaterThan(0);
    // Mode 1 is the track rod spinning about its own axis (held only by the singularity stiffness), which
    // moves no points; mode 2 is wheel hop.
    const moves = (k: number) => displacedPoints(c, st, r.model, r.modes[k].shape, 10).some((p, i) => Math.abs(p[2] - st.points[i][2]) > 1e-3);
    expect(moves(0)).toBe(false);
    expect(moves(1)).toBe(true);
  });
});

describe('part masses', () => {
  it('resolves the same masses as the modal analysis', () => {
    const c = new Corner(newSuspension(1), 'front');
    const st = c.solve({});
    const data = defaultCompliance();
    const viaModal = modalAnalysis(c, st, data).masses;
    const direct = partMasses(c, st, defaultEndCompliance());
    expect(direct).toEqual(viaModal);
    expect(partCentroids(c, st)).toHaveLength(c.template.parts.length);
  });

  it('puts a point-defined C of G at that point', () => {
    const c = new Corner(newSuspension(1), 'front');
    const st = c.solve({});
    const e = defaultEndCompliance();
    const no = c.template.points.find((p) => !p.dummy && p.part1 === 1)!.no;
    e.masses = [{ part: 1, cog: { kind: 'point', point: no }, zAxis: { kind: 'none' }, xzPlane: { kind: 'none' }, mass: 5, inertia: [1, 2, 3, 0, 0, 0] }];
    const m = partMasses(c, st, e)[0];
    expect(m.mass).toBe(5);
    expect(m.cog).toEqual(st.points[c.mech.index.get(no)!]);
  });
});

describe('forced-damped response', () => {
  it('tends to the static deflection at low frequency and peaks at wheel hop', () => {
    const { c, data, kw } = hopModel(1);
    data.activeSet = 4; // 1 kN vertical at the contact point
    data.settings.includeSpring = false;
    const st = c.solve({});
    const upright = c.template.points[c.mech.wheelCentre].part1;
    const hop = modalAnalysis(c, st, data).modes[0].frequency;
    const [low, peak, high] = forcedSweep(c, st, data, [0.01, hop, 4 * hop]).map((r) => r.parts[upright - 1].amplitude[2]);
    expect(low).toBeCloseTo(1000 / (400 + kw), 1);
    expect(peak).toBeGreaterThan(5 * low);
    expect(high).toBeLessThan(low);
  });

  it('gives the motion at any phase', () => {
    const { c, data } = hopModel(1);
    data.activeSet = 4;
    const r = forcedResponseAt(forcedSetup(c, c.solve({}), data), 10);
    expect(responseAtPhase(r, 0)).toEqual(r.re);
    responseAtPhase(r, -90).forEach((x, i) => expect(x).toBeCloseTo(r.im[i], 9));
  });
});

describe('mass data in files', () => {
  it('round-trips part masses', () => {
    const m = newModel(1);
    const { data } = hopModel(1);
    data.front!.masses![0] = { ...data.front!.masses![0], cog: { kind: 'point', point: 3 }, zAxis: { kind: 'rel', v: [0, 0, 100] }, xzPlane: { kind: 'abs', v: [1, 2, 3] }, inertia: [1, 2, 3, 4, 5, 6] };
    const back = readDat(writeDat({ ...m, compliance: data })).compliance!;
    expect(back.front!.masses).toEqual(data.front!.masses);
  });
});
