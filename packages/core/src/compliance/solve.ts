/**
 * Linear compliance superimposed on a kinematic position, as SHARK's compliant solver does.
 *
 * Every part becomes a rigid body with six small motions (translation and rotation about its centroid).
 * Each joint is a six-component spring between the two parts it joins: a rigid ball joint is very stiff in
 * translation and free in rotation, a bush has its own stiffnesses in its own axes. The tyre is a vertical
 * spring at the contact point, the suspension spring pushes with its preload and rate, and external forces
 * act on chosen parts. Solving K q = F gives the deflections, the joint forces and the deformed geometry.
 */
import { add, cross, dist, dot, norm, normalize, rad, scale, sub, type Vec3 } from '../math/vec3.js';
import { solveLinear } from '../math/linalg.js';
import type { Corner, CornerState } from '../solver/corner.js';
import { GenType, GROUND, NONE, findGen, hasGen } from '../template/types.js';
import type { AxisRef, ComplianceSettings, EndCompliance, ExternalForce } from './types.js';

/** 3x3 matrix as rows. */
type M3 = [Vec3, Vec3, Vec3];

export interface JointResult {
  /** Template point number. */
  point: number;
  bushed: boolean;
  /** Deflection of part 1 relative to part 2 at the joint, global and in the joint's axes, mm. */
  deflection: Vec3;
  deflectionLocal: Vec3;
  /** Force the joint carries (acting on part 2, from part 1), global and local, N. */
  force: Vec3;
  forceLocal: Vec3;
}

export interface ComplianceResult {
  /** Deformed positions of every template point. */
  points: Vec3[];
  /** Small motions of each part: [tx, ty, tz, rx, ry, rz] (mm, rad), part 1 first. */
  motions: number[][];
  joints: JointResult[];
  /** Spring forces (N, + compression) for spring 1 and 2, NaN when the template has none. */
  springForces: [number, number];
  /** Vertical tyre loads from the compliant solve, N, one per wheel. */
  tyreLoads: number[];
}

/** One linear spring element between two bodies (body -1 is ground). */
interface Element {
  a: number;
  b: number;
  at: Vec3;
  /** Axes as rows (local x, y, z in global terms). */
  R: M3;
  kt: Vec3;
  kr: Vec3;
  point: number;
  bushed: boolean;
  report: boolean;
  /** Damping loss angle, deg (bushes only). */
  loss?: number;
}

/** A damper: an axial dashpot between two bodies. */
export interface DamperElement {
  a: number;
  pa: Vec3;
  b: number;
  pb: Vec3;
  /** Unit vector along the damper. */
  u: Vec3;
  /** Rate, N.s/mm. */
  c: number;
}

const I3: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Local axes from a z-axis point and an x-z plane point. Falls back to the global axes when undefined. */
export function bushAxes(origin: Vec3, z?: Vec3, xz?: Vec3): M3 {
  if (!z) return I3;
  const ez = sub(z, origin);
  if (norm(ez) < 1e-9) return I3;
  const zu = normalize(ez);
  // Any x-z point not on the z axis will do; pick a global axis when none is given.
  let ref = xz ? sub(xz, origin) : ([1, 0, 0] as Vec3);
  if (norm(cross(zu, ref)) < 1e-6 * Math.max(1, norm(ref))) ref = Math.abs(zu[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const yu = normalize(cross(zu, ref));
  const xu = cross(yu, zu);
  return [xu, yu, zu];
}

const mulM = (R: M3, v: Vec3): Vec3 => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];

/** Resolve an axis reference to a position, given the joint origin and a point lookup by number. */
function resolve(ref: AxisRef, origin: Vec3, byNo: (no: number) => Vec3 | undefined): Vec3 | undefined {
  if (ref.kind === 'point') return byNo(ref.point);
  if (ref.kind === 'rel') return add(origin, ref.v);
  if (ref.kind === 'abs') return ref.v;
  return undefined;
}

export { resolve as resolveAxisRef };

export interface ComplianceOptions {
  settings: ComplianceSettings;
  /** External forces to apply (already filtered to this end and switched on). */
  forces?: ExternalForce[];
  /** Include the spring preload. Defaults to settings.includeSpring. */
  includeSpring?: boolean;
  /** Include the roll bar's torsion spring. Default true. */
  rollBar?: boolean;
  /** Load the bushes with the rotation the kinematic motion has already given their joints. Default false. */
  bushPreload?: boolean;
}

/**
 * The linear model of a corner at a kinematic state: stiffness matrix, load vector and the elements behind
 * them. Bodies are the template's parts (index = part - 1), each with six motions about its centroid.
 */
export interface ComplianceModel {
  n: number;
  K: number[][];
  F: number[];
  /** Structural (hysteretic) damping matrix: each bush's stiffness times tan(loss angle). */
  Kloss: number[][];
  /** Viscous damping matrix from the dampers, N.s/mm. */
  C: number[][];
  centroid: Vec3[];
  elements: Element[];
  dampers: DamperElement[];
  wheelBodies: number[];
  springForces: [number, number];
  /** Body index for a part number (-1 for ground). */
  body: (part: number) => number;
  /** Rows mapping a body's six motions to a point's displacement. */
  G: (b: number, p: Vec3) => number[][];
}

/** Build the linear compliance model of a corner (or full axle) at a kinematic state. */
export function buildCompliance(c: Corner, st: CornerState, data: EndCompliance, opts: ComplianceOptions): ComplianceModel {
  const t = c.template;
  const pts = st.points;
  const nParts = t.parts.length;
  const n = 6 * nParts;
  const byNo = (no: number) => {
    const i = c.mech.index.get(no);
    return i === undefined ? undefined : pts[i];
  };
  const onPart = (k: number) => t.points.map((p, i) => (p.part1 === k || p.part2 === k ? i : -1)).filter((i) => i >= 0);
  const centroid: Vec3[] = [];
  for (let k = 1; k <= nParts; k++) {
    const idx = onPart(k);
    centroid.push(scale(idx.reduce<Vec3>((s, i) => add(s, pts[i]), [0, 0, 0]), 1 / Math.max(1, idx.length)));
  }
  const body = (part: number) => (part === GROUND || part === NONE ? -1 : part - 1);
  const s = opts.settings;
  const K = Array.from({ length: n }, () => new Array(n).fill(0));
  const F = new Array(n).fill(0);

  /** Rows mapping a body's six motions to the displacement of a point on it: [I, -[r]x]. */
  const G = (b: number, p: Vec3): number[][] => {
    const r = sub(p, centroid[b]);
    return [
      [1, 0, 0, 0, r[2], -r[1]],
      [0, 1, 0, -r[2], 0, r[0]],
      [0, 0, 1, r[1], -r[0], 0],
    ];
  };

  /** Add a 6-component spring between bodies a and b at a point. */
  const addSpring = (e: Element, M = K, f = 1) => {
    const Kt = [0, 1, 2].map((i) => [0, 1, 2].map((j) => e.R[0][i] * e.R[0][j] * e.kt[0] + e.R[1][i] * e.R[1][j] * e.kt[1] + e.R[2][i] * e.R[2][j] * e.kt[2]));
    const Kr = [0, 1, 2].map((i) => [0, 1, 2].map((j) => e.R[0][i] * e.R[0][j] * e.kr[0] + e.R[1][i] * e.R[1][j] * e.kr[1] + e.R[2][i] * e.R[2][j] * e.kr[2]));
    // Relative translation d = G_a q_a - G_b q_b; relative rotation w = q_a(rot) - q_b(rot).
    const terms: { body: number; sign: number }[] = [];
    if (e.a >= 0) terms.push({ body: e.a, sign: 1 });
    if (e.b >= 0) terms.push({ body: e.b, sign: -1 });
    for (const P of terms)
      for (const Q of terms) {
        const Gp = G(P.body, e.at);
        const Gq = G(Q.body, e.at);
        const sgn = P.sign * Q.sign;
        for (let i = 0; i < 6; i++)
          for (let j = 0; j < 6; j++) {
            let v = 0;
            for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += Gp[a][i] * Kt[a][b] * Gq[b][j];
            if (i >= 3 && j >= 3) v += Kr[i - 3][j - 3];
            M[6 * P.body + i][6 * Q.body + j] += f * sgn * v;
          }
      }
  };

  /** An axial spring of rate k along unit vector u between a point on body a and a point on body b. */
  const addAxial = (a: number, pa: Vec3, b: number, pb: Vec3, u: Vec3, k: number, M = K) => {
    const row = new Array(n).fill(0);
    const put = (bd: number, p: Vec3, sign: number) => {
      if (bd < 0) return;
      const g = G(bd, p);
      for (let j = 0; j < 6; j++) row[6 * bd + j] += sign * (u[0] * g[0][j] + u[1] * g[1][j] + u[2] * g[2][j]);
    };
    put(a, pa, 1);
    put(b, pb, -1);
    const nz = row.map((v, i) => (v !== 0 ? i : -1)).filter((i) => i >= 0);
    for (const i of nz) for (const j of nz) M[i][j] += k * row[i] * row[j];
  };

  /** Apply a force at a point on a body. */
  const addForce = (b: number, p: Vec3, f: Vec3) => {
    if (b < 0) return;
    const m = cross(sub(p, centroid[b]), f);
    for (let i = 0; i < 3; i++) {
      F[6 * b + i] += f[i];
      F[6 * b + 3 + i] += m[i];
    }
  };

  const elements: Element[] = [];
  const bushOf = new Map(data.bushes.map((b) => [b.point, b]));
  const nmPerRad = 1000; // N.m/rad -> N.mm/rad
  const perDeg = 180 / Math.PI; // N.mm/deg -> N.mm/rad

  // Rack housings and rack links are fixed or rack-driven in kinematics. Unless their joints are given bush
  // properties they stay rigid in rotation too, so they cannot swing about their own mounts.
  const kineFixed = new Set<number>();
  for (let k = 1; k <= nParts; k++)
    if (onPart(k).some((i) => hasGen(t.points[i], GenType.RackMount) || hasGen(t.points[i], GenType.RackLateralMount))) kineFixed.add(k);

  t.points.forEach((p, i) => {
    if (p.part2 === NONE || p.part1 === NONE) return;
    const at = pts[i];
    const bush = bushOf.get(p.no);
    let R = I3;
    let kt: Vec3 = [s.rigid, s.rigid, s.rigid];
    let kr: Vec3 = [0, 0, 0];
    if (bush) {
      R = bushAxes(at, resolve(bush.zAxis, at, byNo), resolve(bush.xzPlane, at, byNo));
      kt = [bush.stiffness[0], bush.stiffness[1], bush.stiffness[2]];
      kr = [bush.stiffness[3] * nmPerRad, bush.stiffness[4] * nmPerRad, bush.stiffness[5] * nmPerRad];
    }
    const rot = s.rigidRotation * perDeg;
    const fixedSide = (x: number) => x === GROUND || kineFixed.has(x);
    if (!bush && fixedSide(p.part1) && fixedSide(p.part2)) kr = [rot, rot, rot];
    // SHARK holds a rigid axle's centre revolute with a stiff rotational bush.
    if (hasGen(p, GenType.RigidAxleRevolute)) kr = [s.rigidRotation * perDeg, s.rigidRotation * perDeg, s.rigidRotation * perDeg];
    // A twist beam's centre joint is the beam itself: stiff in bending, twisting about the shear axis (the
    // line through the shear points) at the end's roll bar rate.
    if (!bush && hasGen(p, GenType.ShearPoint) && !fixedSide(p.part1) && !fixedSide(p.part2)) {
      const shear = t.points.map((q, k) => (hasGen(q, GenType.ShearPoint) && q.no !== p.no ? pts[k] : undefined)).filter((q): q is Vec3 => !!q);
      const dir = shear.length >= 2 ? normalize(sub(shear[1], shear[0])) : ([0, 1, 0] as Vec3);
      R = bushAxes(at, add(at, dir));
      kr = [rot, rot, data.rollBarRate * perDeg];
    }
    elements.push({ a: body(p.part1), b: body(p.part2), at, R, kt, kr, point: p.no, bushed: !!bush, report: !p.dummy, loss: bush ? bush.lossAngle ?? s.lossAngle : undefined });
  });

  // Roll bar: its two halves are joined by a torsion spring about the bar axis.
  const rev = t.points.findIndex((p) => hasGen(p, GenType.RollBarRevolute));
  if (rev >= 0 && opts.rollBar !== false) {
    const mounts = t.points.map((p, i) => (hasGen(p, GenType.RollBarAxisPoint) ? i : -1)).filter((i) => i >= 0);
    const p = t.points[rev];
    if (mounts.length >= 2 && p.part2 !== NONE) {
      const axis = normalize(sub(pts[mounts[1]], pts[mounts[0]]));
      const R = bushAxes(pts[rev], add(pts[rev], axis));
      elements.push({ a: body(p.part1), b: body(p.part2), at: pts[rev], R, kt: [0, 0, 0], kr: [0, 0, data.rollBarRate * perDeg], point: p.no, bushed: false, report: false });
    }
  }

  // A part whose joints lie on one line (a track rod, say) could spin freely about it; hold the spin.
  for (let k = 1; k <= nParts; k++) {
    const joints = onPart(k).filter((i) => t.points[i].part2 !== NONE).map((i) => pts[i]);
    if (joints.length < 2) continue;
    let far = joints[1];
    for (const q of joints) if (dist(joints[0], q) > dist(joints[0], far)) far = q;
    const axis = normalize(sub(far, joints[0]));
    const collinear = joints.every((q) => norm(cross(sub(q, joints[0]), axis)) < 1e-6 * Math.max(1, dist(joints[0], far)));
    if (!collinear) continue;
    const L = Math.max(dist(joints[0], far), 1);
    const R = bushAxes(centroid[k - 1], add(centroid[k - 1], axis));
    elements.push({ a: k - 1, b: -1, at: centroid[k - 1], R, kt: [0, 0, 0], kr: [0, 0, s.singularity * L * L], point: 0, bushed: false, report: false });
  }

  // Macpherson strut: the top is held on the strut axis (stiff across it, free along it).
  const struts: [GenType, GenType, GenType][] = [
    [GenType.StrutSliderPoint, GenType.StrutEndPoint, GenType.Damper1ToBody],
    [GenType.StrutSliderPoint2, GenType.StrutEndPoint2, GenType.Damper2ToBody],
  ];
  for (const [sg, eg, tg] of struts) {
    const [sp, ep, tp] = [findGen(t, sg), findGen(t, eg), findGen(t, tg)];
    if (!sp || !ep || !tp) continue;
    const [si, ei, ti] = [sp, ep, tp].map((q) => c.mech.index.get(q.no)!);
    const axis = normalize(sub(pts[ei], pts[si]));
    const R = bushAxes(pts[ti], add(pts[ti], axis));
    const strutBody = body(sp.part1);
    const topBody = body(tp.part1 === GROUND ? tp.part2 : tp.part1);
    elements.push({ a: strutBody, b: topBody === strutBody ? -1 : topBody, at: pts[ti], R, kt: [s.rigid, s.rigid, 0], kr: [0, 0, 0], point: tp.no, bushed: false, report: false });
  }

  // Tyres: a vertical spring from each contact point to the ground.
  const wheelBodies = c.sides.map((w) => body(t.points[w.wc].part1));
  c.sides.forEach((_, k) => {
    elements.push({ a: wheelBodies[k], b: -1, at: c.tcp(pts, k), R: I3, kt: [0, 0, data.tyreRate], kr: [0, 0, 0], point: 0, bushed: false, report: false });
  });

  // Suspension springs: axial rate plus their preload.
  const springForces: [number, number] = [NaN, NaN];
  const springPairs: [GenType, GenType][] = [[GenType.Spring1ToSuspension, GenType.Spring1ToBody], [GenType.Spring2ToSuspension, GenType.Spring2ToBody]];
  springPairs.forEach(([sg, bg], k) => {
    const sp = findGen(t, sg);
    const bp = findGen(t, bg);
    if (!sp || !bp) return;
    const [si, bi] = [sp, bp].map((q) => c.mech.index.get(q.no)!);
    const spring = data.springs[k];
    const L0 = dist(c.mech.staticPoints[si], c.mech.staticPoints[bi]);
    const L = dist(pts[si], pts[bi]);
    const compression = spring.freeLength - spring.fittedLength + (L0 - L);
    springForces[k] = spring.rate * compression;
    const nAx = normalize(sub(pts[si], pts[bi])); // from body end to suspension end
    const a = body(sp.part1 === GROUND ? sp.part2 : sp.part1);
    const b = body(bp.part1 === GROUND ? bp.part2 : bp.part1);
    addAxial(a, pts[si], b === a ? -1 : b, pts[bi], nAx, spring.rate);
    if (opts.includeSpring ?? opts.settings.includeSpring) {
      const f = scale(nAx, springForces[k]);
      addForce(a, pts[si], f);
      addForce(b === a ? -1 : b, pts[bi], scale(f, -1));
    }
  });

  // Dampers: axial dashpots between their two ends.
  const dampers: DamperElement[] = [];
  const damperPairs: [GenType, GenType][] = [[GenType.Damper1ToSuspension, GenType.Damper1ToBody], [GenType.Damper2ToSuspension, GenType.Damper2ToBody]];
  damperPairs.forEach(([sg, bg], k) => {
    const sp = findGen(t, sg);
    const bp = findGen(t, bg);
    if (!sp || !bp || !data.dampers[k]) return;
    const [si, bi] = [sp, bp].map((q) => c.mech.index.get(q.no)!);
    const a = body(sp.part1 === GROUND ? sp.part2 : sp.part1);
    const b = body(bp.part1 === GROUND ? bp.part2 : bp.part1);
    dampers.push({ a, pa: pts[si], b: b === a ? -1 : b, pb: pts[bi], u: normalize(sub(pts[si], pts[bi])), c: data.dampers[k] });
  });
  const C = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const d of dampers) addAxial(d.a, d.pa, d.b, d.pb, d.u, d.c, C);

  const Kloss = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const e of elements) {
    addSpring(e);
    if (e.loss) addSpring(e, Kloss, Math.tan(rad(e.loss)));
  }

  // Bush rotation pre-loads: a bush whose two sides have turned relative to each other in the kinematic
  // motion (bump, roll, steer) starts out twisted, so its rotational stiffness loads the parts. Zero at static.
  if (opts.bushPreload) {
    const spin = (b: number): Vec3 => {
      const mb = b < 0 ? undefined : c.mech.bodies.find((x) => x.part === b + 1);
      return mb ? [st.x[mb.offset + 3], st.x[mb.offset + 4], st.x[mb.offset + 5]] : [0, 0, 0];
    };
    const chassis: Vec3 = [rad(-st.articulation.roll), 0, 0];
    for (const e of elements) {
      if (!e.bushed || e.kr.every((k) => k === 0)) continue;
      const rel = sub(e.a >= 0 ? spin(e.a) : chassis, e.b >= 0 ? spin(e.b) : chassis);
      let T: Vec3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) T = add(T, scale(e.R[i], e.kr[i] * dot(e.R[i], rel)));
      for (let i = 0; i < 3; i++) {
        if (e.a >= 0) F[6 * e.a + 3 + i] -= T[i];
        if (e.b >= 0) F[6 * e.b + 3 + i] += T[i];
      }
    }
  }

  for (const f of opts.forces ?? []) {
    if (!f.on || !f.magnitude) continue;
    const origin = f.at === 0 ? c.tcp(pts, 0) : byNo(f.at);
    if (!origin) continue;
    const head = add(origin, f.head);
    const dir = sub(head, add(origin, f.tail));
    if (norm(dir) < 1e-12) continue;
    const part = f.part === 0 ? wheelBodies[0] + 1 : f.part;
    addForce(body(part), head, scale(normalize(dir), f.magnitude));
  }

  // Parts with no stiffness at all (none in a valid template) would make K singular; give them a tiny one.
  for (let i = 0; i < n; i++) if (Math.abs(K[i][i]) < 1e-9) K[i][i] = 1e-6;
  return { n, K, F, Kloss, C, centroid, elements, dampers, wheelBodies, springForces, body, G };
}

/** Displacement of a point on a body for a motion vector q. */
export function pointMotion(m: ComplianceModel, q: number[], b: number, p: Vec3): Vec3 {
  if (b < 0) return [0, 0, 0];
  const r = sub(p, m.centroid[b]);
  const o = 6 * b;
  return add([q[o], q[o + 1], q[o + 2]], cross([q[o + 3], q[o + 4], q[o + 5]], r));
}

/** The body a template point moves with. */
export const pointBody = (m: ComplianceModel, part1: number, part2: number) => m.body(part1 === GROUND ? part2 : part1);

/** Solve the compliant deflection of a corner (or full axle) at a kinematic state. */
export function solveCompliance(c: Corner, st: CornerState, data: EndCompliance, opts: ComplianceOptions): ComplianceResult {
  const model = buildCompliance(c, st, data, opts);
  const { n, K, F, centroid, elements, wheelBodies, springForces, body } = model;
  const t = c.template;
  const pts = st.points;
  const nParts = t.parts.length;
  const q = solveLinear(K, F) ?? new Array(n).fill(0);
  const motion = (b: number) => (b < 0 ? [0, 0, 0, 0, 0, 0] : q.slice(6 * b, 6 * b + 6));
  const move = (b: number, p: Vec3): Vec3 => {
    if (b < 0) return [0, 0, 0];
    const m = motion(b);
    const r = sub(p, centroid[b]);
    return add([m[0], m[1], m[2]], cross([m[3], m[4], m[5]], r));
  };

  const points = t.points.map((p, i) => add(pts[i], move(body(p.part1 === GROUND ? p.part2 : p.part1), pts[i])));
  const joints: JointResult[] = elements.filter((e) => e.report).map((e) => {
    const d = sub(move(e.a, e.at), move(e.b, e.at));
    const dl = mulM(e.R, d);
    const fl: Vec3 = [dl[0] * e.kt[0], dl[1] * e.kt[1], dl[2] * e.kt[2]];
    const f = add(add(scale(e.R[0], fl[0]), scale(e.R[1], fl[1])), scale(e.R[2], fl[2]));
    return { point: e.point, bushed: e.bushed, deflection: d, deflectionLocal: dl, force: f, forceLocal: fl };
  });
  const tyreLoads = c.sides.map((_, k) => {
    const tcp = c.tcp(pts, k);
    return -move(wheelBodies[k], tcp)[2] * data.tyreRate;
  });
  return { points, motions: Array.from({ length: nParts }, (_, b) => motion(b)), joints, springForces, tyreLoads };
}

/** Degrees from radians, for reporting small rotations. */
export const toDegrees = (r: number) => r / rad(1);
