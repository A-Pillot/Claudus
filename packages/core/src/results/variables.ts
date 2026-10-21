/**
 * The result variables of each sweep (SHARK help, "Overview - 3D Suspension Derivatives" and the Theory
 * topic), shared by the graphs, the SDF listings and the spline outputs. Keys are row fields of the sweeps in
 * `derivatives.ts`; vector fields are read by component (`tcpRightX`, `rollCentreZ`) through `rowValue`.
 */
import { rowValue } from '../optimise/lines.js';

export type SweepKind = 'bump' | 'roll' | 'steer';

export interface ResultVar {
  key: string;
  label: string;
  /** Unit key for display conversion: 'deg', 'mm', 'N', '%' or '' for none. */
  unit: string;
  /** Column heading lines for the text listings. */
  head: string[];
  /** Decimal places in text listings. */
  d: number;
}

const v = (key: string, label: string, unit: string, head: string[], d = 4): ResultVar => ({ key, label, unit, head, d });

const xyz = (base: string, label: string, hd: string): ResultVar[] =>
  (['X', 'Y', 'Z'] as const).map((a) => v(base + a, `${label} ${a}`, 'mm', [hd, `${a} COORD`, '(mm)'], 3));

/** The additional incremental values (plus roll centre components) that every sweep offers. */
const WHEEL_EXTRAS: ResultVar[] = [
  v('rollCentreLateral', 'Roll centre lateral', 'mm', ['RC', 'LATERAL', '(mm)'], 2),
  v('rollCentreX', 'Roll centre X', 'mm', ['RC POS', 'X', '(mm)'], 2),
  v('rollCentreY', 'Roll centre Y', 'mm', ['RC POS', 'Y', '(mm)'], 2),
  v('rollCentreZ', 'Roll centre Z', 'mm', ['RC POS', 'Z', '(mm)'], 2),
  ...xyz('tcpRight', 'Right tyre contact patch', 'R TCP'),
  ...xyz('tcpLeft', 'Left tyre contact patch', 'L TCP'),
  ...xyz('hubRight', 'Right hub', 'R HUB'),
  ...xyz('hubLeft', 'Left hub', 'L HUB'),
  v('tyreForce', 'Tyre vertical force', 'N', ['TYRE', 'VERT FORCE', '(N)'], 1),
  v('swingFrontLength', 'Swing arm length (front)', 'mm', ['SWING ARM', 'LEN FRONT', '(mm)'], 2),
  v('swingFrontY', 'Swing arm centre Y (front)', 'mm', ['SWING ARM', 'CTR Y FRNT', '(mm)'], 2),
  v('swingFrontZ', 'Swing arm centre Z (front)', 'mm', ['SWING ARM', 'CTR Z FRNT', '(mm)'], 2),
  v('swingSideLength', 'Swing arm length (side)', 'mm', ['SWING ARM', 'LEN SIDE', '(mm)'], 2),
  v('swingSideX', 'Swing arm centre X (side)', 'mm', ['SWING ARM', 'CTR X SIDE', '(mm)'], 2),
  v('swingSideZ', 'Swing arm centre Z (side)', 'mm', ['SWING ARM', 'CTR Z SIDE', '(mm)'], 2),
  v('tcpGradient', 'TCP dX/dZ gradient', '', ['TCP', 'DX/DZ', '(mm/mm)'], 4),
  v('damper2Ratio', 'Damper 2 ratio', '', ['DAMPER 2', 'RATIO'], 3),
  v('spring2Ratio', 'Spring 2 ratio', '', ['SPRING 2', 'RATIO'], 3),
  v('damper2Travel', 'Damper 2 travel', 'mm', ['DAMPER 2', 'TRAVEL', '(mm)'], 3),
  v('spring2Travel', 'Spring 2 travel', 'mm', ['SPRING 2', 'TRAVEL', '(mm)'], 3),
];

const STEER_AXIS: ResultVar[] = [
  v('toePlane', 'Toe angle (wheel plane)', 'deg', ['TOE (PLANE)', 'ANGLE', '(deg)']),
  v('castor', 'Castor angle', 'deg', ['CASTOR', 'ANGLE', '(deg)']),
  v('kingpin', 'Kingpin angle', 'deg', ['KINGPIN', 'ANGLE', '(deg)']),
  v('castorTrail', 'Castor trail', 'mm', ['CASTOR', 'TRAIL', '(mm)'], 2),
  v('castorOffset', 'Castor offset', 'mm', ['CASTOR', 'OFFSET', '(mm)'], 2),
  v('mechanicalTrail', 'Mechanical trail', 'mm', ['MECHANICAL', 'TRAIL', '(mm)'], 2),
  v('kingpinOffsetWheel', 'Kingpin offset at wheel', 'mm', ['KP OFFSET', 'AT WHEEL', '(mm)'], 2),
  v('kingpinOffsetGround', 'Kingpin offset at ground', 'mm', ['KP OFFSET', 'AT GROUND', '(mm)'], 2),
];

const COMMON: ResultVar[] = [
  v('camber', 'Camber angle', 'deg', ['CAMBER', 'ANGLE', '(deg)']),
  v('toeSae', 'Toe angle (SAE)', 'deg', ['TOE', 'ANGLE', '(deg)']),
  ...STEER_AXIS,
  v('damperRatio', 'Damper ratio', '', ['DAMPER', 'RATIO'], 3),
  v('springRatio', 'Spring ratio', '', ['SPRING', 'RATIO'], 3),
];

const TRAVEL: ResultVar[] = [
  v('halfTrackChange', 'Half track change', 'mm', ['HALF TRACK', 'CHANGE', '(mm)'], 3),
  v('wheelbaseChange', 'Wheelbase change', 'mm', ['WHEELBASE', 'CHANGE', '(mm)'], 3),
  v('damperTravel', 'Damper travel', 'mm', ['DAMPER', 'TRAVEL', '(mm)'], 3),
  v('springTravel', 'Spring travel', 'mm', ['SPRING', 'TRAVEL', '(mm)'], 3),
];

/** Every plottable variable of a sweep, in the order of the SHARK help list. */
export const SWEEP_VARIABLES: Record<SweepKind, { x: ResultVar; ys: ResultVar[] }> = {
  bump: {
    x: v('bump', 'Bump travel', 'mm', ['BUMP', 'TRAVEL', '(mm)'], 2),
    ys: [
      ...COMMON,
      v('antiDive', 'Anti dive', '%', ['ANTI', 'DIVE', '(%)'], 2),
      v('antiSquat', 'Anti squat', '%', ['ANTI', 'SQUAT', '(%)'], 2),
      v('rollCentreToBody', 'Roll centre height to body', 'mm', ['RC HEIGHT', 'TO BODY', '(mm)'], 2),
      v('rollCentreToGround', 'Roll centre height to ground', 'mm', ['RC HEIGHT', 'TO GROUND', '(mm)'], 2),
      ...TRAVEL,
      ...WHEEL_EXTRAS,
    ],
  },
  roll: {
    x: v('roll', 'Roll angle', 'deg', ['ROLL', 'ANGLE', '(deg)'], 2),
    ys: [...COMMON, ...TRAVEL, ...WHEEL_EXTRAS],
  },
  steer: {
    x: v('rack', 'Rack travel', 'mm', ['RACK', 'TRAVEL', '(mm)'], 2),
    ys: [
      v('toeInner', 'Toe angle, inner wheel', 'deg', ['TOE ANGLE', 'INNER', '(deg)']),
      v('toeOuter', 'Toe angle, outer wheel', 'deg', ['TOE ANGLE', 'OUTER', '(deg)']),
      v('camberInner', 'Camber, inner wheel', 'deg', ['CAMBER', 'INNER', '(deg)']),
      v('camberOuter', 'Camber, outer wheel', 'deg', ['CAMBER', 'OUTER', '(deg)']),
      v('steerInner', 'Steer angle, inner wheel', 'deg', ['STEER ANGLE', 'INNER', '(deg)']),
      v('steerOuter', 'Steer angle, outer wheel', 'deg', ['STEER ANGLE', 'OUTER', '(deg)']),
      v('ackermann', 'Ackermann', '%', ['ACKERMANN', '(%)'], 2),
      v('turningRadius', 'Turning radius', 'mm', ['TURNING', 'RADIUS', '(mm)'], 0),
      ...STEER_AXIS,
      ...WHEEL_EXTRAS,
    ],
  },
};

/** A variable's value in a result row, NaN when the row does not have it. */
export const valueOf = (row: unknown, key: string): number => rowValue(row as Parameters<typeof rowValue>[0], key) ?? NaN;

const EXTRA_KEYS = new Set(WHEEL_EXTRAS.map((e) => e.key));
/** True for the additional incremental values (as opposed to the ones SHARK's formatted SDF tables list). */
export const isExtraVariable = (key: string) => EXTRA_KEYS.has(key);
