/**
 * Template checks for the template editor (SHARK's Data / Run Validation Test), plus the small edits the
 * editor makes when it saves a template.
 */
import type { Vec3 } from '../math/vec3.js';
import { Mechanism, wheelLowestZ, type Drive } from '../solver/mechanism.js';
import { GenType, GROUND, NONE, dataPoints, findGen, type Template, type TemplatePoint } from './types.js';
import { expandPoints } from './define.js';

/** Rank of a matrix by Gram-Schmidt on its rows. */
function rank(J: number[][]): number {
  const basis: number[][] = [];
  for (const row of J) {
    let v = [...row];
    for (const b of basis) {
      const d = v.reduce((s, x, i) => s + x * b[i], 0);
      v = v.map((x, i) => x - d * b[i]);
    }
    const n = Math.hypot(...v);
    if (n > 1e-6 * Math.max(1, Math.hypot(...row))) basis.push(v.map((x) => x / n));
  }
  return basis.length;
}

export interface Freedom {
  unknowns: number;
  equations: number;
  /** Independent motions with the wheels free to leave the ground: one per wheel for a working template. */
  free: number;
  /** Motions left once every tyre is on the ground: zero for a working template. */
  closed: number;
}

/** Count a mechanism's free motions at a position from the rank of its constraint Jacobian. */
export function mechanismFreedom(m: Mechanism, drive: Drive, x = m.initialX()): Freedom {
  const r0 = m.residuals(x, drive);
  const h = 1e-6;
  const J = r0.map(() => new Array(x.length).fill(0));
  for (let j = 0; j < x.length; j++) {
    const xp = [...x];
    xp[j] += h;
    const rp = m.residuals(xp, drive);
    for (let k = 0; k < r0.length; k++) J[k][j] = (rp[k] - r0[k]) / h;
  }
  const nWheels = m.wheels.length;
  return { unknowns: x.length, equations: r0.length, free: x.length - rank(J.slice(0, -nWheels)), closed: x.length - rank(J) };
}

export interface TemplateCheck {
  errors: string[];
  warnings: string[];
  freedom?: Freedom;
  wheels: number;
}

/**
 * Check a template's structure and that it moves as a suspension should: one free motion per wheel, which
 * the tyres on the ground then fix. `points` defaults to the template's own default coordinates.
 */
export function checkTemplate(t: Template, points?: Vec3[], rollingRadius = 300): TemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nParts = t.parts.length;
  const seen = new Set<number>();
  const label = (p: TemplatePoint) => `Point ${p.no} (${p.label})`;

  if (!Number.isInteger(t.slot) || t.slot < 1) errors.push('The template number must be a whole number from 1 up.');
  if (!t.label.trim()) warnings.push('The template has no label.');
  if (nParts === 0) errors.push('The template has no parts.');
  t.parts.forEach((p, i) => { if (!p.trim()) warnings.push(`Part ${i + 1} has no label.`); });

  for (const p of t.points) {
    if (!Number.isInteger(p.no) || p.no < 1) errors.push(`${label(p)}: point numbers must be whole numbers from 1 up.`);
    if (seen.has(p.no)) errors.push(`Point number ${p.no} is used twice.`);
    seen.add(p.no);
    const okPart = (x: number) => x === GROUND || (x >= 1 && x <= nParts);
    if (p.part1 === NONE) errors.push(`${label(p)} is not on any part.`);
    else if (!okPart(p.part1)) errors.push(`${label(p)}: part ${p.part1} does not exist.`);
    if (p.part2 !== NONE && !okPart(p.part2)) errors.push(`${label(p)}: part ${p.part2} does not exist.`);
    if (p.part1 === p.part2 && p.part1 !== NONE) errors.push(`${label(p)} lists the same part twice.`);
    if (p.part1 === GROUND && (p.part2 === NONE || p.part2 === GROUND) && !p.gen1 && !p.gen2) warnings.push(`${label(p)} is only on the body, so it does nothing.`);
    if (!p.def.every(Number.isFinite)) errors.push(`${label(p)} has a missing coordinate.`);
  }

  // Dummy points must refer to points defined before them, as their positions are worked out in order.
  const before = new Set<number>();
  for (const p of t.points) {
    if (p.dummy) {
      const refs = [p.dummy.at, ...(p.dummy.dir ?? [])];
      for (const r of refs) if (!before.has(r)) errors.push(`${label(p)} is placed from point ${r}, which must be defined before it.`);
      if (!p.dummy.dir && !(p.dummy.vec && Math.hypot(...p.dummy.vec) > 0)) errors.push(`${label(p)} needs a direction.`);
    }
    before.add(p.no);
  }

  for (let k = 1; k <= nParts; k++) {
    const n = t.points.filter((p) => p.part1 === k || p.part2 === k).length;
    if (n < 2) errors.push(`Part ${k} (${t.parts[k - 1]}) has ${n === 0 ? 'no points' : 'only one point'}: every part needs at least two.`);
  }

  if (!findGen(t, GenType.WheelCentre)) errors.push('No point is tagged as the wheel centre (general type 1).');
  if (!findGen(t, GenType.StubAxle)) errors.push('No point is tagged as the stub axle (general type 2).');
  const pairs: [GenType, GenType, string][] = [
    [GenType.Damper1ToSuspension, GenType.Damper1ToBody, 'damper 1'],
    [GenType.Spring1ToSuspension, GenType.Spring1ToBody, 'spring 1'],
    [GenType.Damper2ToSuspension, GenType.Damper2ToBody, 'damper 2'],
    [GenType.Spring2ToSuspension, GenType.Spring2ToBody, 'spring 2'],
    [GenType.UpperBallJoint, GenType.LowerBallJoint, 'steering axis ball joints'],
  ];
  for (const [a, b, what] of pairs)
    if (!findGen(t, a) !== !findGen(t, b)) warnings.push(`Only one end of the ${what} is tagged, so it will be ignored.`);
  if (findGen(t, GenType.WheelCentre2) && !t.fullAxle) warnings.push('A second wheel centre makes this a full-axle template.');

  const known = new Set(t.points.map((p) => p.no));
  t.graphics.forEach((g, i) => {
    const missing = g.points.filter((no) => !known.has(no));
    if (missing.length) warnings.push(`Graphic element ${i + 1} refers to missing point ${missing.join(', ')}.`);
  });

  const wheels = findGen(t, GenType.WheelCentre2) ? 2 : 1;
  if (errors.length) return { errors, warnings, wheels };

  try {
    const pts = expandPoints(t, points ?? dataPoints(t).map((p) => p.def));
    const m = new Mechanism(t, pts, rollingRadius);
    const low = (k: number) => wheelLowestZ(pts[m.wheels[k].wc], pts[m.wheels[k].stub], rollingRadius);
    const f = mechanismFreedom(m, { groundZ: low(0), groundZ2: m.wheels[1] ? low(1) : undefined });
    if (f.free > wheels)
      errors.push(`Some part can move without moving the wheel (${f.free - wheels} extra free motion${f.free - wheels > 1 ? 's' : ''}). Add a joint or a link to hold it.`);
    else if (f.free < wheels)
      errors.push(`The suspension is locked: it has ${f.free} free motion${f.free === 1 ? '' : 's'} where it needs ${wheels}. Check for a part fixed to the body or a joint too many.`);
    else if (f.closed > 0) errors.push('The wheel can move without its tyre leaving the ground. Check the wheel centre and stub axle points.');
    return { errors, warnings, wheels, freedom: f };
  } catch (e) {
    errors.push((e as Error).message);
    return { errors, warnings, wheels };
  }
}

/**
 * Tidy a template the way the editor's auto fill does: dummy points after data points, bushes numbered at
 * every joint, and the full-axle flag set from the wheel centres.
 */
export function normaliseTemplate(t: Template): Template {
  const ordered = [...t.points.filter((p) => !p.dummy), ...t.points.filter((p) => p.dummy)];
  let bush = 0;
  const points = ordered.map((p) => {
    // A moving part goes in the first column, the body in the second.
    let [part1, part2] = [p.part1, p.part2];
    if (part1 === GROUND && part2 !== NONE) [part1, part2] = [part2, part1];
    return { ...p, part1, part2, bush: part2 !== NONE ? ++bush : 0 };
  });
  const full = findGen(t, GenType.WheelCentre2) !== undefined;
  const out: Template = { ...t, points };
  if (full) out.fullAxle = true;
  else delete out.fullAxle;
  return out;
}

/** Carry a model's points across a template change, matching them by point number. New points get defaults. */
export function remapPoints(from: Template, to: Template, points: Vec3[]): Vec3[] {
  const old = new Map(dataPoints(from).map((p, i) => [p.no, points[i]]));
  return dataPoints(to).map((p) => [...(old.get(p.no) ?? p.def)] as Vec3);
}
