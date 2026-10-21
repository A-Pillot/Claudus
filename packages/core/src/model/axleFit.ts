/**
 * SHARK's Solve / Wheelbase Diff Sol and Grnd Plane Diff Sol: how a mismatch is settled when a second axle
 * is added to a model.
 *
 * - Wheelbase: the wheelbase parameter differs from the distance between the two axles' wheel centres. Either
 *   the parameter is changed to the distance, or the added end is moved fore-aft to match the parameter.
 * - Ground plane: the two ends' static ground heights differ. Either the added end is translated vertically,
 *   or it is bumped (solved with its ground moved), which keeps its geometry relative to the wheels.
 */
import type { Vec3 } from '../math/vec3.js';
import { moveEnd, cornerOf } from './rideHeight.js';
import { defaultCompliance } from '../compliance/types.js';
import type { End, Model } from './types.js';

export interface AxleFitOptions {
  wheelbase: 'parameter' | 'move';
  ground: 'translate' | 'bump';
}

export const defaultAxleFit = (): AxleFitOptions => ({ wheelbase: 'parameter', ground: 'translate' });

/** Fit the `added` end to the other one. Returns the model unchanged when it has only one end. */
export function fitAddedEnd(m: Model, added: End, opts: AxleFitOptions = defaultAxleFit()): Model {
  const other: End = added === 'front' ? 'rear' : 'front';
  if (!m.front || !m.rear) return m;
  let out = m;
  const wcX = (mm: Model, e: End) => {
    const c = cornerOf(mm, e);
    return c.mech.staticPoints[c.mech.wheels[0].wc][0];
  };
  const dist = wcX(out, 'front') - wcX(out, 'rear');
  if (Math.abs(dist - out.params.wheelbase) > 1e-6) {
    if (opts.wheelbase === 'parameter') out = { ...out, params: { ...out.params, wheelbase: dist } };
    else {
      // Move the added end along X so the front-to-rear distance becomes the wheelbase.
      const dx = (added === 'rear' ? 1 : -1) * (dist - out.params.wheelbase);
      const s = out[added]!;
      out = { ...out, [added]: { ...s, points: s.points.map((p): Vec3 => [p[0] + dx, p[1], p[2]]) } };
    }
  }
  const gOther = cornerOf(out, other).z0;
  const gAdded = cornerOf(out, added).z0;
  if (Math.abs(gOther - gAdded) > 1e-6) {
    const s = out[added]!;
    if (opts.ground === 'translate') {
      const dz = gOther - gAdded;
      out = { ...out, [added]: { ...s, points: s.points.map((p): Vec3 => [p[0], p[1], p[2] + dz]) } };
    } else {
      const data = structuredClone(out.compliance ?? defaultCompliance());
      const moved = moveEnd(out, added, s.points, gOther, 0, data);
      out = { ...out, [added]: moved, ...(out.compliance ? { compliance: data } : {}) };
    }
  }
  return out;
}
