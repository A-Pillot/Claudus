import type { Vec3 } from '../math/vec3.js';
import { GenType, GROUND, NONE, type GraphicElement, type Template, type TemplatePoint } from './types.js';

export interface PointSpec {
  no: number;
  label: string;
  def: Vec3;
  gen?: GenType | [GenType, GenType];
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
  const points: TemplatePoint[] = spec.points.map((ps) => {
    const parts = membership.get(ps.no) ?? [];
    if (parts.length === 0) throw new Error(`Template ${spec.slot}: point ${ps.no} is not on any part`);
    if (parts.length > 2) throw new Error(`Template ${spec.slot}: point ${ps.no} is on more than two parts`);
    // SHARK convention: a moving part goes in column 1, ground in column 2.
    const sorted = [...parts].sort((a, b) => (a === GROUND ? 1 : b === GROUND ? -1 : a - b));
    const [gen1, gen2] = Array.isArray(ps.gen) ? ps.gen : [ps.gen ?? GenType.None, GenType.None];
    return {
      no: ps.no,
      label: ps.label,
      def: [...ps.def] as Vec3,
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
  const pos = new Map(spec.points.map((p) => [p.no, p.def]));
  const count = new Map<number, number>();
  for (const part of spec.parts) for (const no of part.points) count.set(no, (count.get(no) ?? 0) + 1);
  for (const no of spec.ground) count.set(no, (count.get(no) ?? 0) + 1);
  for (const part of spec.parts) {
    const pts = part.points;
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
