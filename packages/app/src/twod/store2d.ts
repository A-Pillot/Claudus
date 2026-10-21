import { create } from 'zustand';
import { defaultSweep, newModel2D, type FreeMode, type Model2D, type Sweep2D, type TwoDType, type UserLines } from '@claudus/core';

/** Which part of the picture is selected: a point id from the 2D point table. */
export type Point2DId = 'lowerInner' | 'upperInner' | 'lowerOuter' | 'upperOuter' | 'ground' | 'contact';

export type Articulation2D = 'bump' | 'roll';

/** Fields that set the geometry; editing one drops outer-point positions found by a Free solve. */
const GEOMETRY_KEYS: (keyof Model2D)[] = ['track', 'kingpinAngle', 'kingpinOffset', 'lowerOuterZ', 'upperOuterZ'];
/** Fields that set the default user lines; editing one resets any edited lines. */
const TARGET_KEYS: (keyof Model2D)[] = ['camberBump', 'camberRebound', 'rcStatic', 'rcBump', 'rcRebound', 'camberRoll', 'rcRoll', 'rcLateralRoll', 'rollTravel'];

/**
 * The 2D module's own state. SHARK keeps the 2D and 3D data completely separate, so this is a second store:
 * switching modules just flips `active`, and each module's model stays as it was.
 */
export interface State2D {
  active: boolean;
  model: Model2D;
  fileName: string;
  dirty: boolean;
  sweep: Sweep2D;
  freeMode: FreeMode;
  /** User-edited target lines. null = lines follow the slopes in the general data. */
  userLines: UserLines | null;
  mode: Articulation2D;
  art: { bump: number; roll: number };
  selected: Point2DId | null;
  activate: () => void;
  deactivate: () => void;
  /** Load a model (from a file or New) and switch to the 2D module. */
  load: (m: Model2D, fileName: string) => void;
  create: (type: TwoDType) => void;
  edit: (fields: Partial<Model2D>) => void;
  setSweep: (s: Partial<Sweep2D>) => void;
  setFreeMode: (m: FreeMode) => void;
  setUserLines: (l: UserLines | null) => void;
  setMode: (m: Articulation2D) => void;
  setArt: (a: Partial<{ bump: number; roll: number }>) => void;
  select: (p: Point2DId | null) => void;
  markSaved: (fileName: string) => void;
}

const zero = { bump: 0, roll: 0 };

export const useTwoD = create<State2D>((set) => ({
  active: false,
  model: newModel2D(1),
  fileName: 'untitled_2d.dat',
  dirty: false,
  sweep: defaultSweep(),
  freeMode: 'fixAll',
  userLines: null,
  mode: 'bump',
  art: zero,
  selected: null,
  activate: () => set({ active: true }),
  deactivate: () => set({ active: false }),
  load: (model, fileName) => set({ active: true, model, fileName, dirty: false, freeMode: 'fixAll', userLines: null, art: zero, selected: null }),
  create: (type) => set({ active: true, model: newModel2D(type), fileName: `type${type}_2d.dat`, dirty: false, freeMode: 'fixAll', userLines: null, art: zero, selected: null }),
  edit: (fields) =>
    set((s) => {
      const keys = Object.keys(fields) as (keyof Model2D)[];
      const next: Model2D = { ...s.model, ...fields };
      if (keys.some((k) => GEOMETRY_KEYS.includes(k)) && !('outerY' in fields)) delete next.outerY;
      return { model: next, dirty: true, userLines: keys.some((k) => TARGET_KEYS.includes(k)) ? null : s.userLines };
    }),
  setSweep: (sw) => set((s) => ({ sweep: { ...s.sweep, ...sw }, userLines: null })),
  setFreeMode: (freeMode) => set({ freeMode, selected: null }),
  setUserLines: (userLines) => set({ userLines }),
  setMode: (mode) => set({ mode }),
  setArt: (a) => set((s) => ({ art: { ...s.art, ...a } })),
  select: (selected) => set({ selected }),
  markSaved: (fileName) => set({ fileName, dirty: false }),
}));
