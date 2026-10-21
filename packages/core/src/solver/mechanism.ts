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
import { add, cross, dist, mat3MulVec, norm, normalize, rotFromVec, scale, sub, type Vec3 } from '../math/vec3.js';
import { lmStep, norm2 } from '../math/linalg.js';
import { GenType, GROUND, NONE, dataPoints, findGen, type Template } from '../template/types.js';
import { expandPoints } from '../template/define.js';

/** What moves the mechanism: where the ground is, where the body is, and the rack position. */
export interface Drive {
  /** Height of the ground plane (lowest point of the tyre), mm. */
  groundZ: number;
  /** Maps a body-fixed point from its static position to its current position. Identity when omitted. */
  body?: (p: Vec3) => Vec3;
  /** Rack travel along +Y applied to the steering attachment point, mm. */
  rack?: number;
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
  private readonly strut?: { top: number; slider: number; end: number };
  /** Bodies attached only along one line (a link carrying an extra point): their spin about that line is held. */
  private readonly spinLocks: { body: number; axis: Vec3 }[] = [];
  readonly wheelCentre: number;
  readonly stubAxle: number;
  readonly rackPoint?: number;

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

    let offset = 0;
    const bodyOfPart = new Map<number, number>();
    for (let part = 1; part <= nParts; part++) {
      const idx = onPart[part];
      if (idx.length < 3) continue;
      const centroid = scale(idx.reduce<Vec3>((s, i) => add(s, points[i]), [0, 0, 0]), 1 / idx.length);
      bodyOfPart.set(part, this.bodies.length);
      this.bodies.push({ part, centroid, local: new Map(idx.map((i) => [i, sub(points[i], centroid)])), offset });
      offset += 6;
    }

    this.sources = template.points.map((p) => {
      const parts = [p.part1, p.part2].filter((x) => x !== NONE);
      if (parts.includes(GROUND)) return { kind: 'ground' };
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
      [GenType.WheelCentre, GenType.StubAxle, GenType.StrutSliderPoint, GenType.StrutEndPoint]
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

    for (let part = 1; part <= nParts; part++) {
      const idx = onPart[part];
      if (idx.length === 2) this.links.push({ a: idx[0], b: idx[1], length: dist(points[idx[0]], points[idx[1]]) });
      if (idx.length < 2) throw new Error(`Template ${template.slot}: part ${part} has fewer than two points`);
    }

    const wc = findGen(template, GenType.WheelCentre);
    const stub = findGen(template, GenType.StubAxle);
    if (!wc || !stub) throw new Error(`Template ${template.slot} has no wheel centre or stub axle point`);
    this.wheelCentre = this.index.get(wc.no)!;
    this.stubAxle = this.index.get(stub.no)!;

    const slider = findGen(template, GenType.StrutSliderPoint);
    const end = findGen(template, GenType.StrutEndPoint);
    const top = findGen(template, GenType.Damper1ToBody);
    if (slider && end && top)
      this.strut = { top: this.index.get(top.no)!, slider: this.index.get(slider.no)!, end: this.index.get(end.no)! };

    const rack = findGen(template, GenType.SteeringAttachment);
    if (rack && this.sources[this.index.get(rack.no)!].kind === 'ground') this.rackPoint = this.index.get(rack.no);
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
    if (i === this.rackPoint && drive.rack) p = [p[0], p[1] + drive.rack, p[2]];
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
    if (this.strut) {
      const P = pos(this.strut.slider);
      const axis = normalize(sub(pos(this.strut.end), P));
      r.push(...cross(sub(pos(this.strut.top), P), axis));
    }
    r.push(wheelLowestZ(pos(this.wheelCentre), pos(this.stubAxle), this.rollingRadius) - drive.groundZ);
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
