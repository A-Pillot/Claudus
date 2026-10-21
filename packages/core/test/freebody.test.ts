import { describe, expect, it } from 'vitest';
import { Corner } from '../src/solver/corner.js';
import { newSuspension } from '../src/model/new.js';
import { complianceAt } from '../src/compliance/apply.js';
import { freeBody, freeBodyParts } from '../src/compliance/freebody.js';
import { defaultBush, defaultCompliance, defaultEndCompliance, type ExternalForce } from '../src/compliance/types.js';

const lateral = (): ExternalForce => ({ label: 'Lat', on: true, end: 'front', part: 0, at: 0, head: [0, 0, 0], tail: [0, 500, 0], magnitude: 2000 });

function setup(bushes: number[] = [], slot = 1) {
  const c = new Corner(newSuspension(slot), 'front');
  const comp = defaultCompliance();
  comp.front = { ...defaultEndCompliance(), bushes: bushes.map((n) => defaultBush(n)) };
  comp.forceSets[0] = { label: 'Lateral', on: true, forces: [lateral()] };
  comp.activeSet = 0;
  const st = c.solve({});
  return { c, comp, st, detail: complianceAt(c, st, comp) };
}

describe('free body', () => {
  it('the forces on each part balance', () => {
    const { c, comp, st, detail } = setup([1, 2]);
    let checked = 0;
    for (const { part, name } of freeBodyParts(c)) {
      const fb = freeBody(c, st.points, comp, detail, part);
      if (!fb.forces.length) continue;
      const sum = fb.forces.reduce<[number, number, number]>((s, f) => [s[0] + f.force[0], s[1] + f.force[1], s[2] + f.force[2]], [0, 0, 0]);
      const biggest = Math.max(...fb.forces.map((f) => Math.hypot(...f.force)));
      expect(Math.hypot(...sum) / biggest, name).toBeLessThan(1e-6);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it.each([[1, true], [1, false], [3, true], [4, true], [7, true], [7, false], [14, false], [15, false]])('template %i balances with the spring preload %s', (slot, spring) => {
    const { c, comp, st } = setup([], slot);
    comp.settings.includeSpring = spring;
    const detail = complianceAt(c, st, comp);
    for (const { part, name } of freeBodyParts(c)) {
      const fb = freeBody(c, st.points, comp, detail, part);
      if (!fb.forces.length) continue;
      const sum = fb.forces.reduce<[number, number, number]>((s, f) => [s[0] + f.force[0], s[1] + f.force[1], s[2] + f.force[2]], [0, 0, 0]);
      const biggest = Math.max(...fb.forces.map((f) => Math.hypot(...f.force)));
      expect(Math.hypot(...sum) / biggest, name).toBeLessThan(1e-5);
    }
  });

  it('the tyre force and the external force appear on the wheel part', () => {
    const { c, comp, st, detail } = setup();
    const wheelPart = c.template.points[c.sides[0].wc].part1;
    const fb = freeBody(c, st.points, comp, detail, wheelPart);
    expect(fb.forces.some((f) => f.kind === 'tyre')).toBe(true);
    expect(fb.forces.find((f) => f.kind === 'external')!.force[1]).toBeCloseTo(-2000, 6);
  });
});
