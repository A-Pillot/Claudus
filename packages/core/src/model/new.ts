import { getTemplate, BUILTIN_ROLLING_RADIUS } from '../template/index.js';
import { defaultParams, type End, type Model, type SuspensionData } from './types.js';

/** A suspension end filled with the template's default hard points. */
export function newSuspension(slot: number): SuspensionData {
  const t = getTemplate(slot);
  return { templateSlot: slot, points: t.points.map((p) => [...p.def]), rollingRadius: BUILTIN_ROLLING_RADIUS[slot] ?? 225 };
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
