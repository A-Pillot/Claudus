// Run control: starts the solver worker, tracks progress, supports cancel.
import { useEngine } from './store';
import type { WorkerReply, WorkerRequest } from './solver.worker';

let worker: Worker | null = null;
export let lastError: string | null = null;
const listeners = new Set<() => void>();
export const onRunError = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

function finish() {
  worker?.terminate();
  worker = null;
}

/** Run the listed test point indices, or all of them when `points` is undefined. */
export function startRun(points?: number[]): void {
  const st = useEngine.getState();
  if (!st.model || st.running) return;
  lastError = null;
  worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  st.setRunning(true, 0, 'Starting');
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const m = e.data;
    const s = useEngine.getState();
    if (m.type === 'progress') s.setRunning(true, m.fraction, m.message);
    else if (m.type === 'done') {
      if (s.results) s.addOverlay(s.results);
      s.setResults(m.result);
      s.setRunning(false, 1, 'Finished');
      finish();
    } else {
      lastError = m.message;
      s.setRunning(false, 0, `Error: ${m.message}`);
      finish();
      listeners.forEach((f) => f());
    }
  };
  worker.onerror = (e) => {
    lastError = e.message;
    useEngine.getState().setRunning(false, 0, `Error: ${e.message}`);
    finish();
    listeners.forEach((f) => f());
  };
  const req: WorkerRequest = { model: st.model, points };
  worker.postMessage(req);
}

export function cancelRun(): void {
  finish();
  useEngine.getState().setRunning(false, 0, 'Cancelled');
}

/** Score a model for the parametric/optimiser tool: peak brake power (kW) over its test points, solved in a worker. */
export function evaluateModel(model: import('@claudus/engine').EngineModel): Promise<number> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.type === 'progress') return;
      w.terminate();
      if (m.type === 'done') resolve(Math.max(...m.result.points.map((p) => p.power)));
      else reject(new Error(m.message));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    const req: WorkerRequest = { model, profileEvery: 0 };
    w.postMessage(req);
  });
}
