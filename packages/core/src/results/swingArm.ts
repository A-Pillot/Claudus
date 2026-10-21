/**
 * Virtual swing arms. The instantaneous centre of the wheel in a view plane is where the normals to the
 * paths of two points of the wheel (the contact point and the wheel centre) meet; the swing arm length is the
 * distance from the contact point to that centre. Paths are given as velocities per mm of wheel travel.
 */
import type { Vec3 } from '../math/vec3.js';

export type Pt2 = [number, number];

/** Intersection of two lines in a plane, each a point and a direction. Undefined when parallel. */
export function intersectPlaneLines(p1: Pt2, d1: Pt2, p2: Pt2, d2: Pt2): Pt2 | undefined {
  const n1 = Math.hypot(d1[0], d1[1]);
  const n2 = Math.hypot(d2[0], d2[1]);
  if (n1 < 1e-12 || n2 < 1e-12) return undefined;
  const det = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(det) < 1e-9 * n1 * n2) return undefined;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / det;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

/** Instantaneous centre of a body in a plane from the positions and velocities of two of its points. */
export function instantCentre(p1: Pt2, v1: Pt2, p2: Pt2, v2: Pt2): Pt2 | undefined {
  return intersectPlaneLines(p1, [-v1[1], v1[0]], p2, [-v2[1], v2[0]]);
}

export interface SwingArm {
  /** Distance from the contact point to the centre, mm. */
  length: number;
  /** Centre coordinates in the plane (Y, Z for the front view; X, Z for the side view). */
  centre: Pt2;
}

const NONE: SwingArm = { length: NaN, centre: [NaN, NaN] };

function arm(tcp: Pt2, vt: Pt2, wc: Pt2, vw: Pt2): SwingArm {
  const c = instantCentre(tcp, vt, wc, vw);
  return c ? { length: Math.hypot(c[0] - tcp[0], c[1] - tcp[1]), centre: c } : NONE;
}

/** Front view (Y, Z) and side view (X, Z) virtual swing arms from the contact point and wheel centre paths. */
export function swingArms(tcp: Vec3, vt: Vec3, wc: Vec3, vw: Vec3): { front: SwingArm; side: SwingArm } {
  return {
    front: arm([tcp[1], tcp[2]], [vt[1], vt[2]], [wc[1], wc[2]], [vw[1], vw[2]]),
    side: arm([tcp[0], tcp[2]], [vt[0], vt[2]], [wc[0], wc[2]], [vw[0], vw[2]]),
  };
}
