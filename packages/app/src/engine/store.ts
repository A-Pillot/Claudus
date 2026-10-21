// Shared state for the Engine module screen. Owned by the builder UI; results and tools read from it.
import { create } from 'zustand';
import type { EngineModel, SweepResult } from '@claudus/engine';

export interface EngineState {
  model: EngineModel | null;
  fileName: string | null;
  results: SweepResult | null;
  /** Earlier result sets kept for overlay in the graphs. */
  overlays: SweepResult[];
  running: boolean;
  progress: number; // 0..1
  setModel: (m: EngineModel | null, fileName?: string | null) => void;
  setResults: (r: SweepResult | null) => void;
  addOverlay: (r: SweepResult) => void;
  clearOverlays: () => void;
  setRunning: (running: boolean, progress?: number) => void;
}

export const useEngine = create<EngineState>((set) => ({
  model: null,
  fileName: null,
  results: null,
  overlays: [],
  running: false,
  progress: 0,
  setModel: (model, fileName) => set((s) => ({ model, fileName: fileName === undefined ? s.fileName : fileName })),
  setResults: (results) => set({ results }),
  addOverlay: (r) => set((s) => ({ overlays: [...s.overlays, r] })),
  clearOverlays: () => set({ overlays: [] }),
  setRunning: (running, progress = 0) => set({ running, progress }),
}));
