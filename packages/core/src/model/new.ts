import { getTemplate, hasTemplate, BUILTIN_ROLLING_RADIUS } from '../template/index.js';
import { dataPoints } from '../template/types.js';
import { defaultParams, type End, type Model, type SuspensionData } from './types.js';

/** A suspension end filled with the template's default hard points. */
export function newSuspension(slot: number): SuspensionData {
  const t = getTemplate(slot);
  return { templateSlot: slot, points: dataPoints(t).map((p) => [...p.def]), rollingRadius: BUILTIN_ROLLING_RADIUS[slot] ?? 225 };
}

/** A new model with one end set to a built-in template's defaults, like SHARK's File / New. */
export function newModel(slot: number, end: End = 'front'): Model {
  return {
    version: [8, 3],
    versionExtra: [],
    params: defaultParams(),
    [end]: newSuspension(slot),
    tolerances: [1e-10, 0.05, 0.05],
    titles: [],
    tyreWidths: [150, 150, 150, 150],
    rollSolution: 1,
    groups: [],
    sectionOrder: ['VERSION', 'PARAMETERS', end === 'front' ? 'FRONT SUSPENSION' : 'REAR SUSPENSION', 'TOLERANCES', 'TITLES', 'TYRE', 'ROLL SOLUTION'],
    raw: [],
  };
}

/**
 * Fill in points an older file left out (with the template's defaults), so every data point can be edited.
 * Returns the same object when nothing is missing or the template is unknown.
 */
export function completeSuspension(s: SuspensionData): SuspensionData {
  if (!hasTemplate(s.templateSlot)) return s;
  const pts = dataPoints(getTemplate(s.templateSlot));
  if (s.points.length >= pts.length) return s;
  return { ...s, points: pts.map((p, i) => s.points[i] ?? [...p.def]) };
}

/** completeSuspension applied to both ends of a model. */
export function completeModel(m: Model): Model {
  const front = m.front && completeSuspension(m.front);
  const rear = m.rear && completeSuspension(m.rear);
  return front === m.front && rear === m.rear ? m : { ...m, front, rear };
}
