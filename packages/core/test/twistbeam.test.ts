import { describe, expect, it } from 'vitest';
import { newModel } from '../src/model/new.js';
import { Corner } from '../src/solver/corner.js';
import { getTemplate } from '../src/template/registry.js';
import { checkTemplate } from '../src/template/check.js';
import { solveCompliance } from '../src/compliance/solve.js';
import { defaultEndCompliance, defaultSettings } from '../src/compliance/types.js';

describe('type 29 twist beam', () => {
  it('has two free motions and no closure errors', () => {
    const r = checkTemplate(getTemplate(29)!, undefined, 310);
    expect(r.errors).toEqual([]);
    expect(r.freedom?.free).toBe(2);
  });

  it('keeps camber and toe in pure bump and gains camber in roll', () => {
    const c = new Corner(newModel(29, 'rear').rear!, 'rear');
    const bump = c.solve({ bump: 30 });
    const st = c.solve({});
    const [r] = c.mech.wheels;
    // Both wheels rise together: the beam does not twist, so the wheel axis keeps its direction.
    const axis = (p: typeof st.points) => p[r.wc].map((v, k) => v - p[r.stub][k]);
    const a0 = axis(st.points), a1 = axis(bump.points);
    const ang = (v: number[]) => Math.atan2(v[2], v[1]);
    expect(Math.abs(ang(a1) - ang(a0))).toBeLessThan(1e-4);
    const roll = c.solve({ roll: 3 });
    expect(Math.abs(ang(axis(roll.points)) - ang(a0))).toBeGreaterThan(0.005);
  });

  it('shares a one-wheel load through beam torsion', () => {
    const c = new Corner(newModel(29, 'rear').rear!, 'rear');
    const st = c.solve({});
    const lift = (rate: number) => {
      const res = solveCompliance(c, st, { ...defaultEndCompliance(), rollBarRate: rate }, {
        settings: defaultSettings(), includeSpring: false,
        forces: [{ label: '', on: true, end: 'rear', part: 0, at: 0, head: [0, 0, 0], tail: [0, 0, -100], magnitude: 1000 }],
      });
      return c.mech.wheels.map((w) => res.points[w.wc][2] - st.points[w.wc][2]);
    };
    const soft = lift(1e5), stiff = lift(1e7);
    expect(soft[0]).toBeGreaterThan(stiff[0]);
    expect(stiff[1]).toBeGreaterThan(soft[1]);
    expect(stiff[1] / stiff[0]).toBeGreaterThan(0.5);
  });
});
