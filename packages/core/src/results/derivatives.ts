/**
 * Suspension derivatives, following SHARK's definitions (SAE J670e plus Lotus conventions).
 * All values are for the right-hand (+Y) corner; signs follow the SHARK help "Theory" topic.
 */
import { makeCompliant } from '../compliance/apply.js';
import { defaultCompliance } from '../compliance/types.js';
import { deg, mirrorY, sub, type Vec3 } from '../math/vec3.js';
import type { Model, VehicleParams } from '../model/types.js';
import { Corner, intersectYZ, type CornerRates, type CornerState } from '../solver/corner.js';
import { spindleAxis } from '../solver/mechanism.js';
import { isMeasure, measureValues } from '../graphics/elements.js';
import { bumpSteps } from '../model/combined.js';
import { solverOptionsFor, type SolverOptions } from '../solver/options.js';
import { combinedSweep, type CombinedRow } from './combined.js';
import { swingArms } from './swingArm.js';

export interface WheelGeometry {
  camber: number; // deg, + top outward
  toeSae: number; // deg, + toe-in
  toePlane: number; // deg, + toe-in, measured in the wheel plane
  castor: number; // deg, + axis leans rearward at the top
  kingpin: number; // deg, + axis leans inward at the top
  castorTrail: number; // mm, + axis ahead of wheel centre
  castorOffset: number; // mm, + axis/ground point ahead of contact centre
  kingpinOffsetWheel: number; // mm, + wheel centre outboard of axis
  kingpinOffsetGround: number; // mm, + contact centre outboard of axis/ground point
  mechanicalTrail: number; // mm
  tcp: Vec3;
  wc: Vec3;
}

/**
 * Wheel angles and steering-axis offsets for a solved corner. `wheel` 1 is the left wheel of a full-axle
 * template; its values come out in the right-hand convention (computed on the mirror image), so both sides
 * read the same way.
 */
export function wheelGeometry(c: Corner, points: Vec3[], groundZ: number, state?: CornerState, wheel = 0): WheelGeometry {
  const m = wheel === 0 ? (p: Vec3) => p : mirrorY;
  const side = c.sides[wheel];
  const wc = m(points[side.wc]);
  const a = spindleAxis(wc, m(points[side.stub]));
  const tcp = m(c.tcp(points, wheel));
  const g: WheelGeometry = {
    camber: deg(-Math.asin(a[2])),
    toeSae: deg(Math.atan2(-a[0], a[1])),
    toePlane: deg(Math.asin(-a[0])),
    castor: NaN,
    kingpin: NaN,
    castorTrail: NaN,
    castorOffset: NaN,
    kingpinOffsetWheel: NaN,
    kingpinOffsetGround: NaN,
    mechanicalTrail: NaN,
    tcp,
    wc,
  };
  const axis = state ? c.steeringAxisAt(state, undefined, wheel) : c.steeringAxis(points, wheel);
  if (axis) {
    const [lo, hi] = axis.map(m);
    const u = sub(hi, lo);
    g.castor = deg(Math.atan2(u[0], u[2]));
    g.kingpin = deg(Math.atan2(-u[1], u[2]));
    const at = (z: number): Vec3 => {
      const t = (z - lo[2]) / u[2];
      return [lo[0] + t * u[0], lo[1] + t * u[1], z];
    };
    const G = at(groundZ);
    const W = at(wc[2]);
    g.castorOffset = tcp[0] - G[0];
    g.kingpinOffsetGround = tcp[1] - G[1];
    g.castorTrail = wc[0] - W[0];
    g.kingpinOffsetWheel = wc[1] - W[1];
    g.mechanicalTrail = g.castorOffset * Math.cos((g.castor * Math.PI) / 180);
  }
  return g;
}

/**
 * The additional incremental values of the SHARK help (Theory, "Additional Incremental Values"): contact
 * patch and hub positions, tyre force, virtual swing arms, contact point gradient and the second damper and
 * spring of a full axle. Positions are model coordinates; swing arm centre heights and roll centre heights
 * are measured from the static ground, as in the roll centre.
 */
export interface WheelExtras {
  tcpRight: Vec3;
  tcpLeft: Vec3;
  hubRight: Vec3;
  hubLeft: Vec3;
  /** Vertical tyre force, N (compliant mode only, NaN otherwise). Right wheel and left wheel of a full axle. */
  tyreForce: number;
  tyreForceLeft: number;
  swingFrontLength: number;
  swingFrontY: number;
  swingFrontZ: number;
  swingSideLength: number;
  swingSideX: number;
  swingSideZ: number;
  /** dX/dZ of the contact point seen from the side, mm/mm. */
  tcpGradient: number;
  /** Damper 2 and spring 2 (the left wheel of a full axle), NaN when the template has none. */
  damper2Ratio: number;
  spring2Ratio: number;
  damper2Travel: number;
  spring2Travel: number;
}

export interface BumpRow extends WheelGeometry, WheelExtras {
  /** Values of the template's measurement elements (distance, components, angle), keyed as `measureColumns`. */
  measures?: Record<string, number>;
  bump: number;
  damperRatio: number;
  springRatio: number;
  antiDive: number; // %
  antiSquat: number; // %
  rollCentreToBody: number; // mm
  rollCentreToGround: number; // mm
  halfTrackChange: number; // mm
  wheelbaseChange: number; // mm
  damperTravel: number; // mm
  springTravel: number; // mm
  /** Roll centre X, Y (lateral) and Z, same convention as the roll sweep. */
  rollCentre: Vec3;
}

export interface RollRow extends WheelGeometry, WheelExtras {
  /** Values of the template's measurement elements (distance, components, angle), keyed as `measureColumns`. */
  measures?: Record<string, number>;
  roll: number;
  damperRatio: number;
  springRatio: number;
  rollCentre: Vec3; // absolute, z relative to static ground
  halfTrackChange: number;
  wheelbaseChange: number;
  damperTravel: number;
  springTravel: number;
}

export interface SteerRow extends WheelExtras, Pick<WheelGeometry, 'castor' | 'kingpin' | 'toePlane' | 'castorTrail' | 'castorOffset' | 'kingpinOffsetWheel' | 'kingpinOffsetGround' | 'mechanicalTrail'> {
  /** Measurement element values for the right wheel at this rack position. */
  measures?: Record<string, number>;
  rack: number;
  toeInner: number;
  toeOuter: number;
  camberInner: number;
  camberOuter: number;
  /** Steer angles of the inner and outer wheel in the direction of the turn, deg. */
  steerInner: number;
  steerOuter: number;
  ackermann: number; // %
  turningRadius: number; // mm, to the outer front contact point
  /** Roll centre X, Y (lateral) and Z at this rack position. The castor, offset and trail values above are the right wheel's. */
  rollCentre: Vec3;
}

/** Measurement element values at solved point positions; undefined when the template has none. */
function measuresAt(c: Corner, points: Vec3[]): Record<string, number> | undefined {
  if (!c.template.graphics.some(isMeasure)) return undefined;
  return measureValues(c.template, (no) => {
    const i = c.mech.index.get(no);
    return i === undefined ? undefined : points[i];
  });
}

const ratio = (dz: number, dl: number) => (Math.abs(dl) > 1e-12 ? Math.abs(dz / dl) : NaN);

/** Static lengths of damper 2 and spring 2 (the left wheel of a full axle), NaN when there are none. */
function secondStatics(c: Corner, points: Vec3[]): { d2: number; s2: number } {
  return c.fullAxle ? { d2: c.damperLength(points, 1), s2: c.springLength(points, 1) } : { d2: NaN, s2: NaN };
}

/**
 * The additional incremental values at one solved state. `rs` holds the rates of each wheel for the motion
 * being swept; `left` gives the left wheel of a corner model (the mirror image when omitted).
 */
function wheelExtras(c: Corner, st: CornerState, rs: CornerRates[], stat: { d2: number; s2: number }, left?: { tcp: Vec3; hub: Vec3 }): WheelExtras {
  const pts = st.points;
  const r = rs[0];
  const tcpRight = c.tcp(pts, 0);
  const hubRight = pts[c.sides[0].wc];
  const tcpLeft = c.fullAxle ? c.tcp(pts, 1) : left?.tcp ?? mirrorY(tcpRight);
  const hubLeft = c.fullAxle ? pts[c.sides[1].wc] : left?.hub ?? mirrorY(hubRight);
  const loads = c.compliantResults?.get(pts)?.tyreLoads;
  const sw = swingArms(tcpRight, r.tcp, hubRight, r.wc);
  const r2 = c.fullAxle ? rs[1] : undefined;
  return {
    tcpRight,
    tcpLeft,
    hubRight,
    hubLeft,
    tyreForce: loads?.[0] ?? NaN,
    tyreForceLeft: loads?.[1] ?? NaN,
    swingFrontLength: sw.front.length,
    swingFrontY: sw.front.centre[0],
    // Same frame as the roll centre: unaffected by whether the ground or the body moves.
    swingFrontZ: sw.front.centre[1] - st.dz - c.z0,
    swingSideLength: sw.side.length,
    swingSideX: sw.side.centre[0],
    swingSideZ: sw.side.centre[1] - st.dz - c.z0,
    tcpGradient: Math.abs(r.tcp[2]) > 1e-12 ? r.tcp[0] / r.tcp[2] : NaN,
    damper2Ratio: r2 ? ratio(r2.tcp[2], r2.damperLength) : NaN,
    spring2Ratio: r2 ? ratio(r2.tcp[2], r2.springLength) : NaN,
    damper2Travel: r2 ? c.damperLength(pts, 1) - stat.d2 : NaN,
    spring2Travel: r2 ? c.springLength(pts, 1) - stat.s2 : NaN,
  };
}

/** Tangent of the side-view angle that gives 100 % anti-dive / anti-squat. */
function antiPitch(c: Corner, r: CornerRates, p: VehicleParams, kind: 'dive' | 'squat'): number {
  const front = c.end === 'front';
  const L = p.wheelbase;
  const h = p.cogHeight;
  let share: number;
  let path: Vec3;
  if (kind === 'dive') {
    share = (front ? p.brakeFrontPct : 100 - p.brakeFrontPct) / 100;
    const inboard = (front ? p.frontBrakeType : p.rearBrakeType) === 1;
    path = inboard ? r.wc : r.tcp;
  } else {
    share = (front ? p.driveFrontPct : 100 - p.driveFrontPct) / 100;
    const rigid = (front ? p.frontSuspensionType : p.rearSuspensionType) === 2;
    path = rigid ? r.tcp : r.wc;
  }
  if (share <= 0 || Math.abs(path[2]) < 1e-12) return NaN;
  const tanTheta = ((front ? -1 : 1) * path[0]) / path[2];
  const tanRef = h / (L * share);
  return (100 * tanTheta) / tanRef;
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  if (step <= 0) return [from];
  // Whole increments only: a span that is not a multiple of the step stops short of `to`, never past it.
  const n = Math.floor((to - from) / step + 1e-9);
  for (let i = 0; i <= n; i++) out.push(Number((from + i * step).toFixed(9)));
  return out;
}

/**
 * Sweep a list of articulation values, warm-starting each solve from its neighbour, starting at static.
 * A position whose solve fails to converge ends the sweep in that direction, so it and every position beyond
 * it have no entry in the result: the suspension cannot reach them, and a failed state is no warm start.
 */
function sweep<T>(values: number[], solveAt: (v: number, warm?: number[]) => CornerState, row: (s: CornerState) => T): Map<number, T> {
  const out = new Map<number, T>();
  if (values.length === 0) return out;
  const zeroIdx = values.reduce((best, v, i) => (Math.abs(v) < Math.abs(values[best]) ? i : best), 0);
  const run = (idxs: number[]) => {
    let warm: number[] | undefined;
    for (const i of idxs) {
      const st = solveAt(values[i], warm);
      if (!st.converged) return;
      warm = st.x;
      out.set(values[i], row(st));
    }
  };
  run(values.map((_, i) => i).slice(zeroIdx));
  run(values.map((_, i) => i).slice(0, zeroIdx + 1).reverse());
  return out;
}

export { range as sweepRange, sweep as sweepSolve };

export function bumpSweep(c: Corner, p: VehicleParams, values = range(-p.reboundTravel, p.bumpTravel, p.bumpIncrement)): BumpRow[] {
  const stat = c.solve({});
  const tcp0 = c.tcp(stat.points);
  const d0 = c.damperLength(stat.points);
  const s0 = c.springLength(stat.points);
  const second = secondStatics(c, stat.points);
  const sign = c.end === 'front' ? -1 : 1;
  const rows = sweep(values, (v, w) => c.solve({ bump: v }, w), (st) => {
    const rs = c.wheelRates(st, 1);
    const r = rs[0];
    const g = wheelGeometry(c, st.points, st.groundZ, st);
    // Fore/aft position of the roll centre is that of the contact points.
    const [ry, rz] = c.fullAxle ? c.rollCentreAxle(st) : [0, c.rollCentreBump(st, r)];
    const rx = c.fullAxle ? (c.tcp(st.points, 0)[0] + c.tcp(st.points, 1)[0]) / 2 : g.tcp[0];
    return {
      bump: st.articulation.bump,
      ...g,
      ...wheelExtras(c, st, rs, second),
      measures: measuresAt(c, st.points),
      damperRatio: ratio(r.tcp[2], r.damperLength),
      springRatio: ratio(r.tcp[2], r.springLength),
      antiDive: antiPitch(c, r, p, 'dive'),
      antiSquat: antiPitch(c, r, p, 'squat'),
      rollCentreToBody: rz - st.dz - c.z0,
      rollCentreToGround: rz - st.groundZ,
      rollCentre: [rx, ry, rz - st.dz - c.z0],
      halfTrackChange: g.tcp[1] - tcp0[1],
      wheelbaseChange: sign * (g.tcp[0] - tcp0[0]),
      damperTravel: c.damperLength(st.points) - d0,
      springTravel: c.springLength(st.points) - s0,
    } satisfies BumpRow;
  });
  return values.filter((v) => rows.has(v)).map((v) => rows.get(v)!);
}

export function rollSweep(c: Corner, p: VehicleParams, values = range(-p.rollAngle, p.rollAngle, p.rollIncrement)): RollRow[] {
  const stat = c.solve({});
  const tcp0 = c.tcp(stat.points);
  const d0 = c.damperLength(stat.points);
  const s0 = c.springLength(stat.points);
  const second = secondStatics(c, stat.points);
  const sign = c.end === 'front' ? -1 : 1;
  if (c.fullAxle) {
    const rows = sweep(values, (v, w) => c.solve({ roll: v }, w), (st): RollRow => {
      const rs = c.wheelRates(st, -1);
      const r = rs[0];
      const g = wheelGeometry(c, st.points, st.groundZ, st);
      const [y, z] = c.rollCentreAxle(st);
      return {
        roll: st.articulation.roll,
        ...g,
        ...wheelExtras(c, st, rs, second),
        measures: measuresAt(c, st.points),
        damperRatio: ratio(r.tcp[2], r.damperLength),
        springRatio: ratio(r.tcp[2], r.springLength),
        rollCentre: [(c.tcp(st.points, 0)[0] + c.tcp(st.points, 1)[0]) / 2, y, z - c.z0],
        halfTrackChange: g.tcp[1] - tcp0[1],
        wheelbaseChange: sign * (g.tcp[0] - tcp0[0]),
        damperTravel: c.damperLength(st.points) - d0,
        springTravel: c.springLength(st.points) - s0,
      };
    });
    return values.filter((v) => rows.has(v)).map((v) => rows.get(v)!);
  }
  const states = sweep(values.flatMap((v) => [v, -v]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b),
    (v, w) => c.solve({ roll: v }, w), (st) => ({ st, rs: c.wheelRates(st, 1) }));
  return values.filter((v) => states.has(v) && states.has(-v)).map((v) => {
    const { st, rs } = states.get(v)!;
    const r = rs[0];
    const other = states.get(-v)!; // the left wheel at +v is the mirror of the right wheel at -v
    const tr = c.tcp(st.points);
    const tl = mirrorY(c.tcp(other.st.points));
    const nr: [number, number] = [-r.tcp[2], r.tcp[1]];
    const nl: [number, number] = [-other.rs[0].tcp[2], -other.rs[0].tcp[1]];
    const [y, z] = intersectYZ(tr, nr, tl, nl);
    const g = wheelGeometry(c, st.points, st.groundZ, st);
    return {
      roll: v,
      ...g,
      ...wheelExtras(c, st, rs, second, { tcp: tl, hub: mirrorY(other.st.points[c.sides[0].wc]) }),
      measures: measuresAt(c, st.points),
      damperRatio: ratio(r.tcp[2], r.damperLength),
      springRatio: ratio(r.tcp[2], r.springLength),
      rollCentre: [(tr[0] + tl[0]) / 2, y, z - c.z0],
      halfTrackChange: g.tcp[1] - tcp0[1],
      wheelbaseChange: sign * (g.tcp[0] - tcp0[0]),
      damperTravel: c.damperLength(st.points) - d0,
      springTravel: c.springLength(st.points) - s0,
    };
  });
}

export function steerSweep(c: Corner, p: VehicleParams, values = range(-p.steerTravel, p.steerTravel, p.steerIncrement)): SteerRow[] {
  if (c.mech.rackPoint === undefined) return [];
  const all = [...new Set(values.flatMap((v) => [v, -v]))].sort((a, b) => a - b);
  const second = secondStatics(c, c.solve({}).points);
  // Right wheel at each rack position, and the left wheel in right-hand convention.
  const pairs = sweep(all, (v, w) => c.solve({ rack: v }, w), (st) => {
    const rs = c.wheelRates(st, 1);
    const right = wheelGeometry(c, st.points, st.groundZ, st);
    const [ry, rz] = c.fullAxle ? c.rollCentreAxle(st) : [0, c.rollCentreBump(st, rs[0])];
    const rx = c.fullAxle ? (c.tcp(st.points, 0)[0] + c.tcp(st.points, 1)[0]) / 2 : right.tcp[0];
    return {
      st,
      rs,
      right,
      rollCentre: [rx, ry, rz - c.z0] as Vec3,
      measures: measuresAt(c, st.points),
      left: c.fullAxle ? wheelGeometry(c, st.points, c.groundZ2Of(st), st, 1) : undefined,
    };
  });
  const geo = new Map([...pairs].map(([v, p]) => [v, p.right]));
  // On a corner model the left wheel at rack +v is the mirror of the right wheel at rack -v.
  const leftAt = (v: number) => pairs.get(v)!.left ?? geo.get(-v)!;
  const g0 = geo.get(0) ?? wheelGeometry(c, c.solve({}).points, c.z0);
  // Each wheel's steer is measured from its own static toe: on a full axle the two can differ.
  const g0L = pairs.has(0) ? leftAt(0) : g0;
  const track = Math.abs(g0.tcp[1]) + Math.abs(g0L.tcp[1]);
  const L = p.wheelbase;
  return values.filter((v) => pairs.has(v) && pairs.has(-v)).map((v) => {
    const right = geo.get(v)!;
    const left = leftAt(v);
    const pr = pairs.get(v)!;
    const other = pairs.get(-v)!;
    // Toe-out on the right wheel means a turn to the right, so the right wheel is the inner one.
    const dR = right.toeSae - g0.toeSae;
    const dL = left.toeSae - g0L.toeSae;
    const rightInner = dR < 0;
    const inner = rightInner ? right : left;
    const outer = rightInner ? left : right;
    const steerInner = rightInner ? -dR : -dL;
    const steerOuter = rightInner ? dL : dR;
    let ackermann = NaN;
    let turningRadius = NaN;
    if (Math.abs(steerInner) > 1e-6) {
      const di = (steerInner * Math.PI) / 180;
      const ideal = Math.atan(1 / (1 / Math.tan(di) + track / L));
      ackermann = (100 * (di - (steerOuter * Math.PI) / 180)) / (di - ideal);
      turningRadius = L / Math.sin((steerOuter * Math.PI) / 180);
    }
    return {
      rack: v,
      measures: pr.measures,
      toeInner: inner.toeSae,
      toeOuter: outer.toeSae,
      camberInner: inner.camber,
      camberOuter: outer.camber,
      steerInner,
      steerOuter,
      ackermann,
      turningRadius,
      toePlane: right.toePlane,
      castor: right.castor,
      kingpin: right.kingpin,
      castorTrail: right.castorTrail,
      castorOffset: right.castorOffset,
      kingpinOffsetWheel: right.kingpinOffsetWheel,
      kingpinOffsetGround: right.kingpinOffsetGround,
      mechanicalTrail: right.mechanicalTrail,
      rollCentre: pr.rollCentre,
      ...wheelExtras(c, pr.st, pr.rs, second, { tcp: mirrorY(c.tcp(other.st.points)), hub: mirrorY(other.st.points[c.sides[0].wc]) }),
    };
  });
}

export interface StaticValues extends WheelGeometry {
  rollCentreHeight: number;
}

export function staticValues(c: Corner): StaticValues {
  const st = c.solve({});
  const rc = c.fullAxle ? c.rollCentreAxle(st)[1] : c.rollCentreBump(st, c.rates(st));
  return { ...wheelGeometry(c, st.points, st.groundZ, st), rollCentreHeight: rc - c.z0 };
}

export interface EndAnalysis {
  end: 'front' | 'rear';
  corner: Corner;
  statics: StaticValues;
  bump: BumpRow[];
  roll: RollRow[];
  steer: SteerRow[];
  /** The combined bump and steer path, when the model has a profile and the end is steerable. */
  combined: CombinedRow[];
  /** Labels of the bump rows when the extended bump list is in use (empty strings otherwise). */
  bumpLabels: string[];
}

/** Run the standard SHARK analysis (statics, bump, roll and steer sweeps) for every end of a model. */
export interface AnalyseOptions {
  /**
   * Run the analysis in compliant mode: every position is deflected under the spring preload and the active
   * force set, using the model's compliance data (or the defaults when it has none).
   */
  compliant?: boolean;
  /** Solver settings that are not part of the data file (such as moving ground or moving body). */
  solver?: Partial<SolverOptions>;
}

export function analyse(m: Model, opts: AnalyseOptions = {}): EndAnalysis[] {
  const out: EndAnalysis[] = [];
  for (const end of ['front', 'rear'] as const) {
    const data = m[end];
    if (!data) continue;
    const corner = new Corner(data, end, undefined, solverOptionsFor(m, opts.solver, end));
    const bump = bumpSteps(m.params, m.extendedBump);
    if (opts.compliant) makeCompliant(corner, m.compliance ?? defaultCompliance());
    const bumpRows = bumpSweep(corner, m.params, bump.values);
    out.push({
      end,
      corner,
      statics: staticValues(corner),
      bump: bumpRows,
      roll: rollSweep(corner, m.params),
      steer: steerSweep(corner, m.params),
      combined: m.combined && corner.mech.rackPoint !== undefined ? combinedSweep(corner, m.combined) : [],
      // Labels follow the rows that solved.
      bumpLabels: bump.values.flatMap((v, i) => (bumpRows.some((r) => r.bump === v) ? [bump.labels[i]] : [])),
    });
  }
  return out;
}


export interface AxleState {
  /** Right-hand corner. On a full-axle template this one state holds both wheels. */
  right: CornerState;
  /**
   * The left-hand corner, solved as its right-hand mirror image (mirror its points with mirrorY to draw it).
   * Absent on a full-axle template, where `right` already holds the left wheel.
   */
  leftMirror?: CornerState;
  geometryRight: WheelGeometry;
  geometryLeft: WheelGeometry;
  /** Kinematic roll centre in absolute coordinates (where the two contact-path normals meet). */
  rollCentre: Vec3;
}

/** Solve both corners of an axle at one articulation, for live display. */
export function solveAxle(c: Corner, a: { bump?: number; roll?: number; rack?: number }, warm?: { right?: number[]; left?: number[] }): AxleState {
  const bump = a.bump ?? 0;
  const roll = a.roll ?? 0;
  const rack = a.rack ?? 0;
  const right = c.solve({ bump, roll, rack }, warm?.right);
  if (c.fullAxle) {
    const [y, z] = c.rollCentreAxle(right);
    const tr = c.tcp(right.points, 0);
    const tl = c.tcp(right.points, 1);
    return {
      right,
      geometryRight: wheelGeometry(c, right.points, right.groundZ, right),
      geometryLeft: wheelGeometry(c, right.points, c.groundZ2Of(right), right, 1),
      rollCentre: [(tr[0] + tl[0]) / 2, y, z],
    };
  }
  const leftMirror = c.solve({ bump, roll: -roll, rack: -rack }, warm?.left);
  const rr = c.rates(right);
  const rl = c.rates(leftMirror);
  const tr = c.tcp(right.points);
  const tl = mirrorY(c.tcp(leftMirror.points));
  const [y, z] = intersectYZ(tr, [-rr.tcp[2], rr.tcp[1]], tl, [-rl.tcp[2], -rl.tcp[1]]);
  return {
    right,
    leftMirror,
    geometryRight: wheelGeometry(c, right.points, right.groundZ, right),
    geometryLeft: wheelGeometry(c, leftMirror.points, leftMirror.groundZ, leftMirror),
    rollCentre: [(tr[0] + tl[0]) / 2, y, z],
  };
}
