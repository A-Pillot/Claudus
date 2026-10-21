/**
 * Target ("user line") curves for the 2D graphs, and the full set of results the graphs plot.
 *
 * SHARK starts each user line from the slopes in the 2D general data and lets the user edit it later.
 * Here a user line is a list of [x, y] points joined by straight lines.
 */
import type { Model2D, Sweep2D } from './types.js';
import { bumpSweep2D, geometry2D, rollSweep2D, type BumpResult, type Geo2D, type RollResult } from './solve.js';

export type LineKey = 'camberBump' | 'rcBump' | 'camberRoll' | 'rcRoll' | 'rcLateralRoll';
export type XY = [number, number];
export type UserLines = Record<LineKey, XY[]>;

/** The default user lines: straight lines through the static value with the slopes from the general data. */
export function userLinesFromModel(m: Model2D, s: Sweep2D): UserLines {
  const rb = s.reboundTravel;
  const bt = s.bumpTravel;
  const r = m.rollTravel;
  // Rebound travel is negative wheel travel; the rebound slopes apply to it.
  return {
    camberBump: [[-rb, -rb * m.camberRebound], [0, 0], [bt, bt * m.camberBump]],
    rcBump: [[-rb, m.rcStatic - rb * m.rcRebound], [0, m.rcStatic], [bt, m.rcStatic + bt * m.rcBump]],
    camberRoll: [[-r, -r * m.camberRoll], [0, 0], [r, r * m.camberRoll]],
    rcRoll: [[-r, m.rcStatic - r * m.rcRoll], [0, m.rcStatic], [r, m.rcStatic + r * m.rcRoll]],
    rcLateralRoll: [[-r, -r * m.rcLateralRoll], [0, 0], [r, r * m.rcLateralRoll]],
  };
}

/** Value of a user line at x. Outside the line's range the nearest segment is extended. */
export function evalLine(line: XY[], x: number): number {
  if (line.length === 0) return NaN;
  if (line.length === 1) return line[0][1];
  let i = 1;
  while (i < line.length - 1 && x > line[i][0]) i++;
  const [x0, y0] = line[i - 1];
  const [x1, y1] = line[i];
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Order a line by ascending x, as SHARK does when a user line is closed after editing. */
export const sortLine = (line: XY[]): XY[] => [...line].sort((a, b) => a[0] - b[0]);

export interface Results2D {
  bump: BumpResult[];
  roll: RollResult[];
  /** Static roll centre height above the ground. */
  rcStatic: number;
}

/** Bump and roll sweeps of a model. */
export function analyse2D(m: Model2D, sweep: Sweep2D, geo: Geo2D = geometry2D(m)): Results2D {
  const bump = bumpSweep2D(geo, sweep);
  const roll = rollSweep2D(geo, m.rollTravel, sweep.rollSteps);
  return { bump, roll, rcStatic: bump.find((b) => b.bump === 0)?.rcHeight ?? NaN };
}
