/**
 * SHARK's Solve / Set Ride Height utilities. Each one moves a model to a new static position and makes that
 * the model's design position: the hard points are replaced by the solved points.
 *
 * - Bump: a bump change at both ends. Positive lowers the body.
 * - Bump + Pitch: as Bump, plus a pitch angle. Positive pitch rotates the body down at the rear. A full
 *   vehicle pitches about the front wheel centre axis, a single end about its own wheel centre.
 * - Adjust Springs: change the spring fitted lengths so the springs carry the given weight. Points do not move.
 * - Match to Springs: move the body until the springs, as they are, carry the given weight.
 * - Match to Weight Change: move the body by the change in spring load between two weights.
 *
 * The weight the springs carry is the vehicle mass times the end's share (SHARK's dialog calls it the
 * unsprung mass), split equally between the two wheels. Spring loads are taken to the wheel by virtual work,
 * using the kinematic change in spring length with bump, so only springs 1 and 2 carry load.
 *
 * Whenever the points move, each spring's fitted length moves with its new length, so its preload follows
 * the geometry and the free length stays the same.
 */
import { dist, rotateAbout, type Vec3 } from '../math/vec3.js';
import { Corner } from '../solver/corner.js';
import { getTemplate } from '../template/index.js';
import { GenType, findGen } from '../template/types.js';
import { defaultCompliance, defaultEndCompliance, type ComplianceData, type EndCompliance } from '../compliance/types.js';
import type { End, Model, SuspensionData } from './types.js';

export const GRAVITY = 9.81;

const ENDS: End[] = ['front', 'rear'];
const ends = (m: Model) => ENDS.filter((e) => m[e]);

const templateOf = (m: Model, s: SuspensionData) => m.templates?.find((t) => t.slot === s.templateSlot) ?? getTemplate(s.templateSlot);
const cornerOf = (m: Model, end: End) => new Corner(m[end]!, end, templateOf(m, m[end]!));

/** Template indexes of springs 1 and 2 (suspension end, body end), where the template has them. */
function springIndexes(c: Corner): ([number, number] | undefined)[] {
  const pair = (s: GenType, b: GenType): [number, number] | undefined => {
    const sp = findGen(c.template, s);
    const bp = findGen(c.template, b);
    return sp && bp ? [c.mech.index.get(sp.no)!, c.mech.index.get(bp.no)!] : undefined;
  };
  return [pair(GenType.Spring1ToSuspension, GenType.Spring1ToBody), pair(GenType.Spring2ToSuspension, GenType.Spring2ToBody)];
}

/** Each spring's length at a bump position, NaN where there is no spring. */
function springLengths(c: Corner, bump: number): number[] {
  const st = c.solve({ bump });
  return springIndexes(c).map((p) => (p ? dist(st.points[p[0]], st.points[p[1]]) : NaN));
}

/** The vertical load the springs put on the wheels (all wheels of the end the model holds), N. */
export function springWheelLoad(c: Corner, e: EndCompliance, bump: number, h = 0.5): number {
  const L0 = springLengths(c, 0);
  const L = springLengths(c, bump);
  const up = springLengths(c, bump + h);
  const dn = springLengths(c, bump - h);
  let load = 0;
  e.springs.forEach((s, k) => {
    if (!Number.isFinite(L[k]) || !s.rate) return;
    const compression = s.freeLength - s.fittedLength + (L0[k] - L[k]);
    const ratio = -(up[k] - dn[k]) / (2 * h); // spring compression per mm of bump
    load += s.rate * compression * ratio;
  });
  return load;
}

/** The weight one end's springs must carry, N. */
export function endLoad(c: Corner, end: End, mass: number, frontPct: number): number {
  const share = end === 'front' ? frontPct / 100 : 1 - frontPct / 100;
  return (mass * GRAVITY * share * c.mech.wheels.length) / 2;
}

const complianceOf = (m: Model): ComplianceData => m.compliance ?? defaultCompliance();
/** The model with compliance data for every end it holds, so the spring data used is saved with it. */
const withSprings = (m: Model): Model => {
  const data = structuredClone(complianceOf(m));
  for (const end of ends(m)) data[end] ??= defaultEndCompliance();
  return { ...m, compliance: data };
};
const endData = (m: Model, end: End): EndCompliance => complianceOf(m)[end] ?? defaultEndCompliance();

/** Move one end by a bump (and a body rotation already applied to its points), keeping spring state. */
function moveEnd(m: Model, end: End, points: Vec3[], groundZ: number, bump: number, data: ComplianceData): SuspensionData {
  const s = m[end]!;
  const before = cornerOf(m, end);
  const L0 = springLengths(before, 0);
  const moved: SuspensionData = { ...s, points };
  const c = new Corner(moved, end, templateOf(m, s));
  const st = c.solve({ bump: groundZ - c.z0 + bump });
  const t = c.template;
  const out = st.points.filter((_, i) => !t.points[i].dummy).map((p) => [...p] as Vec3);
  const after = springIndexes(c).map((p) => (p ? dist(st.points[p[0]], st.points[p[1]]) : NaN));
  const e = data[end];
  if (e)
    e.springs = e.springs.map((sp, k) => (Number.isFinite(L0[k]) && Number.isFinite(after[k]) ? { ...sp, fittedLength: sp.fittedLength + (after[k] - L0[k]) } : sp)) as EndCompliance['springs'];
  return { ...moved, points: out };
}

/** Front wheel centre (x, z) for pitching a full vehicle, or the end's own for a single end model. */
function pitchOrigin(m: Model): Vec3 {
  const end = m.front ? 'front' : 'rear';
  const c = cornerOf(m, end);
  return c.mech.staticPoints[c.mech.wheels[0].wc];
}

/** Set Ride Height - Bump + Pitch (Bump alone is pitch 0). Returns a new model. */
export function setRideHeight(m: Model, bump: number, pitch = 0): Model {
  const data = structuredClone(complianceOf(m));
  const origin = pitchOrigin(m);
  const out: Model = { ...m };
  for (const end of ends(m)) {
    const s = m[end]!;
    const ground = cornerOf(m, end).z0;
    // Positive pitch lowers the rear: a rotation about +Y moves points behind the origin (larger x) down.
    const pts = pitch ? s.points.map((p) => rotateAbout(p, origin, [0, 1, 0], (pitch * Math.PI) / 180)) : s.points;
    out[end] = moveEnd(m, end, pts, ground, bump, data);
  }
  if (m.compliance) out.compliance = data;
  return out;
}

/** Set Ride Height - Adjust Springs: fitted lengths that make the springs carry the weight. Returns a new model. */
export function adjustSprings(m: Model, mass: number, frontPct: number): Model {
  const data = structuredClone(complianceOf(m));
  for (const end of ends(m)) {
    const c = cornerOf(m, end);
    const e = (data[end] ??= defaultEndCompliance());
    const target = endLoad(c, end, mass, frontPct);
    // Shortening every fitted length by d adds rate * d * ratio of load per spring.
    const h = 0.5;
    const up = springLengths(c, h);
    const dn = springLengths(c, -h);
    const perMm = e.springs.reduce((a, s, k) => (Number.isFinite(up[k]) && s.rate ? a + s.rate * (-(up[k] - dn[k]) / (2 * h)) : a), 0);
    if (!(Math.abs(perMm) > 1e-9)) throw new Error(`The ${end} suspension has no spring to adjust`);
    const d = (target - springWheelLoad(c, e, 0)) / perMm;
    e.springs = e.springs.map((s, k) => (Number.isFinite(up[k]) && s.rate ? { ...s, fittedLength: s.fittedLength - d } : s)) as EndCompliance['springs'];
  }
  return { ...m, compliance: data };
}

/** Bump at each end where the springs carry `target(end)` N more than `base(end)`. */
function balanceBumps(m: Model, target: (c: Corner, end: End) => number): Partial<Record<End, number>> {
  const out: Partial<Record<End, number>> = {};
  for (const end of ends(m)) {
    const c = cornerOf(m, end);
    const e = endData(m, end);
    const want = target(c, end);
    const f = (b: number) => springWheelLoad(c, e, b) - want;
    // Secant from the linear guess.
    let b0 = 0;
    let f0 = f(b0);
    let b1 = 5;
    let f1 = f(b1);
    for (let it = 0; it < 30 && Math.abs(f1) > 1e-3; it++) {
      if (f1 === f0) throw new Error(`The ${end} springs carry no load with bump`);
      const b2 = b1 - (f1 * (b1 - b0)) / (f1 - f0);
      [b0, f0] = [b1, f1];
      b1 = b2;
      f1 = f(b1);
    }
    if (!Number.isFinite(b1) || Math.abs(f1) > 1) throw new Error(`No ride height balances the ${end} springs`);
    out[end] = b1;
  }
  return out;
}

/** Apply per-end bumps as a bump plus pitch (a full vehicle) or a bump (a single end). */
function applyBumps(m: Model, bumps: Partial<Record<End, number>>): Model {
  if (m.front && m.rear) {
    const rear = cornerOf(m, 'rear');
    const L = rear.mech.staticPoints[rear.mech.wheels[0].wc][0] - pitchOrigin(m)[0];
    if (Math.abs(L) < 1) throw new Error('The front and rear wheel centres are at the same X, so the model cannot pitch');
    const pitch = (Math.atan((bumps.rear! - bumps.front!) / L) * 180) / Math.PI;
    return setRideHeight(m, bumps.front!, pitch);
  }
  return setRideHeight(m, bumps.front ?? bumps.rear ?? 0);
}

/** Set Ride Height - Match to Springs: move the body so the springs carry the weight. Returns a new model. */
export function matchToSprings(m: Model, mass: number, frontPct: number): Model {
  let out = withSprings(m);
  // Pitching a full vehicle tilts the wheels a little, so repeat until the residual bump is small.
  for (let it = 0; it < 4; it++) {
    const b = balanceBumps(out, (c, end) => endLoad(c, end, mass, frontPct));
    out = applyBumps(out, b);
    if (Object.values(b).every((v) => Math.abs(v!) < 0.01)) break;
  }
  return out;
}

/**
 * Set Ride Height - Match to Weight Change: move the body by the change in spring load from one weight
 * condition to another. The starting position need not balance the springs.
 */
export function matchToWeightChange(m: Model, from: { mass: number; frontPct: number }, to: { mass: number; frontPct: number }): Model {
  m = withSprings(m);
  const base = Object.fromEntries(ends(m).map((end) => [end, springWheelLoad(cornerOf(m, end), endData(m, end), 0)])) as Partial<Record<End, number>>;
  const b = balanceBumps(m, (c, end) => base[end]! + endLoad(c, end, to.mass, to.frontPct) - endLoad(c, end, from.mass, from.frontPct));
  return applyBumps(m, b);
}
