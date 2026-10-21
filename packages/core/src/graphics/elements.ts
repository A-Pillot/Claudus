/**
 * Graphics elements: what to draw for each element kind, and the values of the measurement elements.
 *
 * A template's `GraphicElement` has a kind, the point numbers it uses and a `props` list of numbers.
 * By Claudus convention props[0] is the "variant" (which of SHARK's pick sequences defined the element,
 * 0 when props is absent) and props[1...] are the numbers that variant needs (a radius, a vector...).
 */
import { add, cross, deg, dist, dot, norm, normalize, scale, sub, type Vec3 } from '../math/vec3.js';
import type { GraphicElement, GraphicKind, Template } from '../template/types.js';

/** Half length of lines drawn "to the global clipped length", mm. */
export const CLIP_LINE = 1000;
/** Half size of planes drawn clipped to the global value, mm. */
export const CLIP_PLANE = 500;

/** Looks up the current position of a template point by its number. */
export type PointAt = (no: number) => Vec3 | undefined;

export type Shape =
  | { type: 'segments'; segments: [Vec3, Vec3][]; style: 'line' | 'tube' }
  | { type: 'pivot'; a: Vec3; b: Vec3 }
  | { type: 'cylinder'; a: Vec3; b: Vec3; radius: number }
  | { type: 'circle'; centre: Vec3; radius: number; normal: Vec3 }
  | { type: 'sphere'; centre: Vec3; radius: number }
  | { type: 'facet'; vertices: Vec3[] }
  | { type: 'plane'; centre: Vec3; u: Vec3; v: Vec3; half: number }
  | { type: 'measure'; kind: 'distance' | 'components' | 'angle'; from: Vec3; to: Vec3; apex?: Vec3; value: number; comps?: Vec3 };

// ---- vector helpers -------------------------------------------------------------------------------------

const EPS = 1e-9;

/** Foot of the perpendicular from p on the infinite line through a and b. */
export function nearestOnLine(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const d = sub(b, a);
  const dd = dot(d, d);
  if (dd < EPS) return a;
  return add(a, scale(d, dot(sub(p, a), d) / dd));
}

/** The closest pair of points on two infinite lines (a1-a2 and b1-b2). Parallel lines pair a1 with its foot. */
export function closestOnLines(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3): [Vec3, Vec3] {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const w = sub(a1, b1);
  const a = dot(d1, d1);
  const b = dot(d1, d2);
  const c = dot(d2, d2);
  const d = dot(d1, w);
  const e = dot(d2, w);
  const den = a * c - b * b;
  if (den <= 1e-12 * a * c) return [a1, nearestOnLine(a1, b1, b2)];
  const t = (b * e - c * d) / den;
  const s = (a * e - b * d) / den;
  return [add(a1, scale(d1, t)), add(b1, scale(d2, s))];
}

/** Foot of the perpendicular from p on the plane through a, b, c. */
export function nearestOnPlane(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const n = normalize(cross(sub(b, a), sub(c, a)));
  return sub(p, scale(n, dot(sub(p, a), n)));
}

/** Centre, radius and normal of the circle through three points. */
export function circleThrough(p1: Vec3, p2: Vec3, p3: Vec3): { centre: Vec3; radius: number; normal: Vec3 } | undefined {
  const u = sub(p2, p1);
  const v = sub(p3, p1);
  const n = cross(u, v);
  const nn = dot(n, n);
  if (nn < EPS) return undefined;
  const off = scale(add(scale(cross(v, n), dot(u, u)), scale(cross(n, u), dot(v, v))), 1 / (2 * nn));
  return { centre: add(p1, off), radius: norm(off), normal: normalize(n) };
}

/** Centre and radius of the sphere through four points. */
export function sphereThrough(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): { centre: Vec3; radius: number } | undefined {
  const rows = [p1, p2, p3].map((p) => scale(sub(p, p0), 2));
  const rhs = [p1, p2, p3].map((p) => dot(p, p) - dot(p0, p0));
  const [a1, a2, a3] = rows;
  const det = dot(a1, cross(a2, a3));
  if (Math.abs(det) < EPS) return undefined;
  const c = scale(add(add(scale(cross(a2, a3), rhs[0]), scale(cross(a3, a1), rhs[1])), scale(cross(a1, a2), rhs[2])), 1 / det);
  return { centre: c, radius: dist(c, p0) };
}

// ---- element variants (the Graphics / Add menu) -----------------------------------------------------------

export interface ElementOption {
  /** Menu group (Line, Cylinder...) and the item's own name. */
  group: string;
  name: string;
  kind: GraphicKind;
  variant: number;
  /** Number of point picks. */
  points: number;
  /** Names and defaults of the numbers the user types in (stored after the variant in props). */
  params: { label: string; def: number }[];
  /** One short prompt per pick, in order. */
  prompts: string[];
  /** Distance, components and angle elements: their value is a plottable result. */
  measure: boolean;
}

const opt = (group: string, name: string, kind: GraphicKind, variant: number, prompts: string[], params: ElementOption['params'] = []): ElementOption =>
  ({ group, name, kind, variant, points: prompts.length, prompts, params, measure: kind === 'distance' || kind === 'components' || kind === 'angle' });

const vec = (n: string, def: Vec3): ElementOption['params'] => ['x', 'y', 'z'].map((a, i) => ({ label: `${n} ${a}`, def: def[i] }));

/** Every pick sequence on SHARK's Graphics / Add menu. */
export const ELEMENT_OPTIONS: ElementOption[] = [
  opt('Line', 'Pnt-Pnt', 'line', 0, ['line start', 'line end']),
  opt('Line', 'Pnt-Vector', 'line', 1, ['point on line', 'vector start', 'vector end']),
  opt('Line', 'Pnt-Xvector', 'line', 2, ['point on line']),
  opt('Line', 'Pnt-Yvector', 'line', 3, ['point on line']),
  opt('Line', 'Pnt-Zvector', 'line', 4, ['point on line']),
  opt('Line', 'Pnt-Plane-Norm', 'line', 5, ['point on line', 'plane point 1', 'plane point 2', 'plane point 3']),
  opt('Line', 'Pnt-UserVector', 'line', 6, ['point on line'], vec('vector', [0, 0, 1])),
  opt('Cylinder', 'Pivot', 'pivot', 0, ['pivot end 1', 'pivot end 2']),
  opt('Cylinder', 'Tube', 'tube', 0, ['tube end 1', 'tube end 2']),
  opt('Cylinder', 'Vector-Radius-Length', 'cylinder', 0, ['cylinder base', 'vector start', 'vector end'], [{ label: 'radius', def: 20 }, { label: 'length', def: 100 }]),
  opt('Circle', 'Pnt-Pnt-Pnt', 'circle', 0, ['point 1', 'point 2', 'point 3']),
  opt('Circle', 'Cntr-Rad-Norm', 'circle', 1, ['centre', 'normal start', 'normal end'], [{ label: 'radius', def: 50 }]),
  opt('Circle', 'Cntr-Pnt-Plane', 'circle', 2, ['centre', 'point on circle', 'point in plane']),
  opt('Circle', 'Pnt-Normal', 'circle', 3, ['point on circle', 'axis point', 'axis direction point']),
  opt('Sphere', 'Pnt-Pnt Radius', 'sphere', 0, ['centre', 'point on sphere']),
  opt('Sphere', 'Pnt Radius', 'sphere', 1, ['centre'], [{ label: 'radius', def: 30 }]),
  opt('Sphere', 'Pnt-Pnt Dia', 'sphere', 2, ['diameter end 1', 'diameter end 2']),
  opt('Sphere', 'Pnt-Pnt-Pnt-Pnt', 'sphere', 3, ['point 1', 'point 2', 'point 3', 'point 4']),
  opt('Facet', 'Pnt-Pnt-Pnt Facet', 'facet3', 0, ['corner 1', 'corner 2', 'corner 3']),
  opt('Facet', 'Pnt-Pnt-Pnt-Pnt Facet', 'facet4', 0, ['corner 1', 'corner 2', 'corner 3', 'corner 4']),
  opt('Plane', 'Pnt-Pnt-Pnt Plane', 'plane', 0, ['point 1', 'point 2', 'point 3']),
  opt('Plane', 'Pnt-X-Y Plane', 'plane', 1, ['point on plane']),
  opt('Plane', 'Pnt-X-Z Plane', 'plane', 2, ['point on plane']),
  opt('Plane', 'Pnt-Y-Z Plane', 'plane', 3, ['point on plane']),
  opt('Plane', 'Pnt-UserVector Plane', 'plane', 4, ['point on plane'], [...vec('vector 1', [1, 0, 0]), ...vec('vector 2', [0, 1, 0])]),
  opt('Distance', 'Pnt-Pnt Dist', 'distance', 0, ['point 1', 'point 2']),
  opt('Distance', 'Pnt-Line Dist', 'distance', 1, ['point', 'line point 1', 'line point 2']),
  opt('Distance', 'Line-Line Dist', 'distance', 2, ['line 1 point 1', 'line 1 point 2', 'line 2 point 1', 'line 2 point 2']),
  opt('Distance', 'Pnt-Plane Dist', 'distance', 3, ['point', 'plane point 1', 'plane point 2', 'plane point 3']),
  opt('Components', 'Pnt-Pnt Comps', 'components', 0, ['point 1', 'point 2']),
  opt('Components', 'Pnt-Line Comps', 'components', 1, ['point', 'line point 1', 'line point 2']),
  opt('Components', 'Line-Line Comps', 'components', 2, ['line 1 point 1', 'line 1 point 2', 'line 2 point 1', 'line 2 point 2']),
  opt('Components', 'Pnt-Plane Comps', 'components', 3, ['point', 'plane point 1', 'plane point 2', 'plane point 3']),
  opt('Angle', 'Pnt-Pnt-Pnt Angle', 'angle', 0, ['first arm end', 'angle vertex', 'second arm end']),
];

/** Which menu option an element came from. */
export function optionOf(g: GraphicElement): ElementOption | undefined {
  const variant = g.props?.[0] ?? 0;
  return ELEMENT_OPTIONS.find((o) => o.kind === g.kind && o.variant === variant);
}

/** Make an element from picked point numbers and the typed-in numbers. */
export function buildElement(o: ElementOption, points: number[], params: number[] = o.params.map((p) => p.def)): GraphicElement {
  const g: GraphicElement = { kind: o.kind, points: points.slice(0, o.points) };
  if (o.variant !== 0 || o.params.length) g.props = [o.variant, ...params.slice(0, o.params.length)];
  return g;
}

// ---- geometry ---------------------------------------------------------------------------------------------

const orthoPair = (n: Vec3): [Vec3, Vec3] => {
  const a: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(n, a));
  return [u, cross(n, u)];
};

const lineThrough = (p: Vec3, dir: Vec3): Shape =>
  ({ type: 'segments', style: 'line', segments: [[sub(p, scale(normalize(dir), CLIP_LINE)), add(p, scale(normalize(dir), CLIP_LINE))]] });

/** What to draw for one element, given point positions. Undefined when it cannot be drawn (missing or degenerate points). */
export function elementShape(g: GraphicElement, at: PointAt): Shape | undefined {
  const pts = g.points.map(at);
  if (pts.some((p) => !p)) return undefined;
  const q = pts as Vec3[];
  const variant = g.props?.[0] ?? 0;
  const prm = (i: number) => g.props?.[1 + i] ?? 0;
  const vecProp = (i: number): Vec3 => [prm(i), prm(i + 1), prm(i + 2)];
  const need = (n: number) => q.length >= n;

  switch (g.kind) {
    case 'line': {
      if (variant === 0) return need(2) ? { type: 'segments', style: 'line', segments: [[q[0], q[1]]] } : undefined;
      let dir: Vec3 | undefined;
      if (variant === 1 && need(3)) dir = sub(q[2], q[1]);
      else if (variant === 2) dir = [1, 0, 0];
      else if (variant === 3) dir = [0, 1, 0];
      else if (variant === 4) dir = [0, 0, 1];
      else if (variant === 5 && need(4)) dir = cross(sub(q[2], q[1]), sub(q[3], q[1]));
      else if (variant === 6) dir = vecProp(0);
      return dir && norm(dir) > EPS && need(1) ? lineThrough(q[0], dir) : undefined;
    }
    case 'tube':
      return need(2) ? { type: 'segments', style: 'tube', segments: [[q[0], q[1]]] } : undefined;
    case 'pivot':
      return need(2) ? { type: 'pivot', a: q[0], b: q[1] } : undefined;
    case 'cylinder': {
      if (!need(3)) return undefined;
      const d = sub(q[2], q[1]);
      if (norm(d) < EPS) return undefined;
      return { type: 'cylinder', a: q[0], b: add(q[0], scale(normalize(d), prm(1) || 100)), radius: prm(0) || 20 };
    }
    case 'circle': {
      if (!need(3)) return undefined;
      if (variant === 0) {
        const c = circleThrough(q[0], q[1], q[2]);
        return c && { type: 'circle', ...c };
      }
      if (variant === 1) {
        const n = sub(q[2], q[1]);
        return norm(n) > EPS ? { type: 'circle', centre: q[0], radius: prm(0), normal: normalize(n) } : undefined;
      }
      if (variant === 2) {
        const n = cross(sub(q[1], q[0]), sub(q[2], q[0]));
        return norm(n) > EPS ? { type: 'circle', centre: q[0], radius: dist(q[0], q[1]), normal: normalize(n) } : undefined;
      }
      // Variant 3: the circle runs round the axis through the 2nd pick towards the 3rd, passing through the 1st.
      const axis = sub(q[2], q[1]);
      if (norm(axis) < EPS) return undefined;
      const centre = nearestOnLine(q[0], q[1], q[2]);
      return { type: 'circle', centre, radius: dist(centre, q[0]), normal: normalize(axis) };
    }
    case 'sphere': {
      if (variant === 1) return need(1) ? { type: 'sphere', centre: q[0], radius: prm(0) } : undefined;
      if (variant === 0) return need(2) ? { type: 'sphere', centre: q[0], radius: dist(q[0], q[1]) } : undefined;
      if (variant === 2) return need(2) ? { type: 'sphere', centre: scale(add(q[0], q[1]), 0.5), radius: dist(q[0], q[1]) / 2 } : undefined;
      const s = need(4) ? sphereThrough(q[0], q[1], q[2], q[3]) : undefined;
      return s && { type: 'sphere', ...s };
    }
    case 'facet3':
    case 'facet4':
      return need(g.kind === 'facet3' ? 3 : 4) ? { type: 'facet', vertices: q } : undefined;
    case 'plane': {
      let centre: Vec3 | undefined = q[0];
      let n: Vec3 | undefined;
      if (variant === 0 && need(3)) {
        n = cross(sub(q[1], q[0]), sub(q[2], q[0]));
        centre = scale(add(add(q[0], q[1]), q[2]), 1 / 3);
      } else if (variant === 1) n = [0, 0, 1];
      else if (variant === 2) n = [0, 1, 0];
      else if (variant === 3) n = [1, 0, 0];
      else if (variant === 4) n = cross(vecProp(0), vecProp(3));
      if (!n || !centre || norm(n) < EPS) return undefined;
      const [u, v] = variant === 4 ? [normalize(vecProp(0)), normalize(cross(n, vecProp(0)))] : orthoPair(normalize(n));
      return { type: 'plane', centre, u, v, half: CLIP_PLANE };
    }
    case 'distance':
    case 'components':
      return measureShape(g, q, variant);
    case 'angle': {
      if (!need(3)) return undefined;
      const a = sub(q[0], q[1]);
      const b = sub(q[2], q[1]);
      if (norm(a) < EPS || norm(b) < EPS) return undefined;
      const value = deg(Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))));
      return { type: 'measure', kind: 'angle', from: q[0], to: q[2], apex: q[1], value };
    }
  }
}

/** The shortest connecting segment of a distance / components element. */
function connector(variant: number, q: Vec3[]): [Vec3, Vec3] | undefined {
  switch (variant) {
    case 0: return q.length >= 2 ? [q[0], q[1]] : undefined;
    case 1: return q.length >= 3 ? [q[0], nearestOnLine(q[0], q[1], q[2])] : undefined;
    case 2: return q.length >= 4 ? closestOnLines(q[0], q[1], q[2], q[3]) : undefined;
    case 3:
      if (q.length < 4 || norm(cross(sub(q[2], q[1]), sub(q[3], q[1]))) < EPS) return undefined;
      return [q[0], nearestOnPlane(q[0], q[1], q[2], q[3])];
  }
  return undefined;
}

function measureShape(g: GraphicElement, q: Vec3[], variant: number): Shape | undefined {
  const c = connector(variant, q);
  if (!c) return undefined;
  const comps = sub(c[1], c[0]);
  return { type: 'measure', kind: g.kind as 'distance' | 'components', from: c[0], to: c[1], value: norm(comps), comps };
}

// ---- measurement values -----------------------------------------------------------------------------------

export interface MeasureColumn {
  /** Key in a result row's `measures` record. */
  key: string;
  label: string;
  unit: string;
}

export const isMeasure = (g: GraphicElement): boolean => g.kind === 'distance' || g.kind === 'components' || g.kind === 'angle';

/** The plottable results a template's measurement elements give: one column per distance / angle, four per components element. */
export function measureColumns(t: Template): MeasureColumn[] {
  const out: MeasureColumn[] = [];
  t.graphics.forEach((g, i) => {
    if (!isMeasure(g)) return;
    const name = `${optionOf(g)?.name ?? g.kind} ${g.points.join('-')}`;
    if (g.kind === 'angle') out.push({ key: `g${i}`, label: `Angle ${g.points.join('-')}`, unit: 'deg' });
    else if (g.kind === 'distance') out.push({ key: `g${i}`, label: name, unit: 'mm' });
    else {
      out.push({ key: `g${i}`, label: `${name} (total)`, unit: 'mm' });
      for (const a of ['x', 'y', 'z']) out.push({ key: `g${i}${a}`, label: `${name} ${a}`, unit: 'mm' });
    }
  });
  return out;
}

/** Values of every measurement element at one set of point positions, keyed as in `measureColumns`. NaN when undefined. */
export function measureValues(t: Template, at: PointAt): Record<string, number> {
  const out: Record<string, number> = {};
  t.graphics.forEach((g, i) => {
    if (!isMeasure(g)) return;
    const s = elementShape(g, at);
    const m = s?.type === 'measure' ? s : undefined;
    out[`g${i}`] = m ? m.value : NaN;
    if (g.kind === 'components') ['x', 'y', 'z'].forEach((a, k) => { out[`g${i}${a}`] = m?.comps ? m.comps[k] : NaN; });
  });
  return out;
}
