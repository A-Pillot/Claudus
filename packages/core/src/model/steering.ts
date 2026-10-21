/**
 * Steering type (Data / Steering Type and Edit Box Coords). A steering box adds three points: two on the
 * box axis and the pitman joint. The steering attachment point turns about the axis, and the steering travel
 * becomes the arm angle in degrees.
 *
 * SHARK's own file layout for the box points is not known, so Claudus keeps them in a CLAUDUS STEERING
 * section: one line per end with "front|rear 0|1" (1 is a box) and nine numbers (the three points).
 */
import type { Vec3 } from '../math/vec3.js';
import { GenType, findGen } from '../template/types.js';
import { getTemplate } from '../template/index.js';
import { dataPoints } from '../template/types.js';
import type { End, Model, SteeringData } from './types.js';

type Steering = NonNullable<Model['steering']>;

export function parseSteering(lines: string[] | undefined): Steering | undefined {
  if (!lines) return undefined;
  const out: Steering = {};
  for (const l of lines.filter((x) => x.trim() !== '')) {
    const w = l.trim().split(/\s+/);
    const n = w.slice(2).map(Number);
    if ((w[0] !== 'front' && w[0] !== 'rear') || (w[1] !== '0' && w[1] !== '1') || n.length !== 9 || n.some((v) => !Number.isFinite(v))) return undefined;
    out[w[0]] = { type: w[1] === '1' ? 'box' : 'rack', points: [[n[0], n[1], n[2]], [n[3], n[4], n[5]], [n[6], n[7], n[8]]] };
  }
  return out;
}

export const steeringLines = (s: Steering): string[] =>
  (['front', 'rear'] as const).filter((e) => s[e]).map((e) => `${e} ${s[e]!.type === 'box' ? 1 : 0} ${s[e]!.points.flat().join(' ')}`);

/** The steering attachment point of an end (the track rod inner end), when the template is steerable. */
function attachment(m: Model, end: End): Vec3 | undefined {
  const s = m[end];
  if (!s) return undefined;
  const t = m.templates?.find((x) => x.slot === s.templateSlot) ?? getTemplate(s.templateSlot);
  const p = findGen(t, GenType.SteeringAttachment);
  const i = p ? dataPoints(t).findIndex((d) => d.no === p.no) : -1;
  return i >= 0 ? s.points[i] : undefined;
}

/** Starting box points: an axis along X, 100 mm below the steering attachment, with the arm reaching up to it. */
export function defaultSteeringBox(m: Model, end: End): SteeringData['points'] {
  const a = attachment(m, end) ?? [0, 0, 0];
  return [[a[0] - 50, a[1], a[2] - 100], [a[0] + 50, a[1], a[2] - 100], [...a] as Vec3];
}

export const steeringOf = (m: Model, end: End): SteeringData => m.steering?.[end] ?? { type: 'rack', points: defaultSteeringBox(m, end) };

/** A model with one end's steering type changed. Changing to a box for the first time fills in default points. */
export function setSteeringType(m: Model, end: End, type: SteeringData['type']): Model {
  return { ...m, steering: { ...m.steering, [end]: { ...steeringOf(m, end), type } } };
}

/** A model with one end's box points replaced. */
export function setSteeringBox(m: Model, end: End, points: SteeringData['points']): Model {
  return { ...m, steering: { ...m.steering, [end]: { ...steeringOf(m, end), points } } };
}
