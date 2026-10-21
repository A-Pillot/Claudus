/**
 * Kinematic model of one suspension corner, built from a template and its hard points.
 *
 * Every part with three or more points is a rigid body with six unknowns (translation of its centroid
 * plus a rotation vector). A part with two points is a link of fixed length. A point that is only on links
 * becomes a free point with three unknowns. Shared points become coincidence constraints, so a ball joint
 * is one shared point and a revolute is two. The wheel touches a ground plane, and a Macpherson strut's
 * top must stay on the strut axis. The system is solved with Levenberg-Marquardt, which copes with the
 * redundant equations that revolutes and rocker axes produce.
 */
import { add, cross, dist, dot, mat3MulVec, norm, normalize, rad, rotateAbout, rotFromVec, scale, sub, type Vec3 } from '../math/vec3.js';
import { lmStep, norm2 } from '../math/linalg.js';
import { GenType, GROUND, NONE, dataPoints, findGen, hasGen, type Template } from '../template/types.js';
import { expandPoints } from '../template/define.js';

/** What moves the mechanism: where the ground is, where the body is, and the rack position. */
export interface Drive {
  /** Height of the ground plane (lowest point of the tyre), mm. */
  groundZ: number;
  /** Maps a body-fixed point from its static position to its current position. Identity when omitted. */
  body?: (p: Vec3) => Vec3;
  /** Rack travel along +Y applied to the steering attachment points (and a rack link part), mm. */
  rack?: number;
  /** Ground height under the second wheel of a full-axle template. Defaults to groundZ. */
  groundZ2?: number;
  /**
   * Steering box axis (two points). When set, `rack` is the steering arm angle in degrees and the rack points
   * turn about this axis instead of sliding along Y.
   */
  steerAxis?: [Vec3, Vec3];
}

/** A wheel of the mechanism: template indexes of its centre and stub axle points. */
export interface WheelRef {
  wc: number;
  stub: number;
}

interface Body {
  part: number;
  centroid: Vec3;
  /** point index -> offset from centroid in the static position */
  local: Map<number, Vec3>;
  offset: number; // index into the unknown vector
}

type Source = { kind: 'ground' } | { kind: 'body'; body: number } | { kind: 'free'; offset: number };

export interface SolveResult {
  /** Positions of all template points, in template order. */
  points: Vec3[];
  x: number[];
  residual: number;
  iterations: number;
  converged: boolean;
}

export class Mechanism {
  readonly template: Template;
  readonly staticPoints: Vec3[];
  readonly rollingRadius: number;
  readonly index: Map<number, number>; // point number -> template index
  readonly bodies: Body[] = [];
  readonly nUnknowns: number;
  private readonly sources: Source[];
  private readonly coincidences: { point: number; body: number }[] = [];
  private readonly links: { a: number; b: number; length: number }[] = [];
  private readonly struts: { top: number; slider: number; end: number }[] = [];
  /**
   * Twist beam centre joints (shear points joining two moving parts): held on the body's centre plane, and
   * the two arms may only turn relative to each other about the body's lateral axis.
   */
  private readonly shearLocks: { point: number; a: number; b: number }[] = [];
  /** Bodies attached only along one line (a link carrying an extra point): their spin about that line is held. */
  private readonly spinLocks: { body: number; axis: Vec3 }[] = [];
  /** One wheel for a corner template, two (right then left) for a full-axle template. */
  readonly wheels: WheelRef[];
  /** Ground points the rack moves: steering attachments and the points of a rack link part. */
  readonly rackPoints: number[] = [];
  private readonly rackSet: Set<number>;

  constructor(template: Template, points: Vec3[], rollingRadius: number) {
    const nData = dataPoints(template).length;
    if (points.length > nData && points.length !== template.points.length)
      throw new Error(`Template ${template.slot} needs ${nData} points, model has ${points.length}`);
    points = expandPoints(template, points.slice(0, nData));
    this.template = template;
    this.staticPoints = points.map((p) => [...p] as Vec3);
    this.rollingRadius = rollingRadius;
    this.index = new Map(template.points.map((p, i) => [p.no, i]));

    // Which template points sit on which part.
    const nParts = template.parts.length;
    const onPart: number[][] = Array.from({ length: nParts + 1 }, () => []);
    template.points.forEach((p, i) => {
      for (const part of [p.part1, p.part2]) if (part > 0) onPart[part].push(i);
    });

    // A rack housing (RackMount points) and a rack link (RackLateralMount points) are compliant parts. In
    // kinematics the housing is fixed to the body and the link moves rigidly with the rack.
    const partHasGen = (part: number, g: GenType) => onPart[part].some((i) => hasGen(template.points[i], g));
    const groundLike = new Set<number>();
    const rackParts = new Set<number>();
    for (let part = 1; part <= nParts; part++) {
      const housing = partHasGen(part, GenType.RackMount);
      if (partHasGen(part, GenType.RackLateralMount) && !housing) rackParts.add(part);
      if (rackParts.has(part) || housing) groundLike.add(part);
    }

    let offset = 0;
    const bodyOfPart = new Map<number, number>();
    for (let part = 1; part <= nParts; part++) {
      const idx = onPart[part];
      if (idx.length < 3 || groundLike.has(part)) continue;
      const centroid = scale(idx.reduce<Vec3>((s, i) => add(s, points[i]), [0, 0, 0]), 1 / idx.length);
      bodyOfPart.set(part, this.bodies.length);
      this.bodies.push({ part, centroid, local: new Map(idx.map((i) => [i, sub(points[i], centroid)])), offset });
      offset += 6;
    }

    this.sources = template.points.map((p) => {
      const parts = [p.part1, p.part2].filter((x) => x !== NONE);
      if (parts.some((x) => x === GROUND || groundLike.has(x))) return { kind: 'ground' };
      const b = parts.find((x) => bodyOfPart.has(x));
      if (b !== undefined) return { kind: 'body', body: bodyOfPart.get(b)! };
      const src: Source = { kind: 'free', offset };
      offset += 3;
      return src;
    });
    this.nUnknowns = offset;

    // A body whose joints all lie on one line could spin freely about it, leaving any other point on it
    // (a spring or damper mount) undefined. Hold that spin at its static value.
    // Only bodies that carry nothing else the solver constrains: a wheel or strut body's spin is real motion.
    const memberships = template.points.map((p) => [p.part1, p.part2].filter((x) => x !== NONE).length);
    const constrained = new Set(
      [GenType.WheelCentre, GenType.StubAxle, GenType.StrutSliderPoint, GenType.StrutEndPoint,
        GenType.WheelCentre2, GenType.StubAxle2, GenType.StrutSliderPoint2, GenType.StrutEndPoint2]
        .map((g) => findGen(template, g))
        .filter((p) => p !== undefined)
        .map((p) => this.index.get(p!.no)!),
    );
    this.bodies.forEach((b, bi) => {
      if ([...b.local.keys()].some((i) => constrained.has(i))) return;
      const joints = [...b.local.keys()].filter((i) => memberships[i] > 1).map((i) => points[i]);
      if (joints.length < 2) return;
      let a = joints[0];
      let far = joints[1];
      for (const q of joints) if (dist(a, q) > dist(a, far)) far = q;
      const axis = normalize(sub(far, a));
      const collinear = joints.every((q) => norm(cross(sub(q, a), axis)) < 1e-6 * Math.max(1, dist(a, far)));
      if (collinear) this.spinLocks.push({ body: bi, axis });
    });

    // Coincidence: every rigid body a point is on must agree with the point's primary position.
    template.points.forEach((p, i) => {
      const src = this.sources[i];
      for (const part of [p.part1, p.part2]) {
        const b = bodyOfPart.get(part);
        if (b === undefined) continue;
        if (src.kind === 'body' && src.body === b) continue;
        this.coincidences.push({ point: i, body: b });
      }
    });

    // A twist beam's two arms meet at a shear point. Kinematically that is a ball joint whose sideways
    // position is held, so each arm rotates about the line from its body pivot to the beam centre in roll,
    // and both about the pivot line in bump. Compliance then adds the beam's torsion and bending stiffness.
    template.points.forEach((p, i) => {
      if (!hasGen(p, GenType.ShearPoint)) return;
      if (p.part1 === NONE || p.part2 === NONE || p.part1 === GROUND || p.part2 === GROUND) return;
      const a = bodyOfPart.get(p.part1);
      const b = bodyOfPart.get(p.part2);
      if (a === undefined || b === undefined) return;
      this.shearLocks.push({ point: i, a, b });
    });

    for (let part = 1; part <= nParts; part++) {
      const idx = onPart[part];
      if (idx.length === 2 && !groundLike.has(part)) this.links.push({ a: idx[0], b: idx[1], length: dist(points[idx[0]], points[idx[1]]) });
      if (idx.length < 2) throw new Error(`Template ${template.slot}: part ${part} has fewer than two points`);
    }

    const at = (g: GenType) => {
      const p = findGen(template, g);
      return p ? this.index.get(p.no)! : undefined;
    };
    const wc = at(GenType.WheelCentre);
    const stub = at(GenType.StubAxle);
    if (wc === undefined || stub === undefined) throw new Error(`Template ${template.slot} has no wheel centre or stub axle point`);
    this.wheels = [{ wc, stub }];
    const wc2 = at(GenType.WheelCentre2);
    if (wc2 !== undefined) this.wheels.push({ wc: wc2, stub: at(GenType.StubAxle2) ?? stub });

    const strutGens: [GenType, GenType, GenType][] = [
      [GenType.StrutSliderPoint, GenType.StrutEndPoint, GenType.Damper1ToBody],
      [GenType.StrutSliderPoint2, GenType.StrutEndPoint2, GenType.Damper2ToBody],
    ];
    for (const [s, e, t] of strutGens) {
      const [slider, end, top] = [at(s), at(e), at(t)];
      if (slider !== undefined && end !== undefined && top !== undefined) this.struts.push({ top, slider, end });
    }

    template.points.forEach((p, i) => {
      if (this.sources[i].kind !== 'ground') return;
      const steer = hasGen(p, GenType.SteeringAttachment) || hasGen(p, GenType.SteeringAttachment2);
      if (steer || rackParts.has(p.part1) || rackParts.has(p.part2)) this.rackPoints.push(i);
    });
    // The first steering attachment leads, so a corner's rackPoint is what it always was.
    this.rackPoints.sort((a, b) => Number(hasGen(template.points[b], GenType.SteeringAttachment)) - Number(hasGen(template.points[a], GenType.SteeringAttachment)));
    this.rackSet = new Set(this.rackPoints);
  }

  get wheelCentre(): number {
    return this.wheels[0].wc;
  }

  get stubAxle(): number {
    return this.wheels[0].stub;
  }

  /** True when the template models both wheels of an axle. */
  get fullAxle(): boolean {
    return this.wheels.length > 1;
  }

  /** A ground point the rack moves, when the template is steerable. */
  get rackPoint(): number | undefined {
    return this.rackPoints[0];
  }

  /** Unknown vector for the static position. */
  initialX(): number[] {
    return new Array(this.nUnknowns).fill(0).map((_, k) => {
      for (let i = 0; i < this.sources.length; i++) {
        const s = this.sources[i];
        if (s.kind === 'free' && k >= s.offset && k < s.offset + 3) return this.staticPoints[i][k - s.offset];
      }
      return 0;
    });
  }

  private bodyPoint(b: number, i: number, x: number[]): Vec3 {
    const body = this.bodies[b];
    const o = body.offset;
    const R = rotFromVec([x[o + 3], x[o + 4], x[o + 5]]);
    return add(add(body.centroid, [x[o], x[o + 1], x[o + 2]]), mat3MulVec(R, body.local.get(i)!));
  }

  private groundPoint(i: number, drive: Drive): Vec3 {
    let p = this.staticPoints[i];
    if (drive.rack && this.rackSet.has(i))
      p = drive.steerAxis ? rotateAbout(p, drive.steerAxis[0], normalize(sub(drive.steerAxis[1], drive.steerAxis[0])), rad(drive.rack)) : [p[0], p[1] + drive.rack, p[2]];
    return drive.body ? drive.body(p) : p;
  }

  /** Current position of a point for a given unknown vector. */
  position(i: number, x: number[], drive: Drive): Vec3 {
    const s = this.sources[i];
    if (s.kind === 'ground') return this.groundPoint(i, drive);
    if (s.kind === 'body') return this.bodyPoint(s.body, i, x);
    return [x[s.offset], x[s.offset + 1], x[s.offset + 2]];
  }

  allPositions(x: number[], drive: Drive): Vec3[] {
    return this.staticPoints.map((_, i) => this.position(i, x, drive));
  }

  residuals(x: number[], drive: Drive): number[] {
    const r: number[] = [];
    const pos = (i: number) => this.position(i, x, drive);
    for (const c of this.coincidences) r.push(...sub(this.bodyPoint(c.body, c.point, x), pos(c.point)));
    for (const l of this.links) r.push(dist(pos(l.a), pos(l.b)) - l.length);
    for (const l of this.spinLocks) {
      const o = this.bodies[l.body].offset;
      // twist component of the body's rotation vector, scaled to be comparable with mm residuals
      r.push(100 * (x[o + 3] * l.axis[0] + x[o + 4] * l.axis[1] + x[o + 5] * l.axis[2]));
    }
    for (const l of this.shearLocks) {
      const i = l.point;
      const ref = this.groundPoint(i, { ...drive, rack: 0 });
      const axis = (v: Vec3): Vec3 => (drive.body ? sub(drive.body(add(this.staticPoints[i], v)), ref) : v);
      r.push(dot(sub(pos(i), ref), axis([0, 1, 0])));
      // Relative rotation of the arms, Ra Rbᵀ, as sin(angle) x axis; its fore-aft part must vanish.
      const Ra = rotFromVec(x.slice(this.bodies[l.a].offset + 3, this.bodies[l.a].offset + 6) as Vec3);
      const Rb = rotFromVec(x.slice(this.bodies[l.b].offset + 3, this.bodies[l.b].offset + 6) as Vec3);
      const M = [0, 1, 2].map((r1) => [0, 1, 2].map((c) => Ra[3 * r1] * Rb[3 * c] + Ra[3 * r1 + 1] * Rb[3 * c + 1] + Ra[3 * r1 + 2] * Rb[3 * c + 2]));
      const w: Vec3 = [(M[2][1] - M[1][2]) / 2, (M[0][2] - M[2][0]) / 2, (M[1][0] - M[0][1]) / 2];
      r.push(100 * dot(w, axis([1, 0, 0])));
    }
    for (const s of this.struts) {
      const P = pos(s.slider);
      const axis = normalize(sub(pos(s.end), P));
      r.push(...cross(sub(pos(s.top), P), axis));
    }
    this.wheels.forEach((w, k) => {
      const ground = k === 0 ? drive.groundZ : (drive.groundZ2 ?? drive.groundZ);
      r.push(wheelLowestZ(pos(w.wc), pos(w.stub), this.rollingRadius) - ground);
    });
    return r;
  }

  /** Solve for the mechanism position that satisfies all constraints for the given drive. */
  solve(drive: Drive, x0?: number[], tol = 1e-9): SolveResult {
    let x = x0 ? [...x0] : this.initialX();
    let r = this.residuals(x, drive);
    let f = norm2(r);
    let lambda = 1e-6;
    let it = 0;
    const n = x.length;
    for (; it < 200 && f > tol; it++) {
      const h = 1e-7;
      const J: number[][] = r.map(() => new Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        const xp = [...x];
        xp[j] += h;
        const rp = this.residuals(xp, drive);
        for (let k = 0; k < r.length; k++) J[k][j] = (rp[k] - r[k]) / h;
      }
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const dx = lmStep(J, r, lambda);
        const xt = x.map((v, k) => v + dx[k]);
        const rt = this.residuals(xt, drive);
        const ft = norm2(rt);
        if (ft < f) {
          x = xt;
          r = rt;
          f = ft;
          lambda = Math.max(lambda / 4, 1e-12);
          improved = true;
          break;
        }
        lambda *= 8;
      }
      if (!improved) break;
    }
    return { points: this.allPositions(x, drive), x, residual: f, iterations: it, converged: f <= Math.max(tol, 1e-6) };
  }
}

/** Unit spindle axis pointing from the stub axle point to the wheel centre (outboard on the right side). */
export const spindleAxis = (wc: Vec3, stub: Vec3): Vec3 => normalize(sub(wc, stub));

/** Height of the lowest point of a tyre disc of radius R. */
export function wheelLowestZ(wc: Vec3, stub: Vec3, R: number): number {
  const a = spindleAxis(wc, stub);
  return wc[2] - R * Math.sqrt(Math.max(0, 1 - a[2] * a[2]));
}

/** Tyre contact point: the lowest point of the tyre disc. */
export function tyreContactPoint(wc: Vec3, stub: Vec3, R: number): Vec3 {
  const a = spindleAxis(wc, stub);
  const down: Vec3 = [a[2] * a[0], a[2] * a[1], -1 + a[2] * a[2]]; // -z projected into the wheel plane
  const d = norm(down) > 1e-12 ? normalize(down) : ([0, 0, -1] as Vec3);
  return add(wc, scale(d, R));
}
