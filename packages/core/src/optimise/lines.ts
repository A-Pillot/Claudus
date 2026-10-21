/**
 * User lines (target curves drawn on the results graphs) and the deviation of a result from them.
 */
import { mirrorY } from '../math/vec3.js';
import type { End } from '../model/types.js';
import type { BumpRow, RollRow, SteerRow } from '../results/derivatives.js';

export type Sweep = 'bump' | 'roll' | 'steer';

/** Which corner of an end: right (+Y, the default) or left (-Y). */
export type Side = 'right' | 'left';

/** A target curve for one graph: a y variable against a sweep, for one end's +Y or -Y corner. */
export interface UserLine {
  sweep: Sweep;
  variable: string;
  end: End;
  /** Absent means right (+Y). */
  side?: Side;
  /** (x, y) pairs, x ascending. */
  points: [number, number][];
}

/** A saved set of user lines (SHARK's Manage User Lines data set entry). */
export interface UserLineSet {
  label: string;
  lines: UserLine[];
}

export const lineKey = (l: Pick<UserLine, 'sweep' | 'variable' | 'end' | 'side'>) =>
  `${l.end}${l.side === 'left' ? '-' : ''}:${l.sweep}:${l.variable}`;

/** Sort a user line's points into ascending x, as SHARK does when its editor closes. */
export const sortUserLine = (l: UserLine): UserLine => ({ ...l, points: [...l.points].sort((a, b) => a[0] - b[0]) });

/** Linear interpolation on a polyline; undefined outside its x range. */
export function interpolate(points: [number, number][], x: number): number | undefined {
  if (points.length === 0) return undefined;
  if (points.length === 1) return points[0][0] === x ? points[0][1] : undefined;
  if (x < points[0][0] || x > points[points.length - 1][0]) return undefined;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

type Row = BumpRow | RollRow | SteerRow;

export const sweepX = (sweep: Sweep, row: Row): number =>
  sweep === 'bump' ? (row as BumpRow).bump : sweep === 'roll' ? (row as RollRow).roll : (row as SteerRow).rack;

/** A graph variable from a result row: a row field, a roll centre component, or a measurement element. */
export function rowValue(row: Row, variable: string): number | undefined {
  const r = row as unknown as Record<string, unknown>;
  // Vector fields are read by component: rollCentreX, tcpRightZ, hubLeftY...; the lateral roll centre is its Y.
  const m = /^(.+)([XYZ])$/.exec(variable === 'rollCentreLateral' ? 'rollCentreY' : variable);
  if (m && Array.isArray(r[m[1]])) return (r[m[1]] as number[])['XYZ'.indexOf(m[2])];
  const v = r[variable];
  if (typeof v === 'number') return v;
  return row.measures?.[variable];
}

/**
 * The left-hand (-Y) corner's results, from the right-hand rows (which are in the right-hand convention).
 * Bump is the same on both sides. In roll the left wheel at roll r is the right wheel at -r, so the x axis
 * flips and the roll centre Y mirrors. Steer results are inner/outer wheel values, the same for both sides.
 */
export function leftRows<R extends Row>(rows: R[], sweep: Sweep): R[] {
  if (sweep !== 'roll') return rows;
  return (rows as RollRow[])
    .map((r) => ({
      ...r,
      roll: -r.roll,
      rollCentre: [r.rollCentre[0], -r.rollCentre[1], r.rollCentre[2]] as RollRow['rollCentre'],
      // The mirrored vehicle's right wheel is the original left wheel mirrored.
      tcpRight: mirrorY(r.tcpLeft),
      tcpLeft: mirrorY(r.tcpRight),
      hubRight: mirrorY(r.hubLeft),
      hubLeft: mirrorY(r.hubRight),
      tyreForce: r.tyreForceLeft,
      tyreForceLeft: r.tyreForce,
    }))
    .sort((a, b) => a.roll - b.roll) as unknown as R[];
}

/** The result rows a user line on the given side is compared with. */
export const rowsForSide = <R extends Row>(rows: R[], sweep: Sweep, side?: Side): R[] => (side === 'left' ? leftRows(rows, sweep) : rows);

/**
 * SHARK's graph deviation: the average difference between the data line and the user line over the
 * calculated positions that the user line covers. Undefined when they do not overlap.
 */
export function deviation(rows: Row[], line: UserLine): number | undefined {
  let sum = 0;
  let n = 0;
  for (const row of rowsForSide(rows, line.sweep, line.side)) {
    const y = rowValue(row, line.variable);
    const target = interpolate(line.points, sweepX(line.sweep, row));
    if (y === undefined || target === undefined || !Number.isFinite(y)) continue;
    sum += Math.abs(y - target);
    n++;
  }
  return n ? sum / n : undefined;
}

/** A user line copied from the current data (SHARK's "copy data line to user line"). */
export function lineFromData(rows: Row[], sweep: Sweep, variable: string, end: End, side: Side = 'right'): UserLine {
  const points = rowsForSide(rows, sweep, side)
    .map((r) => [sweepX(sweep, r), rowValue(r, variable)] as [number, number | undefined])
    .filter((p): p is [number, number] => p[1] !== undefined && Number.isFinite(p[1]));
  return sortUserLine({ sweep, variable, end, ...(side === 'left' ? { side } : {}), points });
}
