import type { Vec3 } from '../math/vec3.js';
import { GenType, GROUND, NONE, PointType, type DummySpec, type GraphicElement, type Template, type TemplatePoint } from './types.js';

/** Position of a dummy axis point: `offset` mm from `at` in the direction from a to b. */
export function dummyPosition(at: Vec3, a: Vec3, b: Vec3, offset: number): Vec3 {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  return [at[0] + (d[0] / n) * offset, at[1] + (d[1] / n) * offset, at[2] + (d[2] / n) * offset];
}

const placeDummy = (d: DummySpec, get: (no: number) => Vec3 | undefined): Vec3 => {
  const [at, a, b] = [get(d.at), get(d.dir[0]), get(d.dir[1])];
  if (!at || !a || !b) throw new Error(`Dummy point refers to an unknown point`);
  return dummyPosition(at, a, b, d.offset);
};

/**
 * Full point list for a model: the file's data points (padded with template defaults when an older file has
 * fewer points) followed by the dummy points worked out from them.
 */
export function expandPoints(t: Template, data: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  const byNo = new Map<number, Vec3>();
  t.points.forEach((p, i) => {
    let v: Vec3;
    if (p.dummy) v = placeDummy(p.dummy, (no) => byNo.get(no));
    else v = data[i] ? ([...data[i]] as Vec3) : ([...p.def] as Vec3);
    byNo.set(p.no, v);
    out.push(v);
  });
  return out;
}

export interface PointSpec {
  no: number;
  label: string;
  def: Vec3;
  gen?: GenType | [GenType, GenType];
  /** Makes this a construction point that is not stored in files; see TemplatePoint.dummy. */
  dummy?: DummySpec;
}

export interface TemplateSpec {
  slot: number;
  label: string;
  /** Parts in order (upright last), each listing the point numbers attached to it. */
  parts: { label: string; points: number[] }[];
  /** Points attached to the body / ground. */
  ground: number[];
  points: PointSpec[];
  graphics?: GraphicElement[];
  fullAxle?: boolean;
}

/**
 * Build a SHARK-style template from a compact description that lists which points sit on which part.
 * A point listed on two parts (or one part and ground) is a joint between them.
 */
export function defineTemplate(spec: TemplateSpec): Template {
  const membership = new Map<number, number[]>();
  const addTo = (no: number, part: number) => {
    const list = membership.get(no) ?? [];
    if (!list.includes(part)) list.push(part);
    membership.set(no, list);
  };
  spec.parts.forEach((p, i) => p.points.forEach((no) => addTo(no, i + 1)));
  spec.ground.forEach((no) => addTo(no, GROUND));

  let bush = 0;
  // Dummy points go last so data points keep their file order and indexes.
  const ordered = [...spec.points.filter((p) => !p.dummy), ...spec.points.filter((p) => p.dummy)];
  const defs = new Map(spec.points.map((p) => [p.no, p.def]));
  const points: TemplatePoint[] = ordered.map((ps) => {
    const parts = membership.get(ps.no) ?? [];
    if (parts.length === 0) throw new Error(`Template ${spec.slot}: point ${ps.no} is not on any part`);
    if (parts.length > 2) throw new Error(`Template ${spec.slot}: point ${ps.no} is on more than two parts`);
    // SHARK convention: a moving part goes in column 1, ground in column 2.
    const sorted = [...parts].sort((a, b) => (a === GROUND ? 1 : b === GROUND ? -1 : a - b));
    const [gen1, gen2] = Array.isArray(ps.gen) ? ps.gen : [ps.gen ?? GenType.None, GenType.None];
    let def = [...ps.def] as Vec3;
    if (ps.dummy) def = placeDummy(ps.dummy, (no) => defs.get(no));
    return {
      no: ps.no,
      label: ps.label,
      def,
      ...(ps.dummy ? { dummy: ps.dummy, pointType: PointType.DummyAxis } : {}),
      part1: sorted[0],
      part2: sorted[1] ?? NONE,
      gen1,
      gen2,
      bush: sorted.length === 2 ? ++bush : 0,
    };
  });
  for (const no of membership.keys())
    if (!spec.points.some((p) => p.no === no)) throw new Error(`Template ${spec.slot}: part lists unknown point ${no}`);

  return {
    slot: spec.slot,
    label: spec.label,
    parts: spec.parts.map((p) => p.label),
    points,
    graphics: spec.graphics ?? defaultGraphics(spec),
    fullAxle: spec.fullAxle,
    source: 'builtin',
  };
}

/**
 * Simple default graphics: two-point links become tubes; on bigger parts every pair of joint points is
 * joined, and each remaining point is joined to its nearest joint point.
 */
function defaultGraphics(spec: TemplateSpec): GraphicElement[] {
  const g: GraphicElement[] = [];
  const dummies = new Set(spec.points.filter((p) => p.dummy).map((p) => p.no));
  const pos = new Map(spec.points.map((p) => [p.no, p.def]));
  const count = new Map<number, number>();
  for (const part of spec.parts) for (const no of part.points) count.set(no, (count.get(no) ?? 0) + 1);
  for (const no of spec.ground) count.set(no, (count.get(no) ?? 0) + 1);
  for (const part of spec.parts) {
    const pts = part.points.filter((no) => !dummies.has(no));
    if (pts.length === 2) {
      g.push({ kind: 'tube', points: [pts[0], pts[1]], props: [16, 0, 0] });
      continue;
    }
    const joints = pts.filter((no) => (count.get(no) ?? 0) > 1);
    for (let i = 0; i < joints.length; i++)
      for (let j = i + 1; j < joints.length; j++) g.push({ kind: 'line', points: [joints[i], joints[j]] });
    for (const no of pts) {
      if (joints.includes(no) || joints.length === 0) continue;
      const p = pos.get(no)!;
      let best = joints[0];
      let bestD = Infinity;
      for (const j of joints) {
        const q = pos.get(j)!;
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (bestD > 1e-6) g.push({ kind: 'line', points: [best, no] });
    }
  }
  return g;
}
