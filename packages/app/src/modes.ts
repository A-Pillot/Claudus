/**
 * Session settings for the Solve and Data menus that are not part of the data file: moving ground or body,
 * error reporting, compliance switches, how a second axle is fitted, limit box display and the point chosen
 * for tolerance analysis. Also which of their dialogs is open.
 */
import { create } from 'zustand';
import { defaultAxleFit, type AxleFitOptions, type End } from '@claudus/core';

export type ModeDialog =
  | 'static' | 'combined' | 'extended' | 'steering' | 'boxCoords'
  | 'solverTol' | 'tolPoint' | 'pointTol' | 'allTol';

export interface ModesState {
  /** Solve / Motion (bump only): the ground plane moves, or the body does. */
  motion: 'ground' | 'body';
  /** Solve / Report Errors: show a message when the solver cannot reach a position. */
  reportErrors: boolean;
  /** Solve / Suspension Roll Bar Force (compliant analysis). */
  rollBar: boolean;
  /** Solve / Bush Rotation Pre-loads (compliant analysis). */
  bushPreload: boolean;
  /** Wheelbase and ground plane difference solutions, used when a second axle is added. */
  axleFit: AxleFitOptions;
  /** Graphics / Point Limits. 'use' only holds while 'visible' does. */
  limitsVisible: boolean;
  limitsUse: boolean;
  /** Point tolerance analysis: on or off, and the point it runs on. */
  tolOn: boolean;
  tolPoint: { end: End; index: number } | null;
  /** Position along the combined motion path, in steps (fractions run between neighbouring steps). */
  combinedPos: number;
  dialog: ModeDialog | null;
  set: (p: Partial<ModesState>) => void;
}

export const useModes = create<ModesState>((set) => ({
  motion: 'ground',
  reportErrors: true,
  rollBar: true,
  bushPreload: false,
  axleFit: defaultAxleFit(),
  limitsVisible: false,
  limitsUse: false,
  tolOn: false,
  tolPoint: null,
  combinedPos: 0,
  dialog: null,
  set: (p) =>
    set((s) => {
      const next = { ...s, ...p };
      // Limit boxes can only be in use while visible.
      if (!next.limitsVisible) next.limitsUse = false;
      return next;
    }),
}));
