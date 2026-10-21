import { describe, expect, it } from 'vitest';
import { sampleModel } from './helpers.js';
import { Corner } from '../src/solver/corner.js';
import { adjustSprings, endLoad, matchToSprings, matchToWeightChange, setRideHeight, springWheelLoad } from '../src/model/rideHeight.js';
import type { End, Model } from '../src/model/types.js';

const ENDS: End[] = ['front', 'rear'];
const corner = (m: Model, e: End) => new Corner(m[e]!, e);
const wcZ = (m: Model, e: End) => { const c = corner(m, e); return c.mech.staticPoints[c.mech.wheels[0].wc][2]; };
const load = (m: Model, e: End) => springWheelLoad(corner(m, e), m.compliance![e]!, 0);

describe('set ride height', () => {
  const m = sampleModel('Tutorial 2b.dat');

  it('bump lowers the body: wheels rise relative to it, body points stay', () => {
    const b = setRideHeight(m, 10);
    for (const e of ENDS) {
      expect(wcZ(b, e) - wcZ(m, e)).toBeCloseTo(10, 0);
      expect(b[e]!.points[0]).toEqual(m[e]!.points[0]);
    }
  });

  it('positive pitch lowers the rear about the front wheel centre axis', () => {
    const p = setRideHeight(m, 0, 1);
    expect(p.rear!.points[0][2] - m.rear!.points[0][2]).toBeLessThan(-30);
    expect(wcZ(p, 'front')).toBeCloseTo(wcZ(m, 'front'), 1);
  });

  it('adjust springs balances the weight without moving points', () => {
    const a = adjustSprings(m, 1200, 55);
    for (const e of ENDS) {
      expect(a[e]!.points).toEqual(m[e]!.points);
      expect(load(a, e)).toBeCloseTo(endLoad(corner(a, e), e, 1200, 55), 0);
    }
  });

  it('match to springs moves the body until the springs carry the weight', () => {
    const s = matchToSprings(m, 1200, 55);
    for (const e of ENDS) expect(load(s, e)).toBeCloseTo(endLoad(corner(s, e), e, 1200, 55), 0);
    // The default springs are soft for 1200 kg, so the body comes down.
    expect(s.front!.points[0][2]).toBeLessThan(m.front!.points[0][2]);
  });

  it('match to weight change moves by the change in load only', () => {
    const a = adjustSprings(m, 1200, 55);
    const w = matchToWeightChange(a, { mass: 1200, frontPct: 55 }, { mass: 1300, frontPct: 55 });
    for (const e of ENDS) expect(load(w, e)).toBeCloseTo(endLoad(corner(w, e), e, 1300, 55), 0);
    const same = matchToWeightChange(a, { mass: 1200, frontPct: 55 }, { mass: 1200, frontPct: 55 });
    for (const e of ENDS) expect(wcZ(same, e)).toBeCloseTo(wcZ(a, e), 2);
  });
});
