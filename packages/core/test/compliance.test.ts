import { describe, expect, it } from 'vitest';
import { Corner } from '../src/solver/corner.js';
import { newModel, newSuspension } from '../src/model/new.js';
import { solveCompliance } from '../src/compliance/solve.js';
import { complianceCoefficients } from '../src/compliance/analysis.js';
import { makeCompliant } from '../src/compliance/apply.js';
import { defaultBush, defaultCompliance, defaultEndCompliance, defaultSettings, type ExternalForce } from '../src/compliance/types.js';
import { analyse, staticValues } from '../src/results/derivatives.js';
import { readDat, writeDat } from '../src/io/dat.js';
import { sample } from './helpers.js';

const down = (magnitude: number): ExternalForce => ({ label: '', on: true, end: 'front', part: 0, at: 0, head: [0, 0, 0], tail: [0, 0, -100], magnitude });

describe('compliance solver', () => {
  for (const slot of [1, 3, 26]) {
    it(`type ${slot}: a vertical load moves the wheel by the wheel rate in parallel with the tyre`, () => {
      const c = new Corner(newSuspension(slot), 'front');
      const st = c.solve({});
      const ratio = Math.abs(c.rates(st).springLength);
      const data = defaultEndCompliance();
      const kw = data.springs[0].rate * ratio * ratio;
      const res = solveCompliance(c, st, data, { settings: defaultSettings(), includeSpring: false, forces: [down(1000)] });
      const dz = res.points[c.mech.wheelCentre][2] - st.points[c.mech.wheelCentre][2];
      expect(dz).toBeCloseTo(1000 / (kw + data.tyreRate), 2);
    });
  }

  it('the spring preload is shared between the tyre and the wheel rate', () => {
    const c = new Corner(newSuspension(1), 'front');
    const st = c.solve({});
    const ratio = Math.abs(c.rates(st).springLength);
    const data = defaultEndCompliance();
    const s = data.springs[0];
    const kw = s.rate * ratio * ratio;
    const res = solveCompliance(c, st, data, { settings: defaultSettings() });
    expect(res.springForces[0]).toBeCloseTo(s.rate * (s.freeLength - s.fittedLength), 0);
    expect(res.tyreLoads[0]).toBeCloseTo((res.springForces[0] * ratio * data.tyreRate) / (data.tyreRate + kw), -1);
  });

  it('the rack template behaves like the plain corner', () => {
    const a = new Corner(newSuspension(1), 'front');
    const b = new Corner(newSuspension(26), 'front');
    const ra = solveCompliance(a, a.solve({}), defaultEndCompliance(), { settings: defaultSettings() });
    const rb = solveCompliance(b, b.solve({}), defaultEndCompliance(), { settings: defaultSettings() });
    expect(rb.tyreLoads[0]).toBeCloseTo(ra.tyreLoads[0], 1);
  });

  it('a soft bush lets the wheel steer under a lateral load', () => {
    const c = new Corner(newSuspension(1), 'front');
    const rigid = complianceCoefficients(c, defaultCompliance());
    const data = defaultCompliance();
    data.front = { ...defaultEndCompliance(), bushes: [defaultBush(1), defaultBush(2), defaultBush(12)] };
    const soft = complianceCoefficients(c, data);
    const lat = (s: typeof soft) => s.find((x) => x.label.startsWith('Lateral'))!.values;
    expect(Math.abs(lat(rigid).toe)).toBeLessThan(0.01);
    expect(Math.abs(lat(soft).toe)).toBeGreaterThan(Math.abs(lat(rigid).toe));
    expect(Math.abs(lat(soft).wcY)).toBeGreaterThan(0.1);
  });
});

describe('compliant analysis', () => {
  it('runs every sweep and lowers the static wheel under the spring and tyre', () => {
    const m = newModel(1);
    const kin = analyse(m)[0];
    const comp = analyse(m, { compliant: true })[0];
    expect(comp.bump.length).toBe(kin.bump.length);
    expect(comp.bump.every((r) => Number.isFinite(r.camber))).toBe(true);
    // The spring preload pushes the wheel down against the tyre.
    expect(comp.statics.wc[2]).not.toBeCloseTo(kin.statics.wc[2], 3);
  });

  it('makeCompliant changes the corner solve', () => {
    const c = new Corner(newSuspension(1), 'front');
    const before = staticValues(c);
    makeCompliant(c, defaultCompliance(), 1);
    const after = staticValues(c);
    expect(after.toeSae).not.toBeCloseTo(before.toeSae, 6);
  });
});

describe('compliance in model files', () => {
  it('reads the Tutorial 3 COMPLIANCE section', () => {
    const m = readDat(sample('Tutorial3.dat'));
    const f = m.compliance!.front!;
    expect(f.springs[0]).toEqual({ rate: 41.5, freeLength: 300, fittedLength: 246.5 });
    expect(f.dampers[0]).toBeCloseTo(0.4);
    expect(f.rollBarRate).toBe(2e6);
    expect(f.bushes).toHaveLength(4);
    expect(f.bushes[0].stiffness).toEqual([1000, 1000, 2000, 0, 0, 0]);
    expect(f.bushes[0].xzPlane).toEqual({ kind: 'rel', v: [0, 100, 0] });
    expect(f.bushes[2].zAxis.kind).toBe('point');
  });

  it('writes an unedited file back unchanged', () => {
    const text = sample('Tutorial3.dat');
    const m = readDat(text);
    const out = writeDat(m);
    const sect = (t: string) => t.replace(/\r/g, '').split('\nCOMPLIANCE\n')[1].split('\nFORCES\n')[0];
    expect(sect(out)).toBe(sect(text));
    expect(out).not.toContain('CLAUDUS COMPLIANCE');
  });

  it('round-trips edited compliance data', () => {
    const m = readDat(sample('Tutorial3.dat'));
    const c = structuredClone(m.compliance!);
    c.front!.bushes[1].stiffness = [500, 600, 700, 1, 2, 3];
    c.front!.bushes[1].lossAngle = 5;
    c.front!.tyreRate = 250;
    c.settings.includeSpring = false;
    c.forceSets[1].forces[0].magnitude = 2500;
    c.forceSets[2].label = "Driver's brake";
    const out = writeDat({ ...m, compliance: c });
    expect(out).toContain('CLAUDUS COMPLIANCE');
    const back = readDat(out).compliance!;
    expect(back.front!.bushes[1].stiffness).toEqual([500, 600, 700, 1, 2, 3]);
    expect(back.front!.bushes[1].lossAngle).toBe(5);
    expect(back.front!.tyreRate).toBe(250);
    expect(back.settings.includeSpring).toBe(false);
    expect(back.forceSets[1].forces[0].magnitude).toBe(2500);
    expect(back.forceSets[2].label).toBe("Driver's brake");
    expect(back.front!.bushes.map((b) => b.point)).toEqual(c.front!.bushes.map((b) => b.point));
    expect(back.front!.bushes[2].zAxis).toEqual(c.front!.bushes[2].zAxis);
  });

  it('adds compliance to a model that had none', () => {
    const m = newModel(1);
    const c = defaultCompliance();
    c.front = { ...defaultEndCompliance(), bushes: [defaultBush(1)] };
    const back = readDat(writeDat({ ...m, compliance: c })).compliance!;
    expect(back.front!.bushes).toEqual([{ ...defaultBush(1), xzPlane: { kind: 'none' } }]);
  });
});
