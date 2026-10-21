/**
 * 3D view controls (SHARK's View and Graphics display options): fill style, background, visibility toggles,
 * colours and sizes, saved views, and a small camera API the 3D canvas fills in.
 */
import { create } from 'zustand';
import type { Vec3 } from '@claudus/core';

export type FillStyle = 'solid' | 'wireframe' | 'hidden';
export type DynMode = 'rotate' | 'pan' | 'zoom';
export type StdView = 'front' | 'rear' | 'left' | 'right' | 'top' | 'bottom' | 'iso';
export type ViewTool = 'box' | 'centre' | null;

export const STD_VIEWS: [StdView, string][] = [
  ['front', 'Front (Y-Z)'], ['rear', 'Rear (Y-Z)'], ['left', 'Left side (X-Z)'], ['right', 'Right side (X-Z)'],
  ['top', 'Top (X-Y)'], ['bottom', 'Bottom (X-Y)'], ['iso', 'Isometric'],
];

export interface SavedView { name: string; position: Vec3; target: Vec3 }

export interface ViewSettings {
  fill: FillStyle;
  background: string;
  /** Left-button action of the mouse in the 3D view (cycled with Alt+Z or the right button). */
  dyn: DynMode;
  /** The standard view last chosen, or null once the view is moved freely. */
  stdView: StdView | null;
  /** Draw the other end as well (front and rear together). */
  bothEnds: boolean;
  showSprings: boolean;
  showDampers: boolean;
  showWheels: boolean;
  showPivots: boolean;
  showBody: boolean;
  showGround: boolean;
  showRollCentre: boolean;
  pointNames: boolean;
  partLabels: boolean;
  wheelColour: string;
  springColour: string;
  damperColour: string;
  pointColour: string;
  bodyColour: string;
  /** Multipliers for point marker size and line thickness. */
  pointSize: number;
  lineSize: number;
}

export const defaultViewSettings: ViewSettings = {
  fill: 'solid', background: '#14171c', dyn: 'rotate', stdView: null, bothEnds: false,
  showSprings: true, showDampers: true, showWheels: true, showPivots: true, showBody: true, showGround: true, showRollCentre: true,
  pointNames: false, partLabels: false,
  wheelColour: '#2b2f36', springColour: '#a5e887', damperColour: '#ff9d4d', pointColour: '#dfe6ee', bodyColour: '#9aa4b2',
  pointSize: 1, lineSize: 1,
};

interface ViewCtl extends ViewSettings {
  set: (p: Partial<ViewSettings>) => void;
  reset: () => void;
  tool: ViewTool;
  setTool: (t: ViewTool) => void;
  savedViews: SavedView[];
  setSavedViews: (v: SavedView[]) => void;
}

const KEY = 'claudus.view3d';
const VIEWS_KEY = 'claudus.savedViews';
const persisted = (s: ViewCtl): ViewSettings => {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(defaultViewSettings)) if (k !== 'stdView') out[k] = (s as unknown as Record<string, unknown>)[k];
  return out as unknown as ViewSettings;
};
function read<T>(key: string, fallback: T): T {
  try { const t = localStorage.getItem(key); return t ? (JSON.parse(t) as T) : fallback; } catch { return fallback; }
}

export const useViewCtl = create<ViewCtl>((set, get) => ({
  ...defaultViewSettings,
  ...read<Partial<ViewSettings>>(KEY, {}),
  stdView: null,
  set: (p) => {
    set(p);
    try { localStorage.setItem(KEY, JSON.stringify(persisted(get()))); } catch { /* storage unavailable */ }
  },
  reset: () => get().set({ ...defaultViewSettings }),
  tool: null,
  setTool: (tool) => set({ tool }),
  savedViews: read<SavedView[]>(VIEWS_KEY, []),
  setSavedViews: (savedViews) => {
    set({ savedViews });
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(savedViews)); } catch { /* storage unavailable */ }
  },
}));

/** What the 3D canvas offers to menus and keys; filled in by the canvas while it is mounted. */
export interface CameraApi {
  stdView: (v: StdView) => void;
  fit: () => void;
  /** Zoom to a rectangle given as fractions (0..1) of the canvas, top-left origin. */
  zoomBox: (x0: number, y0: number, x1: number, y1: number) => void;
  /** Make the point under a canvas fraction position the centre of rotation. */
  pickCentre: (x: number, y: number) => void;
  current: () => { position: Vec3; target: Vec3 };
  apply: (position: Vec3, target: Vec3) => void;
  /** Screen right and up directions in world axes. */
  basis: () => { right: Vec3; up: Vec3 };
}
let api: CameraApi | null = null;
export const setCameraApi = (a: CameraApi | null) => { api = a; };
export const cameraApi = () => api;

const DYN_ORDER: DynMode[] = ['rotate', 'pan', 'zoom'];
export const cycleDyn = () => {
  const s = useViewCtl.getState();
  s.set({ dyn: DYN_ORDER[(DYN_ORDER.indexOf(s.dyn) + 1) % DYN_ORDER.length] });
};

/** Which world axis (0..2) a direction mostly points along, and its sign. */
export function dominantAxis(v: Vec3, not: number[] = []): { axis: number; sign: number } {
  let best = -1;
  for (let k = 0; k < 3; k++) if (!not.includes(k) && (best < 0 || Math.abs(v[k]) > Math.abs(v[best]))) best = k;
  return { axis: best, sign: v[best] < 0 ? -1 : 1 };
}

/** Whether the standard view is one of the orthogonal ones. */
export const isOrtho = (v: StdView | null) => v !== null && v !== 'iso';
/** The two world axes in the plane of an orthogonal view. */
export const VIEW_AXES: Record<StdView, number[]> = { front: [1, 2], rear: [1, 2], left: [0, 2], right: [0, 2], top: [0, 1], bottom: [0, 1], iso: [0, 1, 2] };

/** Camera offset direction (from the target) of each standard view; Z is up. */
export const VIEW_DIR: Record<StdView, Vec3> = {
  front: [1, 0, 0], rear: [-1, 0, 0], left: [0, -1, 0], right: [0, 1, 0],
  top: [0, -0.0005, 1], bottom: [0, -0.0005, -1], iso: [-0.62, -0.55, 0.5],
};
