/**
 * 3D data editing (SHARK's Edit / Modify Mode, Change Mode, Tracking, Point Coincidence and the joggle step).
 * Joggling and dragging go through `movePoint`, which is group aware and recorded for undo by the store.
 */
import { create } from 'zustand';
import { GROUND, constrainToLimit, limitOf, dataPoints, getTemplate, groupIndexes, groupsOfEnd, hasTemplate, translatePoints, type Vec3 } from '@claudus/core';
import { growLimit, useApp } from './store';
import { useModes } from './modes';
import { VIEW_AXES, isOrtho, type StdView } from './viewCtl';

export type ModifyMode = 'edit' | 'joggle' | 'drag';
export type ChangeMode = 'change' | 'retain';
export type Tracking = 'all' | 'x' | 'y' | 'z';

export interface EditSettings {
  mode: ModifyMode;
  changeMode: ChangeMode;
  tracking: Tracking;
  trackVisible: boolean;
  /** Length the tracking lines are drawn to, mm. */
  trackLength: number;
  /** Fine and coarse joggle steps, mm (Ctrl+arrows and Shift+arrows). */
  joggleFine: number;
  joggleCoarse: number;
  /** Point Coincidence checking on, with its tolerance in mm. */
  coincidence: boolean;
  coincidenceTol: number;
}

interface EditStore extends EditSettings {
  set: (p: Partial<EditSettings>) => void;
  /** Temporary group (0-based indexes of the shown end); empty when none. */
  tempGroup: number[];
  setTempGroup: (g: number[]) => void;
  /** Picking points for the temporary group. */
  tempPicking: boolean;
  setTempPicking: (on: boolean) => void;
  /** Several points lie within the coincidence tolerance of a pick: the list to choose from. */
  coincident: number[] | null;
  setCoincident: (c: number[] | null) => void;
}

const KEY = 'claudus.edit';
const defaults: EditSettings = { mode: 'drag', changeMode: 'change', tracking: 'all', trackVisible: true, trackLength: 300, joggleFine: 1, joggleCoarse: 10, coincidence: false, coincidenceTol: 0.5 };

function load(): EditSettings {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return defaults; }
}

export const useEdit = create<EditStore>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p);
    const { mode, changeMode, tracking, trackVisible, trackLength, joggleFine, joggleCoarse, coincidence, coincidenceTol } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ mode, changeMode, tracking, trackVisible, trackLength, joggleFine, joggleCoarse, coincidence, coincidenceTol })); } catch { /* storage unavailable */ }
  },
  tempGroup: [],
  setTempGroup: (tempGroup) => set({ tempGroup }),
  tempPicking: false,
  setTempPicking: (tempPicking) => set({ tempPicking }),
  coincident: null,
  setCoincident: (coincident) => set({ coincident }),
}));

/** The points that move when point `index` is edited: its temporary or saved group, else just itself. */
export function editSet(index: number): number[] {
  const { model, end } = useApp.getState();
  const { tempGroup, changeMode } = useEdit.getState();
  let set = [index];
  if (tempGroup.includes(index)) set = tempGroup;
  else {
    const g = groupsOfEnd(model, end).find((x) => groupIndexes(x).includes(index));
    if (g) set = groupIndexes(g);
  }
  const data = model[end];
  if (changeMode === 'retain' && data && hasTemplate(data.templateSlot)) {
    // Retain part lengths: the parts a body point belongs to move with it, so their lengths do not change.
    const pts = dataPoints(getTemplate(data.templateSlot));
    const all = new Set(set);
    for (const i of set) {
      const tp = pts[i];
      if (!tp) continue;
      const parts = [tp.part1, tp.part2].filter((p) => p !== GROUND);
      pts.forEach((q, k) => { if (parts.some((p) => q.part1 === p || q.part2 === p)) all.add(k); });
    }
    set = [...all];
  }
  return set;
}

/** In Retain mode only points on the body can be picked. */
export function pickable(index: number): boolean {
  const { model, end } = useApp.getState();
  const data = model[end];
  if (useEdit.getState().changeMode !== 'retain' || !data || !hasTemplate(data.templateSlot)) return true;
  const tp = dataPoints(getTemplate(data.templateSlot))[index];
  return !!tp && (tp.part1 === GROUND || tp.part2 === GROUND);
}

/** Move point `index` (and its group) by `delta` mm. With limit boxes in use the picked point stops at its box. */
export function movePoint(index: number, delta: Vec3): void {
  const { model, end } = useApp.getState();
  const data = model[end];
  if (!data || !delta.every(Number.isFinite) || delta.every((d) => d === 0)) return;
  const p = data.points[index];
  let d = delta;
  if (useModes.getState().limitsUse) {
    const to = constrainToLimit(limitOf(model, end, index), [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]], true).point;
    d = [to[0] - p[0], to[1] - p[1], to[2] - p[2]];
    if (d.every((v) => v === 0)) return;
  }
  const set = editSet(index);
  let next = translatePoints(model, end, set, d);
  for (const i of set) next = growLimit(next, end, i);
  useApp.setState((s) => ({ model: next, dirty: true, revision: s.revision + 1 }));
}

/** Points other than `index` within the coincidence tolerance of it. */
export function coincidentWith(index: number): number[] {
  const { model, end } = useApp.getState();
  const data = model[end];
  const { coincidenceTol } = useEdit.getState();
  if (!data) return [];
  const p = data.points[index];
  return data.points.map((q, i) => i).filter((i) => Math.hypot(...(data.points[i].map((v, k) => v - p[k]) as Vec3)) <= coincidenceTol);
}

/** The tracking axes a drag or joggle uses in the current view: one axis is a line, two or three a plane. */
export function trackingAxes(tracking: Tracking, stdView: StdView | null): number[] {
  const ortho = isOrtho(stdView);
  const va = stdView ? VIEW_AXES[stdView] : [0, 1, 2];
  if (tracking !== 'all') {
    const a = 'xyz'.indexOf(tracking);
    if (!ortho || va.includes(a)) return [a]; // an axis that is not in this view is ignored
  }
  return ortho ? va : [0, 1, 2];
}

