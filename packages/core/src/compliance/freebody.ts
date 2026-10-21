/**
 * Free body diagram of one part: the points on it and every force that acts on it in the compliant solution
 * (joint reactions, suspension spring, tyre and the active external forces).
 */
import { add, dot, normalize, scale, sub, type Vec3 } from '../math/vec3.js';
import type { Corner } from '../solver/corner.js';
import { GenType, GROUND, NONE, findGen } from '../template/types.js';
import { endCompliance, forcesFor } from './apply.js';
import type { ComplianceResult } from './solve.js';
import type { ComplianceData } from './types.js';

export interface FreeBodyForce {
  kind: 'joint' | 'spring' | 'tyre' | 'external';
  /** Template point number the force acts at; 0 for the tyre contact point and unlabelled external forces. */
  point: number;
  label: string;
  at: Vec3;
  /** Force on the part, N, global axes. */
  force: Vec3;
}

export interface FreeBody {
  part: number;
  name: string;
  /** Indexes (into the template's points) of the points on the part. */
  points: number[];
  forces: FreeBodyForce[];
}

/**
 * Forces on a part (1-based). `kinematic` is the solved position the compliance result was worked out from;
 * forces are placed at the deformed points. Without a compliance result only the points are listed. A joint's reported force acts on its second part, so the first
 * part feels the opposite.
 */
export function freeBody(c: Corner, kinematic: Vec3[], comp: ComplianceData, detail: ComplianceResult | undefined, part: number): FreeBody {
  const t = c.template;
  const points = detail?.points ?? kinematic;
  const at = (no: number) => {
    const i = c.mech.index.get(no);
    return i === undefined ? undefined : points[i];
  };
  const on = t.points.map((p, i) => (!p.dummy && (p.part1 === part || p.part2 === part) ? i : -1)).filter((i) => i >= 0);
  const forces: FreeBodyForce[] = [];
  const label = (no: number) => t.points.find((p) => p.no === no)?.label ?? '';

  if (!detail) return { part, name: t.parts[part - 1] ?? `Part ${part}`, points: on, forces };

  for (const j of detail.joints) {
    const p = t.points.find((q) => q.no === j.point);
    const pos = at(j.point);
    if (!p || !pos || (p.part1 !== part && p.part2 !== part) || p.part1 === p.part2) continue;
    forces.push({ kind: 'joint', point: j.point, label: label(j.point), at: pos, force: p.part2 === part ? j.force : scale(j.force, -1) });
  }

  // Strut tops: the strut's sideways location in its top mount, which is not a template joint.
  for (const sf of detail.strutForces ?? []) {
    const pos = at(sf.point);
    if (!pos) continue;
    if (sf.strutPart === part) forces.push({ kind: 'joint', point: sf.point, label: `${label(sf.point)} (strut guide)`, at: pos, force: scale(sf.force, -1) });
    else if (sf.otherPart === part) forces.push({ kind: 'joint', point: sf.point, label: `${label(sf.point)} (strut guide)`, at: pos, force: sf.force });
  }

  // Suspension springs push their two ends apart: the preload force (when it is included) plus the rate
  // times the extra compression. The solver always has the rate, so the spring is always on the diagram.
  const data = endCompliance(comp, c.end);
  {
    const pairs: [GenType, GenType][] = [[GenType.Spring1ToSuspension, GenType.Spring1ToBody], [GenType.Spring2ToSuspension, GenType.Spring2ToBody]];
    pairs.forEach(([sg, bg], k) => {
      const sp = findGen(t, sg);
      const bp = findGen(t, bg);
      const f = detail.springForces[k];
      if (!sp || !bp || !Number.isFinite(f) || !data.springs[k]) return;
      const [ps, pb] = [at(sp.no), at(bp.no)];
      const [si, bi] = [sp, bp].map((q) => c.mech.index.get(q.no)!);
      if (!ps || !pb) return;
      const partOf = (q: typeof sp) => (q.part1 === GROUND ? q.part2 : q.part1);
      const axis = normalize(sub(kinematic[si], kinematic[bi]));
      const stretch = dot(axis, sub(sub(points[si], kinematic[si]), sub(points[bi], kinematic[bi])));
      const n = scale(axis, (comp.settings.includeSpring ? f : 0) - data.springs[k].rate * stretch);
      if (partOf(sp) === part) forces.push({ kind: 'spring', point: sp.no, label: `Spring ${k + 1}`, at: ps, force: n });
      if (partOf(bp) === part && partOf(bp) !== partOf(sp)) forces.push({ kind: 'spring', point: bp.no, label: `Spring ${k + 1}`, at: pb, force: scale(n, -1) });
    });
  }

  // Tyre: the ground pushes up on the part that carries the wheel.
  c.sides.forEach((w, k) => {
    if (t.points[w.wc].part1 === part) forces.push({ kind: 'tyre', point: 0, label: 'Tyre', at: c.tcp(points, k), force: [0, 0, detail.tyreLoads[k]] });
  });

  for (const f of forcesFor(comp, c.end)) {
    const target = f.part === 0 ? t.points[c.sides[0].wc].part1 : f.part;
    if (target !== part || !f.magnitude) continue;
    const origin = f.at === 0 ? c.tcp(points, 0) : at(f.at);
    if (!origin) continue;
    const head = add(origin, f.head);
    const dir = sub(head, add(origin, f.tail));
    if (Math.hypot(...dir) < 1e-12) continue;
    forces.push({ kind: 'external', point: f.at, label: f.label || 'External force', at: head, force: scale(normalize(dir), f.magnitude) });
  }

  return { part, name: t.parts[part - 1] ?? `Part ${part}`, points: on, forces };
}

/** The parts of a corner a free body can be drawn for (those with at least one point). */
export const freeBodyParts = (c: Corner): { part: number; name: string }[] =>
  c.template.parts
    .map((name, i) => ({ part: i + 1, name }))
    .filter((p) => c.template.points.some((q) => q.part1 === p.part || (q.part2 === p.part && q.part2 !== NONE)));
