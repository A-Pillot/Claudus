/**
 * Point tolerance analysis (SHARK's Solve / Point Tolerance Analysis): one hard point is moved to the
 * 27 corner, edge, face and centre positions of its limit box, and the suspension is analysed at each. The
 * spread of any variable over those runs is drawn on the graphs.
 */
import type { Vec3 } from '../math/vec3.js';
import { boxPositions, limitOf } from '../model/limits.js';
import type { End, Model } from '../model/types.js';
import { analyse, type AnalyseOptions, type EndAnalysis } from './derivatives.js';

export interface ToleranceRun {
  position: Vec3;
  /** The end's analysis with the point at `position`. */
  result: EndAnalysis;
}

export interface ToleranceAnalysis {
  end: End;
  /** Index of the data point in the end's point list. */
  point: number;
  runs: ToleranceRun[];
}

/** Analyse one end with its point `point` at each of the 27 positions of its limit box. */
export function toleranceAnalysis(m: Model, end: End, point: number, opts: AnalyseOptions = {}): ToleranceAnalysis {
  const s = m[end];
  if (!s || !s.points[point]) throw new Error('There is no such point to analyse');
  const positions = boxPositions(limitOf(m, end, point), s.points[point]);
  // Analyse the one end only, which also keeps the work to a single suspension.
  const single: Model = { ...m, front: undefined, rear: undefined, [end]: s };
  const runs = positions.map((position) => {
    const points = s.points.map((p, i) => (i === point ? position : p));
    const [result] = analyse({ ...single, [end]: { ...s, points } }, opts);
    return { position, result };
  });
  return { end, point, runs };
}

/** For each x of a sweep, the lowest and highest value of `get` over all runs. */
export function spread<K extends 'bump' | 'roll' | 'steer' | 'combined'>(
  t: ToleranceAnalysis,
  sweep: K,
  x: (row: EndAnalysis[K][number]) => number,
  get: (row: EndAnalysis[K][number]) => number,
): { x: number; min: number; max: number }[] {
  const byX = new Map<number, { min: number; max: number }>();
  for (const run of t.runs)
    for (const row of run.result[sweep] as EndAnalysis[K]) {
      const v = get(row);
      if (!Number.isFinite(v)) continue;
      const k = x(row);
      const cur = byX.get(k);
      if (!cur) byX.set(k, { min: v, max: v });
      else {
        cur.min = Math.min(cur.min, v);
        cur.max = Math.max(cur.max, v);
      }
    }
  return [...byX].map(([xv, r]) => ({ x: xv, ...r })).sort((a, b) => a.x - b.x);
}
