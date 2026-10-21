// Parametric studies and a generic bounded optimiser. The evaluate callback runs the simulation (wired by the app).
import type { EngineModel } from '../model';
import { goldenSection, nelderMead } from './numeric';

export type Evaluate = (m: EngineModel) => Promise<number> | number;

export interface ParamSweep { path: string; values: number[] }

export interface ParametricRun {
  /** Parameter values used, keyed by path. */
  values: Record<string, number>;
  score: number;
}

export interface ParametricResult {
  paths: string[];
  runs: ParametricRun[];
  best: ParametricRun | null;
}

function tokens(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (part === '') continue;
    out.push(/^\d+$/.test(part) ? Number(part) : part);
  }
  return out;
}

/** Read a value by path such as "pipes[0].length", "pipes.0.stations.1.d" or "burn.m". */
export function getPath(obj: unknown, path: string): unknown {
  let cur = obj as Record<string | number, unknown> | undefined;
  for (const t of tokens(path)) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[t] as Record<string | number, unknown> | undefined;
  }
  return cur;
}

/** Return a deep copy of obj with the numeric value at path replaced. Throws if the path does not exist. */
export function setPath<T>(obj: T, path: string, value: number): T {
  const copy = structuredClone(obj) as unknown as Record<string | number, unknown>;
  const t = tokens(path);
  if (!t.length) throw new Error('Empty parameter path');
  let cur = copy;
  for (let i = 0; i < t.length - 1; i++) {
    const nxt = cur[t[i]];
    if (nxt === undefined || nxt === null || typeof nxt !== 'object') throw new Error(`Parameter path not found: ${path}`);
    cur = nxt as Record<string | number, unknown>;
  }
  const last = t[t.length - 1];
  if (typeof cur[last] !== 'number') throw new Error(`Parameter path is not a number: ${path}`);
  cur[last] = value;
  return copy as unknown as T;
}

function applyAll(base: EngineModel, values: Record<string, number>): EngineModel {
  let m = base;
  for (const [p, v] of Object.entries(values)) m = setPath(m, p, v);
  return m;
}

/** Full factorial parametric study (1-D, 2-D or n-D). Runs sequentially so the callback may use a worker. */
export async function runParametric(
  base: EngineModel,
  params: ParamSweep[],
  evaluate: Evaluate,
  opt: { onProgress?: (done: number, total: number) => void; maximise?: boolean; signal?: { aborted: boolean } } = {},
): Promise<ParametricResult> {
  const paths = params.map((p) => p.path);
  const combos: number[][] = params.length ? [[]] : [];
  let grid: number[][] = combos;
  for (const p of params) {
    const next: number[][] = [];
    for (const c of grid) for (const v of p.values) next.push([...c, v]);
    grid = next;
  }
  const runs: ParametricRun[] = [];
  let best: ParametricRun | null = null;
  for (let i = 0; i < grid.length; i++) {
    if (opt.signal?.aborted) break;
    const values: Record<string, number> = {};
    grid[i].forEach((v, k) => { values[paths[k]] = v; });
    const score = await evaluate(applyAll(base, values));
    const run = { values, score };
    runs.push(run);
    if (Number.isFinite(score) && (best === null || (opt.maximise ? score > best.score : score < best.score))) best = run;
    opt.onProgress?.(i + 1, grid.length);
  }
  return { paths, runs, best };
}

/** n evenly spaced values from lo to hi inclusive. */
export function linspace(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

export interface OptParam { path: string; min: number; max: number; start?: number }

export interface OptimiseResult {
  values: Record<string, number>;
  score: number;
  evaluations: number;
  history: { values: Record<string, number>; score: number }[];
  model: EngineModel;
}

/**
 * Bounded Nelder-Mead over model parameters. The evaluate callback may be async; the optimiser awaits each call
 * by running the simplex steps through a synchronous cache that is filled ahead (so the callback must be deterministic).
 * To keep the algorithm simple and generic the callback is evaluated through a driver loop that restarts the
 * simplex until the cache covers every point it asks for.
 */
export async function optimiseModel(
  base: EngineModel,
  params: OptParam[],
  evaluate: Evaluate,
  opt: { maximise?: boolean; maxEvaluations?: number; tol?: number; onProgress?: (n: number, best: number) => void } = {},
): Promise<OptimiseResult> {
  const sign = opt.maximise ? -1 : 1;
  const maxEval = opt.maxEvaluations ?? 60;
  const history: OptimiseResult['history'] = [];
  const cache = new Map<string, number>();
  const key = (x: number[]) => x.map((v) => v.toPrecision(9)).join('|');
  const lo = params.map((p) => p.min), hi = params.map((p) => p.max);
  const x0 = params.map((p) => p.start ?? (getPath(base, p.path) as number) ?? (p.min + p.max) / 2);
  const toValues = (x: number[]) => Object.fromEntries(params.map((p, i) => [p.path, x[i]]));
  const pending: { x: number[] } = { x: [] };
  class NeedEval extends Error {}
  const f = (x: number[]): number => {
    const k = key(x);
    const c = cache.get(k);
    if (c !== undefined) return c;
    pending.x = x;
    throw new NeedEval();
  };
  let best = { x: x0, f: Infinity };
  for (let guard = 0; guard < maxEval * 4; guard++) {
    try {
      const r = nelderMead(f, x0, lo, hi, { maxIter: 500, tol: opt.tol ?? 1e-6 });
      best = { x: r.x, f: r.f };
      break;
    } catch (e) {
      if (!(e instanceof NeedEval)) throw e;
      if (cache.size >= maxEval) {
        // Out of budget: return the best evaluated point.
        let bk = '', bv = Infinity;
        for (const [k, v] of cache) if (v < bv) { bv = v; bk = k; }
        best = { x: bk.split('|').map(Number), f: bv };
        break;
      }
      const x = pending.x;
      const raw = await evaluate(applyAll(base, toValues(x)));
      const val = sign * (Number.isFinite(raw) ? raw : 1e300);
      cache.set(key(x), val);
      history.push({ values: toValues(x), score: raw });
      opt.onProgress?.(cache.size, sign * Math.min(...cache.values()));
    }
  }
  const values = toValues(best.x);
  return { values, score: sign * best.f, evaluations: cache.size, history, model: applyAll(base, values) };
}

/** Golden-section search over one parameter (unimodal score). Synchronous evaluate. */
export function optimiseOne(base: EngineModel, path: string, min: number, max: number, evaluate: (m: EngineModel) => number, opt: { maximise?: boolean; tol?: number } = {}) {
  const sign = opt.maximise ? -1 : 1;
  const r = goldenSection((x) => sign * evaluate(setPath(base, path, x)), min, max, opt.tol ?? (max - min) * 1e-3);
  return { value: r.x, score: sign * r.f, evaluations: r.evaluations };
}
