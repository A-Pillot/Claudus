/**
 * Saved hard point sets and ends from other files.
 *
 * Data / Coordinates / Save, Recall Saved, Delete Saved and Delete All keep named copies of the hard points
 * in a temporary store that lives as long as the program is open. File / Add End from File brings the other
 * suspension end in from a saved model.
 */
import type { Vec3 } from '../math/vec3.js';
import type { End, Model } from './types.js';

export class CoordSetError extends Error {}

/** A saved copy of the hard points of whichever ends the model had, with the template each belonged to. */
export interface CoordSet {
  label: string;
  front?: { templateSlot: number; points: Vec3[] };
  rear?: { templateSlot: number; points: Vec3[] };
}

const copy = (m: Model, e: End) => (m[e] ? { templateSlot: m[e]!.templateSlot, points: m[e]!.points.map((p) => [...p] as Vec3) } : undefined);

/** Save the current points under a label, replacing a set with the same label. */
export function saveCoordSet(store: CoordSet[], label: string, m: Model): CoordSet[] {
  const name = label.trim();
  if (!name) throw new CoordSetError('A saved set needs a label');
  return [...store.filter((s) => s.label !== name), { label: name, front: copy(m, 'front'), rear: copy(m, 'rear') }];
}

/** Put a saved set's points back. Only ends that still use the same template and point count are restored. */
export function recallCoordSet(store: CoordSet[], label: string, m: Model): Model {
  const s = store.find((x) => x.label === label);
  if (!s) throw new CoordSetError(`There is no saved set called "${label}"`);
  let out = m;
  let restored = 0;
  for (const e of ['front', 'rear'] as End[]) {
    const saved = s[e];
    const data = out[e];
    if (!saved || !data) continue;
    if (saved.templateSlot !== data.templateSlot || saved.points.length !== data.points.length) continue;
    out = { ...out, [e]: { ...data, points: saved.points.map((p) => [...p] as Vec3) } };
    restored++;
  }
  if (!restored) throw new CoordSetError(`"${label}" was saved from a different suspension type, so it cannot be recalled here`);
  return out;
}

export const deleteCoordSet = (store: CoordSet[], label: string): CoordSet[] => store.filter((s) => s.label !== label);

/**
 * File / Add End from File: take the missing end from another model. Only available when the model has
 * exactly one end. The source's matching end is used, or its only end when it has just one.
 */
export function addEndFromModel(m: Model, other: Model): { model: Model; end: End } {
  if (m.front && m.rear) throw new CoordSetError('This model already has both ends');
  if (!m.front && !m.rear) throw new CoordSetError('This model has no suspension to add an end to');
  const end: End = m.front ? 'rear' : 'front';
  const srcEnd: End | undefined = other[end] ? end : other.front && !other.rear ? 'front' : other.rear && !other.front ? 'rear' : undefined;
  const src = srcEnd && other[srcEnd];
  if (!srcEnd || !src) throw new CoordSetError(`The file has no ${end} suspension to add`);
  const templates = [...(m.templates ?? [])];
  for (const t of other.templates ?? []) if (!templates.some((x) => x.slot === t.slot)) templates.push(t);
  const section = end === 'front' ? 'FRONT SUSPENSION' : 'REAR SUSPENSION';
  const model: Model = {
    ...m,
    [end]: { ...src, points: src.points.map((p) => [...p] as Vec3) },
    params: {
      ...m.params,
      [`${end}SuspensionType`]: other.params[`${srcEnd}SuspensionType` as 'frontSuspensionType'],
      [`${end}BrakeType`]: other.params[`${srcEnd}BrakeType` as 'frontBrakeType'],
    },
    ...(templates.length ? { templates } : {}),
    sectionOrder: m.sectionOrder.includes(section) ? m.sectionOrder : [...m.sectionOrder.slice(0, 2), section, ...m.sectionOrder.slice(2)],
  };
  return { model, end };
}
