/**
 * Point limit boxes (SHARK's Solve / Edit Point Tolerances). A box is the lowest and highest value a hard
 * point may take on each axis. It limits joggling and dragging, and its corners and mid points are the 27
 * positions of a tolerance analysis.
 *
 * SHARK's data file has no place for them that we know of, so Claudus keeps them in its own CLAUDUS LIMITS
 * section: "nFront nRear", then one line of six numbers (min x y z, max x y z) per point, front then rear.
 * A point with no entry uses the default box of +/- DEFAULT_TOLERANCE around its position.
 */
import type { Vec3 } from '../math/vec3.js';
import type { End, Model, PointLimit } from './types.js';

export const DEFAULT_TOLERANCE = 25; // mm

type Limits = NonNullable<Model['limits']>;

const nums = (l: string) => l.trim().split(/\s+/).map(Number);
const real = (v: number) => String(v).padStart(16);

export function parseLimits(lines: string[] | undefined): Limits | undefined {
  if (!lines) return undefined;
  const rows = lines.filter((l) => l.trim() !== '').map(nums);
  if (!rows.length || rows[0].length !== 2) return undefined;
  const [nf, nr] = rows[0];
  if (rows.length !== 1 + nf + nr || rows.some((r) => r.some((v) => !Number.isFinite(v)))) return undefined;
  const box = (r: number[]): PointLimit => ({ min: [r[0], r[1], r[2]], max: [r[3], r[4], r[5]] });
  const body = rows.slice(1);
  if (body.some((r) => r.length !== 6)) return undefined;
  const out: Limits = {};
  if (nf) out.front = body.slice(0, nf).map(box);
  if (nr) out.rear = body.slice(nf).map(box);
  return out;
}

export function limitsLines(l: Limits): string[] {
  const f = l.front ?? [];
  const r = l.rear ?? [];
  const row = (b: PointLimit) => [...b.min, ...b.max].map(real).join('');
  return [String(f.length).padStart(13) + String(r.length).padStart(13), ...f.map(row), ...r.map(row)];
}

/** The box of one point: its stored box, or the default around its current position. */
export function limitOf(m: Model, end: End, index: number): PointLimit {
  const stored = m.limits?.[end]?.[index];
  if (stored) return stored;
  const p = m[end]?.points[index] ?? [0, 0, 0];
  return around(p, [DEFAULT_TOLERANCE, DEFAULT_TOLERANCE, DEFAULT_TOLERANCE], [DEFAULT_TOLERANCE, DEFAULT_TOLERANCE, DEFAULT_TOLERANCE]);
}

/** A box reaching `neg` below and `pos` above a position on each axis. */
export const around = (p: Vec3, neg: Vec3, pos: Vec3): PointLimit => ({
  min: [p[0] - neg[0], p[1] - neg[1], p[2] - neg[2]],
  max: [p[0] + pos[0], p[1] + pos[1], p[2] + pos[2]],
});

/** The distances a box reaches either side of a position (negative side first), for the all-points dialog. */
export const reach = (p: Vec3, b: PointLimit) => ({
  neg: [0, 1, 2].map((i) => p[i] - b.min[i]) as Vec3,
  pos: [0, 1, 2].map((i) => b.max[i] - p[i]) as Vec3,
});

/** Every point of an end given its own box (stored or default), as a full list. */
export function endLimits(m: Model, end: End): PointLimit[] {
  return (m[end]?.points ?? []).map((_, i) => limitOf(m, end, i));
}

/** A model with one point's box replaced. */
export function setLimit(m: Model, end: End, index: number, box: PointLimit): Model {
  const list = endLimits(m, end);
  list[index] = box;
  return { ...m, limits: { ...m.limits, [end]: list } };
}

/** A model with every point of both ends given a box of the same size around its position. */
export function setAllLimits(m: Model, neg: Vec3, pos: Vec3): Model {
  const limits: Limits = {};
  for (const end of ['front', 'rear'] as const) {
    const s = m[end];
    if (s) limits[end] = s.points.map((p) => around(p, neg, pos));
  }
  return { ...m, limits };
}

/**
 * Keep a point inside its box. With `inUse` a position outside is clamped back in; without it, or when the
 * move is an edit, the box grows to take in the new position.
 */
export function constrainToLimit(box: PointLimit, p: Vec3, inUse: boolean): { point: Vec3; box: PointLimit } {
  if (inUse) return { point: p.map((v, i) => Math.min(box.max[i], Math.max(box.min[i], v))) as Vec3, box };
  return {
    point: p,
    box: { min: p.map((v, i) => Math.min(box.min[i], v)) as Vec3, max: p.map((v, i) => Math.max(box.max[i], v)) as Vec3 },
  };
}

/** The 27 corner, edge-mid, face-mid and centre positions of a box. */
export function boxPositions(b: PointLimit, centre: Vec3): Vec3[] {
  const out: Vec3[] = [];
  const pick = (i: number, k: number) => (k === 0 ? b.min[i] : k === 2 ? b.max[i] : centre[i]);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) out.push([pick(0, x), pick(1, y), pick(2, z)]);
  return out;
}
