/**
 * Rigid body rotation between two positions of a set of points, used for the joint and bush rotation
 * listings: the rotation of each part from the static position to a solved position.
 */
import { cross, dot, norm, normalize, scale, sub, type Vec3 } from '../math/vec3.js';

/** 3x3 matrix, row-major. */
export type M3 = number[];

const mul = (a: M3, b: M3): M3 => {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[3 * i + j] += a[3 * i + k] * b[3 * k + j];
  return r;
};
const T = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const det = (m: M3) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
function inv(m: M3): M3 | undefined {
  const d = det(m);
  if (Math.abs(d) < 1e-14) return undefined;
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ].map((x) => x / d);
}

export const identity = (): M3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Rotation vector (axis times angle, radians) of a rotation matrix. */
export function rotationVector(R: M3): Vec3 {
  const s: Vec3 = [(R[7] - R[5]) / 2, (R[2] - R[6]) / 2, (R[3] - R[1]) / 2];
  const sin = norm(s);
  const cos = (R[0] + R[4] + R[8] - 1) / 2;
  if (sin < 1e-12) {
    if (cos > 0) return [0, 0, 0];
    // half a turn: the axis is the dominant column of (R + I) / 2
    const col = [0, 1, 2].map((j) => [R[j] + (j === 0 ? 1 : 0), R[3 + j] + (j === 1 ? 1 : 0), R[6 + j] + (j === 2 ? 1 : 0)] as Vec3);
    const best = col.reduce((a, b) => (norm(b) > norm(a) ? b : a));
    return scale(normalize(best), Math.PI);
  }
  return scale(s, Math.atan2(sin, cos) / sin);
}

/**
 * The rotation that carries the point set `a` onto `b` (a rigid motion of the whole set), as a matrix R with
 * b - centroid(b) = R (a - centroid(a)). One or no points give no rotation; two points give the smallest
 * rotation that turns their line; three or more use the polar factor of the cross covariance.
 */
export function rigidRotation(a: Vec3[], b: Vec3[]): M3 {
  const n = Math.min(a.length, b.length);
  if (n < 2) return identity();
  const ca = scale(a.slice(0, n).reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]), 1 / n);
  const cb = scale(b.slice(0, n).reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]), 1 / n);
  const A = a.slice(0, n).map((p) => sub(p, ca));
  const B = b.slice(0, n).map((p) => sub(p, cb));
  // Two reference directions that are not parallel in the first set.
  const i = A.reduce((best, p, k) => (norm(p) > norm(A[best]) ? k : best), 0);
  const j = A.reduce((best, p, k) => (norm(cross(A[i], p)) > norm(cross(A[i], A[best])) ? k : best), 0);
  if (norm(cross(A[i], A[j])) < 1e-9 * norm(A[i]) * norm(A[j]) || norm(A[i]) < 1e-12) {
    // collinear: smallest rotation of the line direction
    const d0 = normalize(A[i]);
    const d1 = normalize(B[i]);
    const ax = cross(d0, d1);
    const ang = Math.atan2(norm(ax), dot(d0, d1));
    if (norm(ax) < 1e-14) return identity();
    return axisAngle(normalize(ax), ang);
  }
  // A normal to the plane of the reference directions keeps the covariance full rank for flat parts.
  const L = Math.max(norm(A[i]), 1);
  A.push(scale(normalize(cross(A[i], A[j])), L));
  B.push(scale(normalize(cross(B[i], B[j])), L));
  const M = new Array(9).fill(0);
  A.forEach((p, k) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[3 * r + c] += B[k][r] * p[c];
  });
  // Polar factor by Newton iteration: R <- (R + R^-T) / 2.
  let R: M3 = M;
  for (let it = 0; it < 60; it++) {
    const Ri = inv(R);
    if (!Ri) return identity();
    const RiT = T(Ri);
    const Rn = R.map((x, k) => (x + RiT[k]) / 2);
    const diff = Rn.reduce((s, x, k) => s + Math.abs(x - R[k]), 0);
    R = Rn;
    if (diff < 1e-13) break;
  }
  return R;
}

export function axisAngle(u: Vec3, ang: number): M3 {
  const [x, y, z] = u;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

/** Rotation of part 1 relative to part 2 as a rotation vector in global axes (radians). */
export function relativeRotation(R1: M3, R2: M3): Vec3 {
  return rotationVector(mul(R1, T(R2)));
}

export const matMul = mul;
