/**
 * SHARK's internal optimiser: a sensitivity-based search that changes chosen parameters (point
 * coordinates, bush stiffnesses, bush orientations) to bring the kinematic sum down.
 *
 * Each round measures how much the sum changes when each parameter moves by its increment, drops the
 * parameters whose effect is below the sensitivity threshold, then applies the rest in reverse
 * sensitivity order (the most sensitive last): each one steps by its increment in whichever direction
 * lowers the sum, for as long as the sum keeps falling and the value stays in its range. After each round
 * the combined change is tried again as a whole (a Hooke-Jeeves pattern move), which follows valleys that
 * run across several parameters; when a round finds nothing, the increments are halved.
 */
import { rad, rotateAbout, type Vec3 } from '../math/vec3.js';
import type { End, Model } from '../model/types.js';
import { getTemplate } from '../template/registry.js';
import { dataPoints, type Template } from '../template/types.js';
import { defaultBush, defaultCompliance, defaultEndCompliance } from '../compliance/types.js';
import { kinematicSum, type KinematicSum, type SumOptions, type SumTarget } from './sum.js';
import type { UserLine } from './lines.js';

export type OptimiserParameter =
  | { kind: 'point'; end: End; point: number; axis: 0 | 1 | 2; range: number; increment: number; on: boolean }
  | { kind: 'bushStiffness'; end: End; point: number; component: 0 | 1 | 2 | 3 | 4 | 5; range: number; increment: number; on: boolean }
  /** Turns the bush's local z axis about a global axis (deg). */
  | { kind: 'bushOrientation'; end: End; point: number; axis: 0 | 1 | 2; range: number; increment: number; on: boolean };

export interface OptimiserSettings {
  /** Parameters whose sum change per increment is below this fraction of the sum are screened out. */
  threshold: number;
  maxIterations: number;
  /** How many times the increments may be halved once a round stops improving. */
  refinements: number;
}

export const defaultOptimiserSettings = (): OptimiserSettings => ({ threshold: 0.001, maxIterations: 30, refinements: 4 });

function templateOf(m: Model, end: End): Template | undefined {
  const s = m[end];
  if (!s) return undefined;
  return m.templates?.find((t) => t.slot === s.templateSlot) ?? getTemplate(s.templateSlot);
}

const pointIndex = (m: Model, end: End, no: number) => {
  const t = templateOf(m, end);
  return t ? dataPoints(t).findIndex((p) => p.no === no) : -1;
};

/** The parameter's current value: mm, N/mm (N.m/rad for rotations) or deg from the starting orientation. */
export function parameterValue(m: Model, p: OptimiserParameter): number {
  if (p.kind === 'point') {
    const i = pointIndex(m, p.end, p.point);
    return i >= 0 ? m[p.end]!.points[i][p.axis] : NaN;
  }
  const bush = m.compliance?.[p.end]?.bushes.find((b) => b.point === p.point);
  if (p.kind === 'bushStiffness') return bush ? bush.stiffness[p.component] : defaultBush(p.point).stiffness[p.component];
  // Orientation is measured as the turn from where the optimiser started.
  return 0;
}

/** A copy of the model with the parameter changed to a value (for orientation, turned by the value in deg). */
export function withParameter(m: Model, p: OptimiserParameter, value: number): Model {
  if (p.kind === 'point') {
    const i = pointIndex(m, p.end, p.point);
    const s = m[p.end];
    if (i < 0 || !s) return m;
    const points = s.points.map((q) => [...q] as Vec3);
    points[i][p.axis] = value;
    return { ...m, [p.end]: { ...s, points } };
  }
  const compliance = structuredClone(m.compliance ?? defaultCompliance());
  const e = (compliance[p.end] ??= defaultEndCompliance());
  let bush = e.bushes.find((b) => b.point === p.point);
  if (!bush) {
    bush = defaultBush(p.point);
    e.bushes.push(bush);
  }
  if (p.kind === 'bushStiffness') bush.stiffness[p.component] = value;
  else {
    // Turn a relative or absolute z-axis definition; a bush on global axes starts from +Z.
    const axis: Vec3 = [0, 0, 0];
    axis[p.axis] = 1;
    const z = bush.zAxis;
    const v: Vec3 = z.kind === 'rel' ? z.v : [0, 0, 100];
    if (z.kind === 'none' || z.kind === 'rel') bush.zAxis = { kind: 'rel', v: rotateAbout(v, [0, 0, 0], axis, rad(value)) };
  }
  return { ...m, compliance };
}

export interface ParameterState {
  parameter: OptimiserParameter;
  start: number;
  value: number;
  /** Change in the sum for one increment (the better direction), at the last sensitivity pass. */
  sensitivity: number;
  screened: boolean;
}

export type OptimiserEvent =
  | { type: 'start'; sum: KinematicSum }
  | { type: 'sensitivity'; iteration: number; parameters: ParameterState[] }
  /** One accepted change: a parameter (by index) to a value, or parameter -1 for a pattern move. */
  | { type: 'step'; iteration: number; parameter: number; value: number; sum: number; /** Every parameter's value after this step. */ values: number[] }
  | { type: 'done'; model: Model; sum: KinematicSum; iterations: number; parameters: ParameterState[] };

export interface OptimiserProblem {
  model: Model;
  targets: SumTarget[];
  lines: UserLine[];
  parameters: OptimiserParameter[];
  settings?: OptimiserSettings;
  sumOptions?: SumOptions;
}

/**
 * Run the optimiser as a generator, so a caller can show the rolling sum and stop it between steps.
 * The model passed in is never changed; the result is in the final 'done' event.
 */
export function* optimise(problem: OptimiserProblem): Generator<OptimiserEvent, void, void> {
  const settings = problem.settings ?? defaultOptimiserSettings();
  let model = problem.model;
  const first = kinematicSum(model, problem.targets, problem.lines, problem.sumOptions);
  const sumOf = (m: Model) => {
    try {
      const k = kinematicSum(m, problem.targets, problem.lines, problem.sumOptions);
      // A trial that loses sweep positions the start could solve has fewer rows to deviate: never better.
      if (k.unsolved > first.unsolved) return Infinity;
      return Number.isFinite(k.total) ? k.total : Infinity;
    } catch {
      return Infinity;
    }
  };
  yield { type: 'start', sum: first };
  let sum = first.total;
  const states: ParameterState[] = problem.parameters.map((p) => {
    const v = parameterValue(model, p);
    return { parameter: p, start: v, value: v, sensitivity: 0, screened: !p.on };
  });
  const inRange = (s: ParameterState, v: number) => {
    const base = s.parameter.kind === 'bushOrientation' ? 0 : s.start;
    return Math.abs(v - base) <= s.parameter.range + 1e-9 && (s.parameter.kind !== 'bushStiffness' || v >= 0);
  };

  // Orientation turns are applied relative to the current model; other parameters are set absolutely.
  let scaleInc = 1;
  let refinements = 0;
  const incOf = (s: ParameterState) => s.parameter.increment * scaleInc;
  const shifted = (s: ParameterState, delta: number, from = model) =>
    withParameter(from, s.parameter, s.parameter.kind === 'bushOrientation' ? delta : s.value + delta);

  let iterations = 0;
  for (let it = 1; it <= settings.maxIterations; it++) {
    iterations = it;
    const before = sum;
    const valuesBefore = states.map((s) => s.value);
    // Sensitivity pass.
    for (const s of states) {
      if (!s.parameter.on || !(s.parameter.increment > 0)) {
        s.screened = true;
        continue;
      }
      const inc = incOf(s);
      const up = inRange(s, s.value + inc) ? sumOf(shifted(s, inc)) : Infinity;
      const down = inRange(s, s.value - inc) ? sumOf(shifted(s, -inc)) : Infinity;
      s.sensitivity = Math.max(Number.isFinite(up) ? sum - up : 0, Number.isFinite(down) ? sum - down : 0);
      s.screened = s.sensitivity <= settings.threshold * Math.max(sum, 1e-12);
    }
    yield { type: 'sensitivity', iteration: it, parameters: states.map((s) => ({ ...s })) };

    const order = states.map((s, i) => i).filter((i) => !states[i].screened).sort((a, b) => states[a].sensitivity - states[b].sensitivity);
    for (const i of order) {
      const s = states[i];
      const inc = incOf(s);
      for (const dir of [1, -1]) {
        let moved = false;
        for (;;) {
          const v = s.value + dir * inc;
          if (!inRange(s, v)) break;
          const trial = shifted(s, dir * inc);
          const t = sumOf(trial);
          if (!(t < sum - 1e-12)) break;
          model = trial;
          sum = t;
          s.value = v;
          moved = true;
          yield { type: 'step', iteration: it, parameter: i, value: v, sum, values: states.map((q) => q.value) };
        }
        if (moved) break;
      }
    }
    // Pattern move: repeat the whole round's change while it keeps helping.
    const delta = states.map((s, i) => s.value - valuesBefore[i]);
    if (sum < before - 1e-12 && delta.some((d) => d !== 0)) {
      for (;;) {
        if (!states.every((s, i) => inRange(s, s.value + delta[i]))) break;
        let trial = model;
        states.forEach((s, i) => {
          if (delta[i] !== 0) trial = shifted(s, delta[i], trial);
        });
        const t = sumOf(trial);
        if (!(t < sum - 1e-12)) break;
        model = trial;
        sum = t;
        states.forEach((s, i) => (s.value += delta[i]));
        yield { type: 'step', iteration: it, parameter: -1, value: 0, sum, values: states.map((q) => q.value) };
      }
    }
    if (!(sum < before - 1e-12)) {
      if (refinements >= settings.refinements) break;
      refinements++;
      scaleInc /= 2;
    }
  }
  yield { type: 'done', model, sum: kinematicSum(model, problem.targets, problem.lines, problem.sumOptions), iterations, parameters: states };
}

/** Run the optimiser to the end and return its final event. */
export function runOptimiser(problem: OptimiserProblem): Extract<OptimiserEvent, { type: 'done' }> {
  let last: OptimiserEvent | undefined;
  for (const e of optimise(problem)) last = e;
  return last as Extract<OptimiserEvent, { type: 'done' }>;
}
