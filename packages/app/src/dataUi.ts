/** Which data dialog is open, and the state of the Add Point flow (which can stop to pick points in the 3D view). */
import { create } from 'zustand';
import {
  addPointToTemplate, addSpringDamper, getTemplate, GROUND, hasTemplate, isCustomTemplate, nextFreeSlot, modelPointMap,
  type ElementKind, type ElementOption, type Model, type Template, type Vec3,
} from '@claudus/core';
import { useApp } from './store';

export type DataDialogId = 'titles' | 'tyres' | 'body' | 'userBody' | 'properties' | 'textEdit' | 'allSettings' | 'addPoint' | 'dampers' | 'help' | 'about';

/** Where the new point or C of G is measured from. */
export type PlaceMode = 'abs' | 'rel' | 'between';

export interface AddPointState {
  /** 'point' adds a template point; 'cog' sets a part's C of G. */
  what: 'point' | 'cog';
  /** GROUND or a 1-based part number. */
  part: number;
  mode: PlaceMode;
  label: string;
  abs: Vec3;
  /** Picked point numbers: one for relative, two for between. */
  refs: number[];
  offset: Vec3;
  /** Where between the two points (0 to 1). */
  fraction: number;
}

interface DataUi {
  dialog: DataDialogId | null;
  setDialog: (d: DataDialogId | null) => void;
  add: AddPointState;
  setAdd: (a: Partial<AddPointState>) => void;
}

export const useDataUi = create<DataUi>((set) => ({
  dialog: null,
  setDialog: (dialog) => set({ dialog }),
  add: { what: 'point', part: GROUND, mode: 'abs', label: '', abs: [0, 0, 0], refs: [], offset: [0, 0, 0], fraction: 0.5 },
  setAdd: (a) => set((s) => ({ add: { ...s.add, ...a } })),
}));

/** Copy the model, let `fn` change the copy, and put it back (marks the file as changed). */
export function editModel(fn: (m: Model) => void): void {
  const m = structuredClone(useApp.getState().model);
  fn(m);
  useApp.getState().replaceModel(m);
}

/** The template of the end being shown. */
export function currentTemplate(): Template | undefined {
  const { model, end } = useApp.getState();
  const d = model[end];
  return d && hasTemplate(d.templateSlot) ? getTemplate(d.templateSlot) : undefined;
}

/** A changed built-in template is saved under a new number, so the original stays available. */
const target = (t: Template): number => (isCustomTemplate(t.slot) ? t.slot : nextFreeSlot());

/** Use a changed copy of the current template (and optionally new points) for the end being shown. */
function useChanged(t: Template, changed: Template, points?: Vec3[]): void {
  const out: Template = JSON.parse(JSON.stringify(changed));
  if (!isCustomTemplate(t.slot)) {
    out.slot = target(t);
    out.label = `${t.label} (custom)`;
  }
  out.source = 'custom';
  const { art, setArt, applyTemplate } = useApp.getState();
  applyTemplate(out, points);
  setArt(art); // the suspension should not move
}

/** Where the new point or C of G goes, from the placement the user chose. */
export function placement(a: AddPointState, t: Template, points: Vec3[]): Vec3 {
  if (a.mode === 'abs') return a.abs;
  const at = modelPointMap(t, points);
  const p = (no: number | undefined) => {
    const v = no === undefined ? undefined : at.get(no);
    if (!v) throw new Error('Pick the point(s) first.');
    return v;
  };
  if (a.mode === 'rel') {
    const b = p(a.refs[0]);
    return [b[0] + a.offset[0], b[1] + a.offset[1], b[2] + a.offset[2]];
  }
  const [p1, p2] = [p(a.refs[0]), p(a.refs[1])];
  return [0, 1, 2].map((k) => p1[k] + (p2[k] - p1[k]) * a.fraction) as Vec3;
}

/** Add a point to the template of the end being shown. */
export function addPointNow(a: AddPointState): number {
  const { model, end } = useApp.getState();
  const data = model[end];
  const t = currentTemplate();
  if (!data || !t) throw new Error('There is no suspension to add a point to.');
  const r = addPointToTemplate(t, data.points, { label: a.label, part: a.part, pos: placement(a, t, data.points) });
  useChanged(t, r.template, r.points);
  return r.no;
}

/** Set the C of G of a part (compliant analysis uses it). */
export function setCogNow(a: AddPointState): void {
  const { model, end, editEndCompliance } = useApp.getState();
  const data = model[end];
  const t = currentTemplate();
  if (!data || !t) throw new Error('There is no suspension to add a C of G to.');
  const v = placement(a, t, data.points);
  editEndCompliance((e) => {
    e.masses ??= [];
    let m = e.masses.find((x) => x.part === a.part);
    if (!m) {
      m = { part: a.part, cog: { kind: 'abs', v }, zAxis: { kind: 'none' }, xzPlane: { kind: 'none' }, mass: 1, inertia: [1, 1, 1, 0, 0, 0] };
      e.masses.push(m);
    }
    m.cog = { kind: 'abs', v };
  });
}

/** Give the template a spring or damper between two points. */
export function addElementNow(kind: ElementKind, bodyNo: number, suspNo: number): void {
  const t = currentTemplate();
  if (!t) throw new Error('There is no suspension to add to.');
  useChanged(t, addSpringDamper(t, kind, bodyNo, suspNo));
}

/** Ask for points in the 3D view: the picks are handed to `done` (using the add banner that graphics use). */
export function pickInView(name: string, prompts: string[], done: (picked: number[]) => void): void {
  const option: ElementOption = { group: 'Edit', name, kind: 'line', variant: 0, points: prompts.length, params: [], prompts, measure: false };
  const s = useApp.getState();
  s.select(null);
  s.selectGraphic(null);
  s.setAddMode({ option, params: [], picked: [], onDone: done });
}
