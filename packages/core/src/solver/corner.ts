/**
 * One suspension corner (right-hand side) with the articulations SHARK offers: bump/rebound, body roll,
 * steering and combinations of them. The left side is the mirror image.
 */
import { add, cross, deg, normalize, rad, rotateAbout, scale, sub, type Vec3 } from '../math/vec3.js';
import { solveLinear } from '../math/linalg.js';
import type { End, SuspensionData } from '../model/types.js';
import { getTemplate } from '../template/registry.js';
import { GenType, findGen, type Template } from '../template/types.js';
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

export class Corner {
  readonly mech: Mechanism;
  readonly template: Template;
  readonly end: End;
  /** Static ground height: the lowest tyre point at the input hard points. */
  readonly z0: number;
  /** Static roll centre height used as the body roll axis, mm (absolute z). */
  rollAxisZ: number;
  private readonly idx: (gen: GenType) => number | undefined;

  constructor(data: SuspensionData, end: End, template: Template = getTemplate(data.templateSlot)) {
    this.template = template;
    this.end = end;
    this.mech = new Mechanism(template, data.points, data.rollingRadius);
    const p = data.points;
    this.z0 = wheelLowestZ(p[this.mech.wheelCentre], p[this.mech.stubAxle], data.rollingRadius);
    this.idx = (gen) => {
      const tp = findGen(template, gen);
      return tp ? this.mech.index.get(tp.no) : undefined;
    };
    this.rollAxisZ = this.z0;
    const st = this.solve({});
    this.rollAxisZ = this.rollCentreBump(st, this.rates(st));
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
    return { groundZ: this.z0 + a.bump, body, rack: a.rack };
  }

  solve(a: Articulation, warm?: number[]): CornerState {
    const art = { bump: a.bump ?? 0, roll: a.roll ?? 0, rack: a.rack ?? 0 };
    const drive = this.driveFor(art);
    const res = this.mech.solve(drive, warm);
    return { articulation: art, points: res.points, groundZ: drive.groundZ, x: res.x, drive, converged: res.converged };
  }

  tcp(points: Vec3[]): Vec3 {
    return tyreContactPoint(points[this.mech.wheelCentre], points[this.mech.stubAxle], this.radius);
  }

  length(points: Vec3[], a?: number, b?: number): number {
    if (a === undefined || b === undefined) return NaN;
    const d = sub(points[a], points[b]);
    return Math.hypot(...d);
  }

  damperLength(points: Vec3[]): number {
    return this.length(points, this.idx(GenType.Damper1ToSuspension), this.idx(GenType.Damper1ToBody));
  }

  springLength(points: Vec3[]): number {
    return this.length(points, this.idx(GenType.Spring1ToSuspension), this.idx(GenType.Spring1ToBody));
  }

  /** Small symmetric ground perturbation around a state. */
  rates(st: CornerState, h = 0.05): CornerRates {
    const up = this.mech.solve({ ...st.drive, groundZ: st.groundZ + h }, st.x);
    const dn = this.mech.solve({ ...st.drive, groundZ: st.groundZ - h }, st.x);
    const d = (f: (p: Vec3[]) => number) => (f(up.points) - f(dn.points)) / (2 * h);
    const dv = (f: (p: Vec3[]) => Vec3): Vec3 => {
      const a = f(up.points);
      const b = f(dn.points);
      return [(a[0] - b[0]) / (2 * h), (a[1] - b[1]) / (2 * h), (a[2] - b[2]) / (2 * h)];
    };
    return {
      tcp: dv((p) => this.tcp(p)),
      wc: dv((p) => p[this.mech.wheelCentre]),
      damperLength: d((p) => this.damperLength(p)),
      springLength: d((p) => this.springLength(p)),
    };
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
  steeringAxisAt(st: CornerState, h = 0.05): [Vec3, Vec3] | undefined {
    const fixed = this.steeringAxis(st.points);
    if (fixed || this.mech.rackPoint === undefined) return fixed;
    return this.screwAxis(st, h);
  }

  /** Instantaneous screw axis of the upright for a small rack movement, as (lower point, upper point). */
  screwAxis(st: CornerState, h = 0.05): [Vec3, Vec3] | undefined {
    if (this.mech.rackPoint === undefined) return undefined;
    const body = this.mech.bodies.find((b) => b.local.has(this.mech.wheelCentre));
    if (!body) return undefined;
    const rack = st.drive.rack ?? 0;
    const a = this.mech.solve({ ...st.drive, rack: rack + h }, st.x);
    const b = this.mech.solve({ ...st.drive, rack: rack - h }, st.x);
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
  steeringAxis(points: Vec3[]): [Vec3, Vec3] | undefined {
    const lbj = this.idx(GenType.LowerBallJoint);
    let top = this.idx(GenType.UpperBallJoint);
    if (top === undefined && this.idx(GenType.StrutSliderPoint) !== undefined) top = this.idx(GenType.Damper1ToBody);
    if (lbj === undefined || top === undefined) return undefined;
    return [points[lbj], points[top]];
  }
}

export const toDeg = deg;
