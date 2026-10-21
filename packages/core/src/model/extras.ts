/**
 * Data Claudus keeps in a model file that SHARK has no place for: the body graphics and the optimiser
 * set-up. They go in their own CLAUDUS sections (one JSON line each), so files stay readable by SHARK.
 */
import type { Vec3 } from '../math/vec3.js';
import type { OptimiserParameter, OptimiserSettings } from '../optimise/optimiser.js';
import type { SumTarget } from '../optimise/sum.js';

export const CLAUDUS_BODY_SECTION = 'CLAUDUS BODY';
export const CLAUDUS_OPTIMISER_SECTION = 'CLAUDUS OPTIMISER';

/** Body graphics: a built-in type (0 = none, 8 = user defined) and the user's own lines and facets. */
export interface BodyData {
  type: number;
  /** Polylines, car coordinates: x back from the front axle, y across, z up from the ground (mm). */
  lines: Vec3[][];
  /** Triangles and quadrilaterals. */
  facets: Vec3[][];
}

export const BODY_TYPES: string[] = ['None', 'Saloon', 'Open sports', 'Old single seater', 'Single seater', 'Utility', 'Super saloon', 'Minivan', 'User defined'];
export const BODY_USER = BODY_TYPES.length - 1;

export const emptyBody = (): BodyData => ({ type: 0, lines: [], facets: [] });

/** What the optimiser dialog and kinematic sum hold, saved when the user asks for it. */
export interface OptimiserFileData {
  parameters: OptimiserParameter[];
  settings: OptimiserSettings;
  targets: SumTarget[];
}

// Side profiles as [x as a fraction of the length from the nose, height as a fraction of the top], then
// the overall size: [length, half width, top height, nose overhang ahead of the front axle] in mm.
const PROFILES: Record<number, { size: [number, number, number, number]; top: [number, number][] }> = {
  1: { size: [4300, 850, 1350, 900], top: [[0, 0.3], [0.1, 0.45], [0.3, 0.5], [0.4, 0.95], [0.5, 1], [0.7, 0.98], [0.8, 0.6], [0.95, 0.55], [1, 0.4]] },
  2: { size: [3900, 820, 1100, 800], top: [[0, 0.3], [0.15, 0.5], [0.4, 0.62], [0.5, 1], [0.58, 1], [0.65, 0.65], [0.95, 0.6], [1, 0.45]] },
  3: { size: [3600, 500, 850, 1000], top: [[0, 0.3], [0.25, 0.45], [0.45, 0.5], [0.52, 1], [0.6, 0.55], [0.95, 0.5], [1, 0.4]] },
  4: { size: [4000, 450, 950, 1100], top: [[0, 0.25], [0.2, 0.4], [0.45, 0.5], [0.55, 1], [0.62, 0.6], [0.9, 0.55], [1, 0.45]] },
  5: { size: [4600, 900, 1900, 900], top: [[0, 0.35], [0.12, 0.5], [0.25, 0.55], [0.3, 0.95], [0.85, 1], [1, 0.95]] },
  6: { size: [4500, 950, 1250, 900], top: [[0, 0.3], [0.1, 0.4], [0.35, 0.5], [0.45, 0.95], [0.6, 1], [0.75, 0.9], [0.85, 0.55], [1, 0.5]] },
  7: { size: [4800, 900, 1800, 900], top: [[0, 0.3], [0.1, 0.55], [0.22, 0.7], [0.3, 1], [0.9, 1], [1, 0.6]] },
};

/** The outline of a built-in body type as polylines (car coordinates, see BodyData). */
export function internalBodyLines(type: number): Vec3[][] {
  const p = PROFILES[type];
  if (!p) return [];
  const [length, w, h, nose] = p.size;
  const low = 150;
  const xAt = (f: number) => f * length - nose;
  const zAt = (f: number) => low + f * (h - low);
  const out: Vec3[][] = [];
  for (const y of [-w, 0, w]) out.push(p.top.map(([f, z]) => [xAt(f), y, zAt(z)] as Vec3));
  out.push([[xAt(0), 0, low], [xAt(0), w, low], [xAt(1), w, low], [xAt(1), 0, low], [xAt(1), -w, low], [xAt(0), -w, low], [xAt(0), 0, low]]);
  // Cross sections at a few stations.
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const seg = p.top.findIndex(([x]) => x >= f);
    const a = p.top[Math.max(0, seg - 1)];
    const b = p.top[Math.max(0, seg)];
    const t = b[0] === a[0] ? 0 : (f - a[0]) / (b[0] - a[0]);
    const z = zAt(a[1] + t * (b[1] - a[1]));
    out.push([[xAt(f), -w, low], [xAt(f), -w, z * 0.7], [xAt(f), -w * 0.55, z], [xAt(f), w * 0.55, z], [xAt(f), w, z * 0.7], [xAt(f), w, low]]);
  }
  return out;
}

/** Lines to draw for a body: the internal outline, or the user's lines and facet edges. */
export function bodyLines(b: BodyData | undefined): Vec3[][] {
  if (!b || b.type === 0) return [];
  if (b.type !== BODY_USER) return internalBodyLines(b.type);
  return [...b.lines, ...b.facets.map((f) => [...f, f[0]])];
}

/** Read triangles from an STL file, ASCII or binary, as user body facets. */
export function parseStl(data: string | Uint8Array): Vec3[][] {
  if (typeof data !== 'string' && data.length >= 84) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === data.length) {
      const out: Vec3[][] = [];
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        out.push([0, 1, 2].map((k) => [0, 1, 2].map((c) => dv.getFloat32(o + k * 12 + c * 4, true)) as Vec3));
      }
      return out;
    }
  }
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const out: Vec3[][] = [];
  let cur: Vec3[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) {
    cur.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    if (cur.length === 3) {
      out.push(cur);
      cur = [];
    }
  }
  if (!out.length) throw new Error('No triangles found in the STL file.');
  return out;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Polylines as text for editing: one per line, points as "x y z" separated by commas. */
export const formatPolys = (list: Vec3[][]): string => list.map((l) => l.map((p) => p.map(round).join(' ')).join(', ')).join('\n');

/** The reverse of formatPolys. Throws with the line number when a line is not a list of x y z points. */
export function parsePolys(text: string, minPoints = 2): Vec3[][] {
  const out: Vec3[][] = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const pts = line.split(',').map((q) => q.trim().split(/\s+/).map(Number));
    if (pts.some((p) => p.length !== 3 || p.some((v) => !Number.isFinite(v)))) throw new Error(`Line ${i + 1}: each point needs three numbers (x y z), points separated by commas.`);
    if (pts.length < minPoints) throw new Error(`Line ${i + 1}: needs at least ${minPoints} points.`);
    out.push(pts as Vec3[]);
  });
  return out;
}

// ---- file sections ---------------------------------------------------------------------------------

export function claudusBodyLines(b: BodyData): string[] {
  const r = (list: Vec3[][]) => list.map((l) => l.map((p) => p.map(round) as Vec3));
  return [JSON.stringify({ type: b.type, lines: r(b.lines), facets: r(b.facets) })];
}

export function parseClaudusBody(lines: string[]): BodyData | undefined {
  try {
    const j = JSON.parse(lines.join('')) as Partial<BodyData>;
    const poly = (v: unknown): Vec3[][] =>
      Array.isArray(v) ? v.filter((l) => Array.isArray(l) && l.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) : [];
    return { type: Number.isFinite(j.type) ? (j.type as number) : 0, lines: poly(j.lines), facets: poly(j.facets) };
  } catch {
    return undefined;
  }
}

export const claudusOptimiserLines = (o: OptimiserFileData): string[] => [JSON.stringify(o)];

export function parseClaudusOptimiser(lines: string[]): OptimiserFileData | undefined {
  try {
    const j = JSON.parse(lines.join('')) as Partial<OptimiserFileData>;
    if (!Array.isArray(j.parameters) || !j.settings || !Array.isArray(j.targets)) return undefined;
    return { parameters: j.parameters, settings: j.settings, targets: j.targets };
  } catch {
    return undefined;
  }
}
