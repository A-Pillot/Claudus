import { create } from 'zustand';
import { constrainToLimit, limitOf, completeModel, defaultCompliance, defaultEndCompliance, type ComplianceData, type EndCompliance, getTemplate, hasTemplate, newModel, registerTemplate, remapPoints, type End, type Model, type Template, type Vec3, type VehicleParams } from '@claudus/core';
import type { ElementOption } from '@claudus/core';
import { addToLibrary, loadLibrary } from './templates';
import { useModes } from './modes';

loadLibrary();

export interface ArticulationState {
  bump: number;
  roll: number;
  rack: number;
}

/** Which extras the 3D view draws (SHARK's Graphics menu toggles). */
export interface GraphicsView {
  pointNos: boolean;
  pointValues: boolean;
  /** Show the left side of a single-corner template as a mirror image. */
  bothSides: boolean;
  triad: boolean;
  /** Compliance visibility (only drawn in compliant mode). */
  showBushes: boolean;
  showBushAxes: boolean;
  showForces: boolean;
  showJointForces: boolean;
  /** Part C of G markers and their local axes (compliant mode only). */
  showCog: boolean;
  showCogAxes: boolean;
}

/** The compliance dialogs and result windows. */
export type ComplianceDialogId =
  | 'bushes' | 'bushSliders' | 'springs' | 'dampers' | 'tyre' | 'rollbar' | 'general' | 'forces'
  | 'coefficients' | 'joints' | 'loads' | 'massData';

/** An element being added: the picks made so far, in order. */
export interface AddMode {
  option: ElementOption;
  /** The typed-in numbers (radius, vector...). */
  params: number[];
  /** Point numbers picked so far. */
  picked: number[];
  /** When set, the finished picks go here instead of adding a graphic element (Edit menu flows). */
  onDone?: (picked: number[]) => void;
}

export interface AppState {
  view: GraphicsView;
  setView: (v: Partial<GraphicsView>) => void;
  /** Solve / 3D Compliance: the live view, readouts and graphs use the compliant solution. */
  compliant: boolean;
  setCompliant: (on: boolean) => void;
  /** Master switch for external forces (individual sets and forces keep their own switches). */
  forcesOn: boolean;
  setForcesOn: (on: boolean) => void;
  dialog: ComplianceDialogId | null;
  setDialog: (d: ComplianceDialogId | null) => void;
  /** The bush (template point number) the stiffness sliders edit. */
  bushPoint: number | null;
  setBushPoint: (p: number | null) => void;
  /** Edit a copy of the compliance data (created with defaults on first edit) and replace it in the model. */
  editCompliance: (fn: (c: ComplianceData) => void) => void;
  /** Edit the compliance data of the end being shown. */
  editEndCompliance: (fn: (e: EndCompliance) => void) => void;
  addMode: AddMode | null;
  setAddMode: (a: AddMode | null) => void;
  /** Index of the graphic element picked in the 3D view (in the template's graphics list). */
  selectedGraphic: number | null;
  selectGraphic: (i: number | null) => void;
  model: Model;
  fileName: string;
  dirty: boolean;
  /** Which end is being edited and shown. */
  end: End;
  art: ArticulationState;
  selected: number | null;
  /** Bumped on every model change so derived results know to recompute. */
  revision: number;
  /** Bumped when the set of templates changes, so lists of them refresh. */
  templatesRev: number;
  /** Edit history: earlier models (oldest first) and undone ones. Every change of `model` is recorded. */
  undoStack: Model[];
  redoStack: Model[];
  /** Length of the undo buffer; 0 switches undo off (SetUp / Undo Buffer Length). */
  undoLimit: number;
  setUndoLimit: (n: number) => void;
  undo: () => void;
  redo: () => void;
  setModel: (m: Model, fileName: string) => void;
  /** Swap the model for an edited copy (the optimiser's result or its revert, Set Ride Height) without resetting the view. */
  replaceModel: (m: Model) => void;
  setEnd: (e: End) => void;
  setArt: (a: Partial<ArticulationState>) => void;
  select: (i: number | null) => void;
  setPoint: (index: number, axis: number, value: number) => void;
  /** Joggle or drag a point to a position: held inside its limit box when the boxes are in use. */
  movePoint: (index: number, to: Vec3) => void;
  setRollingRadius: (r: number) => void;
  setParam: <K extends keyof VehicleParams>(k: K, v: VehicleParams[K]) => void;
  markSaved: (fileName: string) => void;
  /**
   * Use a new or edited template for the end being shown. The model's points carry across by point number;
   * `points` overrides that when the caller has worked them out (as Convert to Axle does).
   */
  applyTemplate: (t: Template, points?: Vec3[]) => void;
  templatesChanged: () => void;
}

function loadUndoLimit(): number {
  try { const n = Number(localStorage.getItem('claudus.undoLimit')); if (Number.isFinite(n) && n >= 0 && localStorage.getItem('claudus.undoLimit') !== null) return n; } catch { /* storage unavailable */ }
  return 50;
}

// Set while undo/redo or a file load swaps the model, so the history recorder below leaves it alone.
let restoring = false;
let resetHistory = false;
// While > 0 (a drag in progress), changes are not recorded one by one; the model at the start is recorded when it ends.
let hold = 0;
let heldFrom: Model | null = null;

/** Group the changes until `endEdit` into one undo step (a drag). */
export function beginEdit(): void {
  if (hold++ === 0) heldFrom = useApp.getState().model;
}
export const isEditing = () => hold > 0;
export function endEdit(): void {
  if (hold === 0 || --hold > 0) return;
  const from = heldFrom;
  heldFrom = null;
  const { model, undoLimit } = useApp.getState();
  if (from && from !== model && undoLimit > 0) useApp.setState((s) => ({ undoStack: [...s.undoStack, from].slice(-undoLimit), redoStack: [] }));
}

/** Enlarge a point's stored limit box to take in its (new) position. A point with no stored box keeps the default. */
export function growLimit(m: Model, end: End, index: number): Model {
  const stored = m.limits?.[end]?.[index];
  const p = m[end]?.points[index];
  if (!stored || !p) return m;
  const box = constrainToLimit(stored, p, false).box;
  if (box.min.every((v, i) => v === stored.min[i]) && box.max.every((v, i) => v === stored.max[i])) return m;
  const list = [...m.limits![end]!];
  list[index] = box;
  return { ...m, limits: { ...m.limits, [end]: list } };
}

const zeroArt: ArticulationState = { bump: 0, roll: 0, rack: 0 };

export const useApp = create<AppState>((set, get) => ({
  model: newModel(1),
  fileName: 'untitled.dat',
  dirty: false,
  end: 'front',
  art: zeroArt,
  selected: null,
  view: { pointNos: false, pointValues: false, bothSides: true, triad: false, showBushes: true, showBushAxes: true, showForces: true, showJointForces: false, showCog: true, showCogAxes: false },
  compliant: false,
  setCompliant: (compliant) => set({ compliant }),
  forcesOn: true,
  setForcesOn: (forcesOn) => set({ forcesOn }),
  dialog: null,
  setDialog: (dialog) => set({ dialog }),
  bushPoint: null,
  setBushPoint: (bushPoint) => set({ bushPoint }),
  editCompliance: (fn) =>
    set((s) => {
      const c = structuredClone(s.model.compliance ?? defaultCompliance());
      fn(c);
      return { model: { ...s.model, compliance: c }, dirty: true, revision: s.revision + 1 };
    }),
  editEndCompliance: (fn) => {
    const end = get().end;
    get().editCompliance((c) => fn((c[end] ??= defaultEndCompliance())));
  },
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  addMode: null,
  setAddMode: (addMode) => set({ addMode }),
  selectedGraphic: null,
  selectGraphic: (selectedGraphic) => set({ selectedGraphic }),
  revision: 0,
  templatesRev: 0,
  undoStack: [],
  redoStack: [],
  undoLimit: loadUndoLimit(),
  setUndoLimit: (n) => {
    const undoLimit = Math.max(0, Math.min(1000, Math.round(n) || 0));
    try { localStorage.setItem('claudus.undoLimit', String(undoLimit)); } catch { /* storage unavailable */ }
    set((s) => ({ undoLimit, undoStack: undoLimit ? s.undoStack.slice(-undoLimit) : [], redoStack: undoLimit ? s.redoStack : [] }));
  },
  undo: () => {
    const { undoStack, model } = get();
    if (!undoStack.length) return;
    restoring = true;
    set((s) => ({ model: undoStack[undoStack.length - 1], undoStack: undoStack.slice(0, -1), redoStack: [...s.redoStack, model], dirty: true, revision: s.revision + 1, selectedGraphic: null }));
    restoring = false;
  },
  redo: () => {
    const { redoStack, model } = get();
    if (!redoStack.length) return;
    restoring = true;
    set((s) => ({ model: redoStack[redoStack.length - 1], redoStack: redoStack.slice(0, -1), undoStack: [...s.undoStack, model], dirty: true, revision: s.revision + 1, selectedGraphic: null }));
    restoring = false;
  },
  setModel: (loaded, fileName) =>
    set((s) => {
      resetHistory = true;
      // Templates saved in the file come first, so its suspensions can find them.
      loaded.templates?.forEach(registerTemplate);
      return { undoStack: [], redoStack: [], model: completeModel(loaded), fileName, compliant: false, bushPoint: null, templatesRev: s.templatesRev + (loaded.templates?.length ? 1 : 0), dirty: false, end: loaded.front ? 'front' : 'rear', art: zeroArt, selected: null, selectedGraphic: null, addMode: null, revision: s.revision + 1 };
    }),
  replaceModel: (model) => set((s) => ({ model, dirty: true, revision: s.revision + 1 })),
  setEnd: (end) => set({ end, art: zeroArt, selected: null, selectedGraphic: null, addMode: null }),
  setArt: (a) => set((s) => ({ art: { ...s.art, ...a } })),
  select: (selected) => set({ selected }),
  setPoint: (index, axis, value) =>
    set((s) => {
      const data = s.model[s.end];
      if (!data || !Number.isFinite(value)) return {};
      const points = data.points.map((p, i) => (i === index ? (p.map((v, k) => (k === axis ? value : v)) as Vec3) : p));
      // Typing a position outside the limit box is allowed; the box grows to take it in.
      return { model: growLimit({ ...s.model, [s.end]: { ...data, points } }, s.end, index), dirty: true, revision: s.revision + 1 };
    }),
  movePoint: (index, to) =>
    set((s) => {
      const data = s.model[s.end];
      if (!data || !to.every(Number.isFinite)) return {};
      const use = useModes.getState().limitsUse;
      const p = use ? constrainToLimit(limitOf(s.model, s.end, index), to, true).point : to;
      const points = data.points.map((q, i) => (i === index ? p : q));
      return { model: growLimit({ ...s.model, [s.end]: { ...data, points } }, s.end, index), dirty: true, revision: s.revision + 1 };
    }),
  setRollingRadius: (r) =>
    set((s) => {
      const data = s.model[s.end];
      if (!data || !(r > 0)) return {};
      return { model: { ...s.model, [s.end]: { ...data, rollingRadius: r } }, dirty: true, revision: s.revision + 1 };
    }),
  setParam: (k, v) => set((s) => ({ model: { ...s.model, params: { ...s.model.params, [k]: v } }, dirty: true, revision: s.revision + 1 })),
  markSaved: (fileName) => set({ fileName, dirty: false }),
  applyTemplate: (t, points) =>
    set((s) => {
      const data = s.model[s.end];
      if (!data) return {};
      const old = hasTemplate(data.templateSlot) ? getTemplate(data.templateSlot) : undefined;
      const pts = points ?? (old ? remapPoints(old, t, data.points) : data.points);
      addToLibrary([t]);
      return {
        model: { ...s.model, [s.end]: { ...data, templateSlot: t.slot, points: pts } },
        dirty: true,
        art: zeroArt,
        selected: null,
        selectedGraphic: null,
        revision: s.revision + 1,
        templatesRev: s.templatesRev + 1,
      };
    }),
  templatesChanged: () => set((s) => ({ templatesRev: s.templatesRev + 1, revision: s.revision + 1 })),
}));

// Record every model change (point edits, compliance, templates, ride height...) as an undo step.
useApp.subscribe((s, prev) => {
  if (s.model === prev.model) return;
  if (restoring) return;
  if (resetHistory) { resetHistory = false; return; }
  if (hold > 0 || s.undoLimit <= 0) return;
  useApp.setState({ undoStack: [...prev.undoStack, prev.model].slice(-s.undoLimit), redoStack: [] });
});
