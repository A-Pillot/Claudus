/**
 * The 2D (cross-car plane) kinematic solver.
 *
 * The upright is one rigid body. Its pose is x = [ty, tz, theta]: where the lower outer ball joint has
 * moved to, and the counter-clockwise rotation (viewed with Y to the right, Z up) of the upright.
 * Three conditions fix it:
 *   1. the lower outer joint stays at its arm length from the lower inner point,
 *   2. wishbone: the upper outer joint stays at its arm length from the upper inner point,
 *      strut: the strut slider axis (fixed in the upright) still passes through the strut top (fixed in the body),
 *   3. the tyre contact point sits on the ground.
 *
 * Bump moves the ground plane up by the bump distance (body fixed). Roll rotates the body about the
 * static roll centre with the ground fixed; the left corner is solved as a mirrored right corner.
 */
import { solveLinear } from '../math/linalg.js';
import type { Model2D, P2, Sweep2D } from './types.js';

const RAD = Math.PI / 180;

/** The static points of the right-hand corner, derived from the model data. */
export interface Geo2D {
  strut: boolean;
  lowerInner: P2;
  /** Upper inner point (wishbone). For a strut this is the body-fixed strut top, the same as `upperOuter` statically. */
  upperInner: P2;
  lowerOuter: P2;
  /** Upper outer ball joint, or the strut top. */
  upperOuter: P2;
  /** Tyre contact patch centre. */
  contact: P2;
  /** Kingpin axis intersection with the ground. */
  ground: P2;
  /** Strut slider axis angle from vertical, rad. */
  damper: number;
}

/**
 * Outer point Y positions: the kingpin axis leaves the ground at `track/2 - offset` and leans inboard by
 * the kingpin angle as it rises. For a strut the axis runs from the lower ball joint to the strut top.
 */
export function geometry2D(m: Model2D): Geo2D {
  const gy = m.track / 2 - m.kingpinOffset;
  const t = Math.tan(m.kingpinAngle * RAD);
  const upperOuter: P2 = [m.outerY?.upper ?? gy - m.upperOuterZ * t, m.upperOuterZ];
  return {
    strut: m.type === 2,
    lowerInner: [...m.lowerInner],
    upperInner: m.type === 2 ? [...upperOuter] : [...m.upperInner],
    lowerOuter: [m.outerY?.lower ?? gy - m.lowerOuterZ * t, m.lowerOuterZ],
    upperOuter,
    contact: [m.track / 2, 0],
    ground: [gy, 0],
    damper: m.damperAngle * RAD,
  };
}

/** One solved corner, in the frame it was solved in (ground-fixed for roll, body-fixed for bump). */
export interface Corner2D {
  ok: boolean;
  x: [number, number, number];
  lowerInner: P2;
  upperInner: P2;
  lowerOuter: P2;
  upperOuter: P2;
  contact: P2;
  ground: P2;
  /** Camber change from static, deg, positive = top leans outboard. */
  camber: number;
  /** Instant centre (the swing arm centre), null when the links are parallel. */
  ic: P2 | null;
  /** Direction of the line from the contact patch to the instant centre. */
  icDir: P2;
}

const rot = (a: number, p: P2): P2 => [Math.cos(a) * p[0] - Math.sin(a) * p[1], Math.sin(a) * p[0] + Math.cos(a) * p[1]];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const dist2 = (a: P2, b: P2) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];

/** Where a static point goes for upright pose x. */
function place(geo: Geo2D, x: number[], p: P2): P2 {
  return add([x[0], x[1]], rot(x[2], sub(p, geo.lowerOuter)));
}

/** The three solver equations; all are zero when the pose is right. */
function equations(geo: Geo2D, x: number[], li: P2, ui: P2, groundZ: number): number[] {
  const lo = place(geo, x, geo.lowerOuter);
  const f1 = dist2(lo, li) - dist2(geo.lowerOuter, geo.lowerInner);
  let f2: number;
  if (geo.strut) {
    // Distance of the body-fixed strut top from the slider axis (a line through the upright's copy of the top).
    const n = rot(x[2], [Math.cos(geo.damper), Math.sin(geo.damper)]);
    const d = sub(ui, place(geo, x, geo.upperOuter));
    f2 = d[0] * n[0] + d[1] * n[1];
  } else {
    f2 = dist2(place(geo, x, geo.upperOuter), ui) - dist2(geo.upperOuter, geo.upperInner);
  }
  return [f1, f2, place(geo, x, geo.contact)[1] - groundZ];
}

const norm = (r: number[]) => Math.hypot(...r);

/** Newton's method with a simple backtracking line search. */
function newton(geo: Geo2D, x0: number[], li: P2, ui: P2, groundZ: number): { x: [number, number, number]; ok: boolean } {
  let x = [...x0];
  let r = equations(geo, x, li, ui, groundZ);
  for (let it = 0; it < 80; it++) {
    if (norm(r) < 1e-9) return { x: x as [number, number, number], ok: true };
    const J = r.map(() => [0, 0, 0]);
    for (let k = 0; k < 3; k++) {
      const h = k === 2 ? 1e-7 : 1e-6;
      const xp = [...x];
      xp[k] += h;
      const rp = equations(geo, xp, li, ui, groundZ);
      for (let i = 0; i < 3; i++) J[i][k] = (rp[i] - r[i]) / h;
    }
    const dx = solveLinear(J, r.map((v) => -v));
    if (!dx) break;
    let s = 1;
    let accepted = false;
    for (let b = 0; b < 12; b++, s /= 2) {
      const xn = x.map((v, i) => v + s * dx[i]);
      const rn = equations(geo, xn, li, ui, groundZ);
      if (norm(rn) < norm(r)) {
        x = xn;
        r = rn;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  return { x: x as [number, number, number], ok: norm(r) < 1e-7 };
}

/** Intersection of the lines p + t d and q + s e, or null when they are parallel. */
export function intersectLines(p: P2, d: P2, q: P2, e: P2): P2 | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9 * Math.hypot(...d) * Math.hypot(...e)) return null;
  const t = cross(sub(q, p), e) / den;
  return [p[0] + t * d[0], p[1] + t * d[1]];
}

/** Describe a solved pose: point positions, camber and instant centre. */
function describe(geo: Geo2D, x: [number, number, number], ok: boolean, li: P2, ui: P2): Corner2D {
  const lo = place(geo, x, geo.lowerOuter);
  const uo = place(geo, x, geo.upperOuter);
  const c = place(geo, x, geo.contact);
  const lowerDir = sub(lo, li);
  // The second link: the upper wishbone, or for a strut the line through the strut top at right angles to the slider axis.
  const upperDir = geo.strut ? rot(x[2], [Math.cos(geo.damper), Math.sin(geo.damper)]) : sub(uo, ui);
  // (for a strut, ui is the strut top and the line passes through it)
  const ic = intersectLines(li, lowerDir, ui, upperDir);
  return {
    ok,
    x,
    lowerInner: li,
    upperInner: ui,
    lowerOuter: lo,
    upperOuter: geo.strut ? ui : uo,
    contact: c,
    ground: place(geo, x, geo.ground),
    camber: -x[2] / RAD,
    ic,
    icDir: ic ? sub(ic, c) : lowerDir,
  };
}

/** Static pose, x = [lower outer y, z, 0]. */
const staticPose = (geo: Geo2D): [number, number, number] => [geo.lowerOuter[0], geo.lowerOuter[1], 0];

function solveCorner(geo: Geo2D, li: P2, ui: P2, groundZ: number, warm?: number[]): Corner2D {
  let r = newton(geo, warm ?? staticPose(geo), li, ui, groundZ);
  // A warm start from a far pose can fail; retry from the static pose.
  if (!r.ok && warm) r = newton(geo, staticPose(geo), li, ui, groundZ);
  return describe(geo, r.x, r.ok, li, ui);
}

/** Where the line from the contact patch along `dir` crosses the car centre line (y = 0), as a height. */
function centreLineCrossing(c: P2, dir: P2): number | null {
  if (Math.abs(dir[0]) < 1e-12) return null;
  return c[1] + (-c[0] / dir[0]) * dir[1];
}

export interface BumpResult {
  bump: number;
  ok: boolean;
  camber: number;
  /** Change in the contact patch Y from static (half the track change), mm. */
  halfTrackChange: number;
  /** Roll centre height above the (moved) ground, mm. NaN when the links are parallel and the line is level. */
  rcHeight: number;
  corner: Corner2D;
}

/** One bump position. The ground plane moves up by `bump` relative to the body. */
export function solveBump(geo: Geo2D, bump: number, warm?: number[]): BumpResult {
  const k = solveCorner(geo, geo.lowerInner, geo.upperInner, bump, warm);
  const z = centreLineCrossing(k.contact, k.icDir);
  return {
    bump,
    ok: k.ok,
    camber: k.camber,
    halfTrackChange: k.contact[0] - geo.contact[0],
    rcHeight: z === null ? NaN : z - k.contact[1],
    corner: k,
  };
}

/** The static roll centre height (above ground) of the symmetric car. */
export function staticRollCentre(geo: Geo2D): number {
  return solveBump(geo, 0).rcHeight;
}

/** Evenly spaced values from -rebound to +bump, always including 0. */
export function bumpPositions(s: Sweep2D): number[] {
  const out: number[] = [];
  for (let i = s.reboundSteps; i >= 1; i--) out.push((-s.reboundTravel * i) / s.reboundSteps);
  out.push(0);
  for (let i = 1; i <= s.bumpSteps; i++) out.push((s.bumpTravel * i) / s.bumpSteps);
  return out;
}

export function rollPositions(rollTravel: number, steps: number): number[] {
  const out: number[] = [];
  for (let i = steps; i >= 1; i--) out.push((-rollTravel * i) / steps);
  out.push(0);
  for (let i = 1; i <= steps; i++) out.push((rollTravel * i) / steps);
  return out;
}

/** Bump results across the sweep, solving outward from static so each step starts near the answer. */
export function bumpSweep2D(geo: Geo2D, s: Sweep2D): BumpResult[] {
  const pos = bumpPositions(s);
  const zero = pos.indexOf(0);
  const out: BumpResult[] = new Array(pos.length);
  out[zero] = solveBump(geo, 0);
  for (const dir of [1, -1]) {
    let prev = out[zero];
    for (let i = zero + dir; i >= 0 && i < pos.length; i += dir) {
      prev = solveBump(geo, pos[i], prev.corner.ok ? prev.corner.x : undefined);
      out[i] = prev;
    }
  }
  return out;
}

export interface RollResult {
  roll: number;
  ok: boolean;
  /** Camber of the right-hand wheel (the one that goes into bump with positive roll) and of the left, deg. */
  camber: number;
  camberLeft: number;
  /** Roll centre height above the ground and lateral position from the car centre line, mm (NaN if undefined). */
  rcHeight: number;
  rcLateral: number;
  right: Corner2D;
  /** The left corner in real (not mirrored) coordinates. */
  left: Corner2D;
}

const rotCW = (a: number, h: number, p: P2): P2 => [p[0] * Math.cos(a) + (p[1] - h) * Math.sin(a), -p[0] * Math.sin(a) + (p[1] - h) * Math.cos(a) + h];
const mirror = (p: P2): P2 => [-p[0], p[1]];

function mirrorCorner(k: Corner2D): Corner2D {
  return {
    ...k,
    lowerInner: mirror(k.lowerInner),
    upperInner: mirror(k.upperInner),
    lowerOuter: mirror(k.lowerOuter),
    upperOuter: mirror(k.upperOuter),
    contact: mirror(k.contact),
    ground: mirror(k.ground),
    ic: k.ic && mirror(k.ic),
    icDir: mirror(k.icDir),
  };
}

/**
 * One roll position, in degrees. The body rolls about the static roll centre `pivotZ` (positive roll puts
 * the right-hand wheel into bump). The roll centre is where the lines from each contact patch through its
 * instant centre cross, measured in the ground frame.
 */
export function solveRoll(geo: Geo2D, roll: number, pivotZ: number, warm?: { right?: number[]; left?: number[] }): RollResult {
  const a = roll * RAD;
  const right = solveCorner(geo, rotCW(a, pivotZ, geo.lowerInner), rotCW(a, pivotZ, geo.upperInner), 0, warm?.right);
  // The mirrored left corner sees the body rolled the other way.
  const leftM = solveCorner(geo, rotCW(-a, pivotZ, geo.lowerInner), rotCW(-a, pivotZ, geo.upperInner), 0, warm?.left);
  const left = mirrorCorner(leftM);
  const rc = intersectLines(right.contact, right.icDir, left.contact, left.icDir);
  return {
    roll,
    ok: right.ok && leftM.ok,
    camber: right.camber,
    camberLeft: leftM.camber,
    rcHeight: rc ? rc[1] : NaN,
    rcLateral: rc ? rc[0] : NaN,
    right,
    left,
  };
}

export function rollSweep2D(geo: Geo2D, rollTravel: number, steps: number): RollResult[] {
  const pos = rollPositions(rollTravel, steps);
  const zero = pos.indexOf(0);
  const pivot = staticRollCentre(geo);
  const out: RollResult[] = new Array(pos.length);
  out[zero] = solveRoll(geo, 0, pivot);
  for (const dir of [1, -1]) {
    let prev = out[zero];
    for (let i = zero + dir; i >= 0 && i < pos.length; i += dir) {
      prev = solveRoll(geo, pos[i], pivot, prev.ok ? { right: prev.right.x, left: prev.left.x } : undefined);
      out[i] = prev;
    }
  }
  return out;
}
