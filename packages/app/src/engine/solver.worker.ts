// Runs the engine simulation off the main thread and reports progress.
import { simulate, type EngineModel, type SweepResult } from '@claudus/engine';

export interface WorkerRequest { model: EngineModel; points?: number[]; profileEvery?: number }
export type WorkerReply =
  | { type: 'progress'; fraction: number; message: string }
  | { type: 'done'; result: SweepResult }
  | { type: 'error'; message: string };

const post = (m: WorkerReply) => (self as unknown as { postMessage: (m: WorkerReply) => void }).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { model, points, profileEvery } = e.data;
  simulate(model, { points, profileEvery, onProgress: (fraction, message) => post({ type: 'progress', fraction, message }) })
    .then((result) => post({ type: 'done', result }))
    .catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
