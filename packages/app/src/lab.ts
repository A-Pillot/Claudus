/**
 * State for the Phase 5 screens: user and scope lines on the graphs, the kinematic sum targets, the optimiser's
 * parameters, the display mode (deformed, mode shape, forced response) and which floating panels are open.
 * None of it is saved in the .dat file (as in SHARK, user lines and optimiser set-up are not part of the model).
 */
import { create } from 'zustand';
import {
  defaultOptimiserSettings, lineKey, sortUserLine,
  type EndAnalysis, type End, type Model, type OptimiserParameter, type OptimiserSettings, type SumTarget, type Sweep, type UserLine,
} from '@claudus/core';

export type PanelId = 'kinSum' | 'optimiser' | 'modal' | 'sweep';
export type DisplayMode = 'articulation' | 'deformed' | 'mode' | 'forced';

export const SCOPE_SLOTS = 5;

export interface DisplaySettings {
  mode: DisplayMode;
  /** 1-based, lowest frequency first. */
  modeNo: number;
  modeScalar: number;
  forcedHz: number;
  forcedScalar: number;
  deformScalar: number;
  animate: boolean;
}

export interface GraphVisibility {
  deviation: boolean;
  userLine: boolean;
  scope: boolean;
}

export interface EditLineTarget {
  end: End;
  sweep: Sweep;
  variable: string;
  /** Shown in the dialog title. */
  label: string;
}

type LineId = Pick<UserLine, 'sweep' | 'variable' | 'end'>;

export interface LabState {
  userLines: UserLine[];
  /** Add, replace (by end, sweep and variable) or, when it has no points, remove a user line. */
  setUserLine: (l: UserLine) => void;
  setUserLines: (lines: UserLine[]) => void;
  clearUserLine: (k: LineId) => void;
  clearUserLines: () => void;

  /** Five scope line stores, each a snapshot of the analysis results (all variables). */
  scope: (EndAnalysis[] | null)[];
  storeScope: (slot: number, results: EndAnalysis[]) => void;
  /** Store in slot 1 after shifting the others down one (slot 5 is lost). */
  shuffleScope: (results: EndAnalysis[]) => void;
  /** Store in slot 1 and empty the rest. */
  exclusiveScope: (results: EndAnalysis[]) => void;
  clearScope: (slot?: number) => void;
  /** Which scope slot the deviation value compares with (0-based). */
  scopeDevSlot: number;
  setScopeDevSlot: (i: number) => void;

  graphVis: GraphVisibility;
  setGraphVis: (v: Partial<GraphVisibility>) => void;

  editLine: EditLineTarget | null;
  setEditLine: (e: EditLineTarget | null) => void;
  manageLines: boolean;
  setManageLines: (on: boolean) => void;

  panels: Record<PanelId, boolean>;
  setPanel: (id: PanelId, on: boolean) => void;

  sumTargets: SumTarget[];
  setSumTargets: (t: SumTarget[]) => void;

  optParams: OptimiserParameter[];
  setOptParams: (p: OptimiserParameter[]) => void;
  optSettings: OptimiserSettings;
  setOptSettings: (s: OptimiserSettings) => void;
  /** The model as it was before the last optimiser result was applied (for Revert). */
  optBackup: Model | null;
  setOptBackup: (m: Model | null) => void;

  display: DisplaySettings;
  setDisplay: (d: Partial<DisplaySettings>) => void;
}

const sameLine = (a: LineId, b: LineId) => lineKey(a) === lineKey(b);

export const useLab = create<LabState>((set) => ({
  userLines: [],
  setUserLine: (l) =>
    set((s) => {
      const rest = s.userLines.filter((x) => !sameLine(x, l));
      return { userLines: l.points.length ? [...rest, sortUserLine(l)] : rest };
    }),
  setUserLines: (userLines) => set({ userLines: userLines.map(sortUserLine) }),
  clearUserLine: (k) => set((s) => ({ userLines: s.userLines.filter((x) => !sameLine(x, k)) })),
  clearUserLines: () => set({ userLines: [] }),

  scope: Array(SCOPE_SLOTS).fill(null),
  storeScope: (slot, results) => set((s) => ({ scope: s.scope.map((x, i) => (i === slot ? results : x)) })),
  shuffleScope: (results) => set((s) => ({ scope: [results, ...s.scope.slice(0, SCOPE_SLOTS - 1)] })),
  exclusiveScope: (results) => set({ scope: [results, ...Array(SCOPE_SLOTS - 1).fill(null)] }),
  clearScope: (slot) => set((s) => ({ scope: slot === undefined ? Array(SCOPE_SLOTS).fill(null) : s.scope.map((x, i) => (i === slot ? null : x)) })),
  scopeDevSlot: 0,
  setScopeDevSlot: (scopeDevSlot) => set({ scopeDevSlot }),

  graphVis: { deviation: false, userLine: true, scope: true },
  setGraphVis: (v) => set((s) => ({ graphVis: { ...s.graphVis, ...v } })),

  editLine: null,
  setEditLine: (editLine) => set({ editLine }),
  manageLines: false,
  setManageLines: (manageLines) => set({ manageLines }),

  panels: { kinSum: false, optimiser: false, modal: false, sweep: false },
  setPanel: (id, on) => set((s) => ({ panels: { ...s.panels, [id]: on } })),

  sumTargets: [],
  setSumTargets: (sumTargets) => set({ sumTargets }),

  optParams: [],
  setOptParams: (optParams) => set({ optParams }),
  optSettings: defaultOptimiserSettings(),
  setOptSettings: (optSettings) => set({ optSettings }),
  optBackup: null,
  setOptBackup: (optBackup) => set({ optBackup }),

  display: { mode: 'articulation', modeNo: 1, modeScalar: 20, forcedHz: 15, forcedScalar: 20, deformScalar: 10, animate: false },
  setDisplay: (d) => set((s) => ({ display: { ...s.display, ...d } })),
}));
