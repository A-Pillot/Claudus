// Shared state for the Engine module screen. Owned by the builder UI; results and tools read from it.
import { create } from 'zustand';
import type { EngineModel, SweepResult } from '@claudus/engine';
import { emptyHistory, record, redo as redoH, undo as undoH, type History } from './history';
import type { Clip } from './elements';

export interface EditOptions {
  /** Coalesce consecutive edits with the same key into one undo step. */
  key?: string;
  /** Do not record history (the caller already called checkpoint()). */
  noHistory?: boolean;
}

export interface EngineState {
  /** True while the Engine module is the visible screen. */
  active: boolean;
  setActive: (a: boolean) => void;
  model: EngineModel | null;
  fileName: string | null;
  dirty: boolean;
  results: SweepResult | null;
  /** Earlier result sets kept for overlay in the graphs. */
  overlays: SweepResult[];
  running: boolean;
  progress: number; // 0..1
  progressMessage: string;
  /** Selected network elements, as `${kind}:${id}`. */
  selection: string[];
  /** Selected test point rows (indices). */
  selectedTests: number[];
  clipboard: Clip | null;
  history: History<EngineModel>;
  setModel: (m: EngineModel | null, fileName?: string | null) => void;
  /** Change the model through a mutator on a copy; recorded for undo. */
  edit: (fn: (draft: EngineModel) => void, opts?: EditOptions) => void;
  /** Record the current model as an undo step (before a drag). */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  setSelection: (keys: string[]) => void;
  setSelectedTests: (rows: number[]) => void;
  setClipboard: (c: Clip | null) => void;
  markSaved: (fileName: string) => void;
  setResults: (r: SweepResult | null) => void;
  addOverlay: (r: SweepResult) => void;
  clearOverlays: () => void;
  setRunning: (running: boolean, progress?: number, message?: string) => void;
}

const clone = (m: EngineModel): EngineModel => JSON.parse(JSON.stringify(m));

export const useEngine = create<EngineState>((set, get) => ({
  active: typeof location !== 'undefined' && location.hash === '#engine',
  setActive: (active) => set({ active }),
  model: null,
  fileName: null,
  dirty: false,
  results: null,
  overlays: [],
  running: false,
  progress: 0,
  progressMessage: '',
  selection: [],
  selectedTests: [],
  clipboard: null,
  history: emptyHistory<EngineModel>(),
  setModel: (model, fileName) =>
    set((s) => ({
      model,
      fileName: fileName === undefined ? s.fileName : fileName,
      history: emptyHistory<EngineModel>(),
      selection: [],
      selectedTests: [],
      dirty: false,
    })),
  edit: (fn, opts = {}) => {
    const { model, history } = get();
    if (!model) return;
    const next = clone(model);
    fn(next);
    set({ model: next, dirty: true, history: opts.noHistory ? history : record(history, model, opts.key) });
  },
  checkpoint: () => {
    const { model, history } = get();
    if (model) set({ history: record(history, model) });
  },
  undo: () => {
    const { model, history } = get();
    if (!model) return;
    const r = undoH(history, model);
    if (r) set({ model: r.value, history: r.history, dirty: true, selection: [] });
  },
  redo: () => {
    const { model, history } = get();
    if (!model) return;
    const r = redoH(history, model);
    if (r) set({ model: r.value, history: r.history, dirty: true, selection: [] });
  },
  setSelection: (selection) => set({ selection }),
  setSelectedTests: (selectedTests) => set({ selectedTests }),
  setClipboard: (clipboard) => set({ clipboard }),
  markSaved: (fileName) => set({ fileName, dirty: false }),
  setResults: (results) => set({ results }),
  addOverlay: (r) => set((s) => ({ overlays: [...s.overlays, r].slice(-6) })),
  clearOverlays: () => set({ overlays: [] }),
  setRunning: (running, progress = 0, progressMessage = '') => set({ running, progress, progressMessage }),
}));
