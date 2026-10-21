/**
 * Small template changes made from the Edit menu (SHARK's Add Point, Add to Model Spring/Damper): they return
 * a changed copy of the template, leaving the original alone.
 */
import type { Vec3 } from '../math/vec3.js';
import { normaliseTemplate } from './check.js';
import { dataPoints, GenType, NONE, GROUND, type Template, type TemplatePoint } from './types.js';

const copy = (t: Template): Template => JSON.parse(JSON.stringify(t));

/** Where a new point goes: its coordinates in the model, and the part it belongs to (GROUND for the body). */
export interface NewPoint {
  label: string;
  part: number;
  pos: Vec3;
}

export interface PointAdded {
  template: Template;
  /** The new point's number. */
  no: number;
  /** The model's points with the new one added at the end of the data points. */
  points: Vec3[];
}

/** Add a point to a part (or the body) of the template; `points` are the model's current hard points. */
export function addPointToTemplate(t: Template, points: Vec3[], np: NewPoint): PointAdded {
  if (np.part !== GROUND && !(np.part >= 1 && np.part <= t.parts.length)) throw new Error(`The template has no part ${np.part}.`);
  if (!np.pos.every(Number.isFinite)) throw new Error('The position is not a number.');
  const out = copy(t);
  const no = Math.max(0, ...out.points.map((p) => p.no)) + 1;
  const p: TemplatePoint = { no, label: np.label || `Point ${no}`, def: [...np.pos], part1: np.part, part2: NONE, gen1: GenType.None, gen2: GenType.None };
  const firstDummy = out.points.findIndex((q) => q.dummy);
  out.points.splice(firstDummy < 0 ? out.points.length : firstDummy, 0, p);
  return { template: normaliseTemplate(out), no, points: [...points.slice(0, dataPoints(t).length), [...np.pos] as Vec3] };
}

/** The point positions the model has for each data point number. */
export function pointPositions(t: Template, points: Vec3[]): Map<number, Vec3> {
  return new Map(dataPoints(t).map((p, i) => [p.no, points[i]]));
}

export type ElementKind = 'spring1' | 'spring2' | 'damper1' | 'damper2';

const PAIRS: Record<ElementKind, [GenType, GenType, string]> = {
  spring1: [GenType.Spring1ToBody, GenType.Spring1ToSuspension, 'Spring 1'],
  spring2: [GenType.Spring2ToBody, GenType.Spring2ToSuspension, 'Spring 2'],
  damper1: [GenType.Damper1ToBody, GenType.Damper1ToSuspension, 'Damper 1'],
  damper2: [GenType.Damper2ToBody, GenType.Damper2ToSuspension, 'Damper 2'],
};

/** Name of a spring or damper as shown in menus. */
export const elementName = (k: ElementKind): string => PAIRS[k][2];

/** True when the template already has this spring or damper. */
export const hasElement = (t: Template, kind: ElementKind): boolean =>
  t.points.some((p) => [p.gen1, p.gen2].some((g) => g === PAIRS[kind][0] || g === PAIRS[kind][1]));

/** Give two existing points the spring or damper roles (body end first). Throws when it is already there. */
export function addSpringDamper(t: Template, kind: ElementKind, bodyNo: number, suspNo: number): Template {
  const [bodyGen, suspGen, name] = PAIRS[kind];
  if (hasElement(t, kind))
    throw new Error(`${name} already exists in this template. Delete it first or change the point association in the template editor.`);
  if (bodyNo === suspNo) throw new Error('Pick two different points.');
  const out = copy(t);
  for (const [no, gen] of [[bodyNo, bodyGen], [suspNo, suspGen]] as const) {
    const p = out.points.find((q) => q.no === no && !q.dummy);
    if (!p) throw new Error(`Point ${no} is not in the template.`);
    if (p.gen1 === GenType.None) p.gen1 = gen;
    else if (p.gen2 === GenType.None) p.gen2 = gen;
    else throw new Error(`Point ${no} already has two roles; use the template editor.`);
  }
  return out;
}
