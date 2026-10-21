/**
 * One suspension corner (right-hand side) with the articulations SHARK offers: bump/rebound, body roll,
 * steering and combinations of them. The left side is the mirror image.
 *
 * A full-axle template (rigid axles, two-sided independents) has two wheels: wheel 0 is the right (+Y) one
 * and wheel 1 the left. Both are solved together, and bump moves the ground under both wheels.
 */
import { add, cross, deg, normalize, rad, rotateAbout, scale, sub, type Vec3 } from '../math/vec3.js';
import { solveLinear } from '../math/linalg.js';
import type { End, SuspensionData } from '../model/types.js';
import { getTemplate } from '../template/registry.js';
import { GenType, findGen, type Template } from '../template/types.js';
import type { ComplianceResult } from '../compliance/solve.js';
import { Mechanism, tyreContactPoint, wheelLowestZ, type Drive } from './mechanism.js';

export interface Articulation {
  /** Wheel bump (+) / rebound (-) relative to the body, mm. */
  bump?: number;
  /** Body roll, deg. Positive roll moves this (right-hand) corner into bump. */
  roll?: number;
  /** Rack travel along +Y, mm. */
  rack?: number;
}

export interface CornerState {
  articulation: Required<Articulation>;
  points: Vec3[];
  groundZ: number;
  x: number[];
  drive: Drive;
  converged: boolean;
}

/** Rates of change per mm of ground (wheel) travel, at fixed body and rack. */
export interface CornerRates {
  tcp: Vec3;
  wc: Vec3;
  damperLength: number;
  springLength: number;
}

/** Template indexes of the points that describe one wheel's side of the suspension. */
export interface CornerSide {
  wc: number;
  stub: number;
  lbj?: number;
  ubj?: number;
  strutTop?: number;
  damper: [number | undefined, number | undefined];
  spring: [number | undefined, number | undefined];
}

export class Corner {
  readonly mech: Mechanism;
  readonly template: Template;
  readonly end: End;
  /** Static ground height: the lowest tyre point at the input hard points. */
  readonly z0: number;
  /** Static ground height under the left wheel of a full-axle template (z0 for a corner). */
  readonly z0Left: number;
  readonly sides: CornerSide[];
  /** Static roll centre height used as the body roll axis, mm (absolute z). */
  rollAxisZ: number;
  private readonly idx: (gen: GenType) => number | undefined;

  constructor(data: SuspensionData, end: End, template: Template = getTemplate(data.templateSlot)) {
    this.template = template;
    this.end = end;
    this.mech = new Mechanism(template, data.points, data.rollingRadius);
    const p = this.mech.staticPoints;
    this.idx = (gen) => {
      const tp = findGen(template, gen);
      return tp ? this.mech.index.get(tp.no) : undefined;
    };
    const G = GenType;
    const i = this.idx;
    this.sides = this.mech.wheels.map((w, k) =>
      k === 0
        ? { ...w, lbj: i(G.LowerBallJoint), ubj: i(G.UpperBallJoint), strutTop: i(G.StrutSliderPoint) !== undefined ? i(G.Damper1ToBody) : undefined,
            damper: [i(G.Damper1ToSuspension), i(G.Damper1ToBody)], spring: [i(G.Spring1ToSuspension), i(G.Spring1ToBody)] }
        : { ...w, lbj: i(G.LowerBallJoint2), ubj: i(G.UpperBallJoint2), strutTop: i(G.StrutSliderPoint2) !== undefined ? i(G.Damper2ToBody) : undefined,
            damper: [i(G.Damper2ToSuspension), i(G.Damper2ToBody)], spring: [i(G.Spring2ToSuspension), i(G.Spring2ToBody)] },
    );
    const low = (s: CornerSide) => wheelLowestZ(p[s.wc], p[s.stub], data.rollingRadius);
    this.z0 = low(this.sides[0]);
    this.z0Left = this.sides[1] ? low(this.sides[1]) : this.z0;
    this.rollAxisZ = this.z0;
    const st = this.solve({});
    const rc = this.fullAxle ? this.rollCentreAxle(st)[1] : this.rollCentreBump(st, this.rates(st));
    this.rollAxisZ = Number.isFinite(rc) ? rc : this.z0;
  }

  /**
   * Optional deformation applied after every kinematic solve, such as the compliant deflection under
   * spring and external loads. Derivatives are then measured on the deformed geometry.
   */
  deform?: (kinematic: CornerState) => Vec3[];

  /** Compliant solutions behind the deformed point arrays that `deform` returned, for results such as tyre force. */
  compliantResults?: WeakMap<Vec3[], ComplianceResult>;

  /** Kinematic solve for a drive, followed by the deformation when one is set. */
  solveDrive(drive: Drive, warm?: number[]): { points: Vec3[]; x: number[]; converged: boolean } {
    const res = this.mech.solve(drive, warm);
    if (!this.deform) return res;
    const st: CornerState = { articulation: { bump: 0, roll: 0, rack: drive.rack ?? 0 }, points: res.points, groundZ: drive.groundZ, x: res.x, drive, converged: res.converged };
    return { ...res, points: this.deform(st) };
  }

  /** True when the template has both wheels of the axle. */
  get fullAxle(): boolean {
    return this.sides.length > 1;
  }

  get radius(): number {
    return this.mech.rollingRadius;
  }

  pointIndex(gen: GenType): number | undefined {
    return this.idx(gen);
  }

  driveFor(a: Required<Articulation>): Drive {
    const phi = rad(-a.roll); // rotation about +X: negative raises -Y, lowers +Y side
    const origin: Vec3 = [0, 0, this.rollAxisZ];
    const body = a.roll !== 0 ? (p: Vec3) => rotateAbout(p, origin, [1, 0, 0], phi) : undefined;
    return { groundZ: this.z0 + a.bump, groundZ2: this.z0Left + a.bump, body, rack: a.rack };
  }

  solve(a: Articulation, warm?: number[]): CornerState {
    const art = { bump: a.bump ?? 0, roll: a.roll ?? 0, rack: a.rack ?? 0 };
    const drive = this.driveFor(art);
    const res = this.solveDrive(drive, warm);
    return { articulation: art, points: res.points, groundZ: drive.groundZ, x: res.x, drive, converged: res.converged };
  }

  /** Tyre contact point of a wheel, in model coordinates. */
  tcp(points: Vec3[], wheel = 0): Vec3 {
    const s = this.sides[wheel];
    return tyreContactPoint(points[s.wc], points[s.stub], this.radius);
  }

  length(points: Vec3[], a?: number, b?: number): number {
    if (a === undefined || b === undefined) return NaN;
    const d = sub(points[a], points[b]);
    return Math.hypot(...d);
  }

  damperLength(points: Vec3[], wheel = 0): number {
    return this.length(points, ...this.sides[wheel].damper);
  }

  springLength(points: Vec3[], wheel = 0): number {
    return this.length(points, ...this.sides[wheel].spring);
  }

  /**
   * Rates per mm of wheel travel, from a small ground perturbation at fixed body and rack. `sign` sets how
   * the second wheel's ground moves on a full axle: +1 for parallel bump (heave), -1 for opposed (roll).
   * Returns one entry per wheel, in model coordinates.
   */
  wheelRates(st: CornerState, sign: 1 | -1 = 1, h = 0.05): CornerRates[] {
    const g2 = st.drive.groundZ2 ?? st.groundZ;
    const up = this.solveDrive({ ...st.drive, groundZ: st.groundZ + h, groundZ2: g2 + sign * h }, st.x);
    const dn = this.solveDrive({ ...st.drive, groundZ: st.groundZ - h, groundZ2: g2 - sign * h }, st.x);
    return this.sides.map((_, k) => {
      // per mm of this wheel's own travel
      const s = (k === 0 ? 1 : sign) / (2 * h);
      const d = (f: (p: Vec3[]) => number) => (f(up.points) - f(dn.points)) * s;
      const dv = (f: (p: Vec3[]) => Vec3): Vec3 => {
        const a = f(up.points);
        const b = f(dn.points);
        return [(a[0] - b[0]) * s, (a[1] - b[1]) * s, (a[2] - b[2]) * s];
      };
      return {
        tcp: dv((p) => this.tcp(p, k)),
        wc: dv((p) => p[this.sides[k].wc]),
        damperLength: d((p) => this.damperLength(p, k)),
        springLength: d((p) => this.springLength(p, k)),
      };
    });
  }

  /** Rates of the right wheel for parallel bump (both wheels of a full axle move together). */
  rates(st: CornerState, h = 0.05): CornerRates {
    return this.wheelRates(st, 1, h)[0];
  }

  /**
   * Kinematic roll centre of a full axle, as absolute (y, z): where the normals to the two contact-point
   * paths meet for opposed wheel travel. For a rigid axle this is the centre the axle rolls about relative to
   * the body; for independent wheels it is the usual swing-arm construction.
   */
  rollCentreAxle(st: CornerState, h = 0.05): [number, number] {
    const [r, l] = this.wheelRates(st, -1, h);
    const tr = this.tcp(st.points, 0);
    const tl = this.tcp(st.points, 1);
    return intersectYZ(tr, [-r.tcp[2], r.tcp[1]], tl, [-l.tcp[2], l.tcp[1]]);
  }

  /** Roll centre height (absolute z) for a symmetric bump state: normal to the contact path meets y = 0. */
  rollCentreBump(st: CornerState, r: CornerRates): number {
    const t = this.tcp(st.points);
    if (Math.abs(r.tcp[2]) < 1e-12) return NaN;
    return t[2] + (t[1] * r.tcp[1]) / r.tcp[2];
  }

  /**
   * Steering axis at a solved state. Uses the ball joints when the template has them; otherwise, for a
   * steerable template, the instantaneous screw axis of the upright under a small rack movement (SHARK's
   * "steer small perturbation" method for virtual kingpins).
   */
  steeringAxisAt(st: CornerState, h = 0.05, wheel = 0): [Vec3, Vec3] | undefined {
    const fixed = this.steeringAxis(st.points, wheel);
    if (fixed || this.mech.rackPoint === undefined) return fixed;
    return this.screwAxis(st, h, wheel);
  }

  /** Instantaneous screw axis of the upright for a small rack movement, as (lower point, upper point). */
  screwAxis(st: CornerState, h = 0.05, wheel = 0): [Vec3, Vec3] | undefined {
    if (this.mech.rackPoint === undefined) return undefined;
    const wc = this.sides[wheel].wc;
    const body = this.mech.bodies.find((b) => b.local.has(wc));
    if (!body) return undefined;
    const rack = st.drive.rack ?? 0;
    const a = this.solveDrive({ ...st.drive, rack: rack + h }, st.x);
    const b = this.solveDrive({ ...st.drive, rack: rack - h }, st.x);
    const idx = [...body.local.keys()];
    const p = idx.map((i) => st.points[i]);
    const v = idx.map((i) => sub(a.points[i], b.points[i]).map((d) => d / (2 * h)) as Vec3);
    // Rigid-body velocities: v_i - v_0 = w x (p_i - p_0). Solve for w by least squares.
    const A: number[][] = [];
    const rhs: number[] = [];
    for (let k = 1; k < idx.length; k++) {
      const d = sub(p[k], p[0]);
      const dv = sub(v[k], v[0]);
      // w x d = [-d]x w
      A.push([0, d[2], -d[1]], [-d[2], 0, d[0]], [d[1], -d[0], 0]);
      rhs.push(dv[0], dv[1], dv[2]);
    }
    const AtA = [0, 1, 2].map((i) => [0, 1, 2].map((j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
    const Atb = [0, 1, 2].map((i) => A.reduce((s, r, k) => s + r[i] * rhs[k], 0));
    const w = solveLinear(AtA, Atb);
    if (!w) return undefined;
    const w2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
    if (w2 < 1e-20) return undefined;
    const o = add(p[0], scale(cross(w as Vec3, v[0]), 1 / w2));
    let u = normalize(w as Vec3);
    if (u[2] < 0) u = scale(u, -1);
    return [sub(o, scale(u, 100)), add(o, scale(u, 100))];
  }

  /** Steering axis from ball joints as (lower point, upper point), or undefined when the template has none. */
  steeringAxis(points: Vec3[], wheel = 0): [Vec3, Vec3] | undefined {
    const s = this.sides[wheel];
    const top = s.ubj ?? s.strutTop;
    if (s.lbj === undefined || top === undefined) return undefined;
    return [points[s.lbj], points[top]];
  }
}

/** Intersection of two lines in the YZ plane, each given by a point and a direction. Returns [y, z]. */
export function intersectYZ(p1: Vec3, d1: [number, number], p2: Vec3, d2: [number, number]): [number, number] {
  const det = d1[0] * -d2[1] + d2[0] * d1[1];
  if (Math.abs(det) < 1e-14) return [NaN, NaN];
  const by = p2[1] - p1[1];
  const bz = p2[2] - p1[2];
  const t = (by * -d2[1] + d2[0] * bz) / det;
  return [p1[1] + t * d1[0], p1[2] + t * d1[1]];
}

export const toDeg = deg;
