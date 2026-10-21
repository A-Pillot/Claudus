/**
 * Point groups (SHARK's SetUp / Groups): named sets of hard points that move together when one is joggled or
 * dragged. A group belongs to one suspension end. Group members are stored the way the .dat file keeps them:
 * a 1-based point number and an end number (1 front, 2 rear).
 *
 * Every function returns a new model and leaves the old one alone.
 */
import type { Vec3 } from '../math/vec3.js';
import type { End, Model, PointGroup } from './types.js';

export class GroupError extends Error {}

export const endNumber = (e: End): number => (e === 'front' ? 1 : 2);
export const endOfNumber = (n: number): End => (n === 2 ? 'rear' : 'front');

/** The end a group belongs to (a group's points all sit on one end). */
export const groupEnd = (g: PointGroup): End => endOfNumber(g.members[0]?.end ?? 1);

/** The groups of one end. */
export const groupsOfEnd = (m: Model, end: End): PointGroup[] => m.groups.filter((g) => g.members.length === 0 || groupEnd(g) === end);

/** A group's points as 0-based indexes into its end's point list. */
export const groupIndexes = (g: PointGroup): number[] => g.members.map((x) => x.point - 1);

function checkPoints(m: Model, end: End, indexes: number[]): void {
  const data = m[end];
  if (!data) throw new GroupError(`The model has no ${end} suspension`);
  if (indexes.length === 0) throw new GroupError('A group needs at least one point');
  for (const i of indexes) if (!Number.isInteger(i) || i < 0 || i >= data.points.length) throw new GroupError(`Point ${i + 1} does not exist on the ${end} suspension`);
}

const membersOf = (end: End, indexes: number[]) =>
  [...new Set(indexes)].sort((a, b) => a - b).map((i) => ({ point: i + 1, end: endNumber(end) }));

/** Make a new group from 0-based point indexes. The label must be new. */
export function createGroup(m: Model, label: string, end: End, indexes: number[]): Model {
  const name = label.trim();
  if (!name) throw new GroupError('A group needs a label');
  if (m.groups.some((g) => g.label === name)) throw new GroupError(`A group called "${name}" already exists`);
  checkPoints(m, end, indexes);
  return { ...m, groups: [...m.groups, { label: name, members: membersOf(end, indexes) }] };
}

/** Change a group's points and/or label (SetUp / Groups / Edit). */
export function editGroup(m: Model, label: string, change: { label?: string; end?: End; indexes?: number[] }): Model {
  const g = m.groups.find((x) => x.label === label);
  if (!g) throw new GroupError(`There is no group called "${label}"`);
  const next = change.label?.trim() ?? g.label;
  if (!next) throw new GroupError('A group needs a label');
  if (next !== g.label && m.groups.some((x) => x.label === next)) throw new GroupError(`A group called "${next}" already exists`);
  const end = change.end ?? groupEnd(g);
  const indexes = change.indexes ?? groupIndexes(g);
  checkPoints(m, end, indexes);
  return { ...m, groups: m.groups.map((x) => (x === g ? { label: next, members: membersOf(end, indexes) } : x)) };
}

/** Remove a group; the points stay in the model (SetUp / Groups / Delete). */
export function deleteGroup(m: Model, label: string): Model {
  if (!m.groups.some((g) => g.label === label)) throw new GroupError(`There is no group called "${label}"`);
  return { ...m, groups: m.groups.filter((g) => g.label !== label) };
}

/** Move the listed points of an end by the same amount (what joggling or dragging a group does). */
export function translatePoints(m: Model, end: End, indexes: number[], delta: Vec3): Model {
  checkPoints(m, end, indexes);
  const data = m[end]!;
  const set = new Set(indexes);
  const points = data.points.map((p, i) => (set.has(i) ? ([p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]] as Vec3) : p));
  return { ...m, [end]: { ...data, points } };
}

/** Joggle a group: every point of it moves by (dx, dy, dz) and keeps its place relative to the others. */
export function moveGroup(m: Model, label: string, delta: Vec3): Model {
  const g = m.groups.find((x) => x.label === label);
  if (!g) throw new GroupError(`There is no group called "${label}"`);
  return translatePoints(m, groupEnd(g), groupIndexes(g), delta);
}

/** The points inside a box (SetUp / Groups / Pick Temporary), as 0-based indexes. */
export function pointsInBox(m: Model, end: End, min: Vec3, max: Vec3): number[] {
  const data = m[end];
  if (!data) return [];
  const out: number[] = [];
  data.points.forEach((p, i) => {
    if (p.every((v, k) => v >= Math.min(min[k], max[k]) && v <= Math.max(min[k], max[k]))) out.push(i);
  });
  return out;
}
