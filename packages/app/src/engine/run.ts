// Run control: starts the solver worker, tracks progress, supports cancel.
import { useEngine } from './store';
import type { WorkerReply, WorkerRequest } from './solver.worker';

import type { EngineModel, SweepResult } from '@claudus/engine';

export let lastError: string | null = null;
const listeners = new Set<() => void>();
export const onRunError = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export interface Pool { promise: Promise<SweepResult>; cancel: () => void }

/**
 * Solve test points in parallel, one worker per point up to hardwareConcurrency-1 workers.
 * Results are merged into one SweepResult in test order.
 */
export function runPool(model: EngineModel, indices: number[], opts: { profileEvery?: number; onProgress?: (f: number, msg: string) => void } = {}): Pool {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const n = Math.max(1, Math.min(hc - 1, indices.length));
  const workers: Worker[] = [];
  const stop = () => { workers.forEach((w) => w.terminate()); workers.length = 0; };
  const promise = new Promise<SweepResult>((resolve, reject) => {
    const queue = [...indices];
    const done: (SweepResult | undefined)[] = new Array(indices.length);
    const frac = new Array<number>(indices.length).fill(0);
    let finished = 0;
    const report = (msg: string) => opts.onProgress?.(frac.reduce((a, b) => a + b, 0) / Math.max(1, indices.length), msg);
    const fail = (message: string) => { stop(); reject(new Error(message)); };
    const next = (w: Worker) => {
      const idx = queue.shift();
      if (idx === undefined) { w.terminate(); workers.splice(workers.indexOf(w), 1); return; }
      const slot = indices.indexOf(idx);
      w.onmessage = (e: MessageEvent<WorkerReply>) => {
        const m = e.data;
        if (m.type === 'progress') { frac[slot] = m.fraction; report(`Point ${slot + 1} of ${indices.length}: ${m.message}`); }
        else if (m.type === 'done') {
          frac[slot] = 1; done[slot] = m.result; finished++;
          report(`${finished} of ${indices.length} points done`);
          if (finished === indices.length) {
            stop();
            const first = done[0]!;
            resolve({ ...first, points: done.flatMap((r) => r!.points) });
          } else next(w);
        } else fail(m.message);
      };
      const req: WorkerRequest = { model, points: [idx], profileEvery: opts.profileEvery };
      w.postMessage(req);
    };
    if (indices.length === 0) { reject(new Error('No test points to run')); return; }
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
      w.onerror = (e) => fail(e.message || 'Worker error');
      workers.push(w);
      next(w);
    }
  });
  return { promise, cancel: stop };
}

let pool: Pool | null = null;

/** Run the listed test point indices, or all of them when `points` is undefined. */
export function startRun(points?: number[]): void {
  const st = useEngine.getState();
  if (!st.model || st.running) return;
  lastError = null;
  const idx = points ?? st.model.tests.map((_, i) => i);
  st.setRunning(true, 0, 'Starting');
  const p = runPool(st.model, idx, { profileEvery: 5, onProgress: (f, msg) => useEngine.getState().setRunning(true, f, msg) });
  pool = p;
  p.promise.then((result) => {
    if (pool !== p) return;
    const s = useEngine.getState();
    if (s.results) s.addOverlay(s.results);
    s.setResults(result);
    s.setRunning(false, 1, 'Finished');
    pool = null;
  }).catch((err: Error) => {
    if (pool !== p) return;
    lastError = err.message;
    useEngine.getState().setRunning(false, 0, `Error: ${err.message}`);
    pool = null;
    listeners.forEach((f) => f());
  });
}

export function cancelRun(): void {
  const p = pool;
  pool = null;
  p?.cancel();
  useEngine.getState().setRunning(false, 0, 'Cancelled');
}

/** Score a model for the parametric/optimiser tool: peak brake power (kW) over its test points, solved in parallel workers. */
export function evaluateModel(model: EngineModel): Promise<number> {
  return runPool(model, model.tests.map((_, i) => i), { profileEvery: 0 }).promise.then((r) => Math.max(...r.points.map((p) => p.power)));
}
