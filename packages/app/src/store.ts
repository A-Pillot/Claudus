import { create } from 'zustand';
import { completeModel, getTemplate, hasTemplate, newModel, registerTemplate, remapPoints, type End, type Model, type Template, type Vec3, type VehicleParams } from '@claudus/core';
import { addToLibrary, loadLibrary } from './templates';

loadLibrary();

export interface ArticulationState {
  bump: number;
  roll: number;
  rack: number;
}

export interface AppState {
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
  setModel: (m: Model, fileName: string) => void;
  setEnd: (e: End) => void;
  setArt: (a: Partial<ArticulationState>) => void;
  select: (i: number | null) => void;
  setPoint: (index: number, axis: number, value: number) => void;
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

const zeroArt: ArticulationState = { bump: 0, roll: 0, rack: 0 };

export const useApp = create<AppState>((set) => ({
  model: newModel(1),
  fileName: 'untitled.dat',
  dirty: false,
  end: 'front',
  art: zeroArt,
  selected: null,
  revision: 0,
  templatesRev: 0,
  setModel: (loaded, fileName) =>
    set((s) => {
      // Templates saved in the file come first, so its suspensions can find them.
      loaded.templates?.forEach(registerTemplate);
      return { model: completeModel(loaded), fileName, templatesRev: s.templatesRev + (loaded.templates?.length ? 1 : 0), dirty: false, end: loaded.front ? 'front' : 'rear', art: zeroArt, selected: null, revision: s.revision + 1 };
    }),
  setEnd: (end) => set({ end, art: zeroArt, selected: null }),
  setArt: (a) => set((s) => ({ art: { ...s.art, ...a } })),
  select: (selected) => set({ selected }),
  setPoint: (index, axis, value) =>
    set((s) => {
      const data = s.model[s.end];
      if (!data || !Number.isFinite(value)) return {};
      const points = data.points.map((p, i) => (i === index ? (p.map((v, k) => (k === axis ? value : v)) as Vec3) : p));
      return { model: { ...s.model, [s.end]: { ...data, points } }, dirty: true, revision: s.revision + 1 };
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
        revision: s.revision + 1,
        templatesRev: s.templatesRev + 1,
      };
    }),
  templatesChanged: () => set((s) => ({ templatesRev: s.templatesRev + 1, revision: s.revision + 1 })),
}));
