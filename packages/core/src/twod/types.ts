/**
 * The 2D module's model: one corner of a suspension drawn in the cross-car (Y-Z) plane.
 *
 * Z is height above the ground plane. The corner is the right-hand one (+Y); the left is its mirror.
 * Of the outer ball joints only the height is stored: their Y positions follow from the track,
 * the kingpin angle and the kingpin offset at the ground (see geometry in solve.ts).
 */
export type P2 = [number, number];

/** 1 = double wishbone, 2 = Macpherson strut. */
export type TwoDType = 1 | 2;

export interface Model2D {
  /** File version line (SHARK writes "1 2"). */
  version: number[];
  type: TwoDType;
  /** Distance between the two tyre contact patch centres, mm. */
  track: number;
  /** Positive when the upper ball joint (or strut top) is inboard of the lower one, deg. */
  kingpinAngle: number;
  /** Contact patch centre minus the kingpin axis ground intersection (positive = patch outboard), mm. */
  kingpinOffset: number;
  /** Strut only: angle of the strut slider axis, positive when the strut top is inboard, deg. */
  damperAngle: number;
  // Targets (SHARK's user line settings). Positive = more positive camber / height with wheel travel.
  camberBump: number; // deg/mm
  camberRebound: number; // deg/mm
  rcStatic: number; // mm
  rcBump: number; // mm/mm
  rcRebound: number; // mm/mm
  camberRoll: number; // deg/deg
  rcRoll: number; // mm/deg
  rcLateralRoll: number; // mm/deg
  /** Roll travel, deg (the only articulation range kept in the file). */
  rollTravel: number;
  lowerOuterZ: number;
  /** Upper ball joint height, or the strut top height for a strut. */
  upperOuterZ: number;
  lowerInner: P2;
  /** Double wishbone only. */
  upperInner: P2;
  /**
   * Y positions of outer points set by a Free solve. The file format cannot hold them, so Claudus writes
   * them in a trailing "CLAUDUS OUTER" section that SHARK ignores.
   */
  outerY?: { lower?: number; upper?: number };
  /** Original text of each number, so unchanged values are written back exactly as read. */
  tokens: string[][];
  /** Lines after the data that Claudus does not use, kept verbatim. */
  extra: string[];
  /** Line ending the file used. */
  eol: string;
}

/** Defaults from the SHARK help's 2D data requirements. */
export function newModel2D(type: TwoDType): Model2D {
  return {
    version: [1, 2],
    type,
    track: 1600,
    kingpinAngle: 10,
    kingpinOffset: 20,
    damperAngle: 10,
    camberBump: -0.04,
    camberRebound: -0.04,
    rcStatic: 50,
    rcBump: 1,
    rcRebound: 1,
    camberRoll: 0.5,
    rcRoll: 0,
    rcLateralRoll: 0,
    rollTravel: 5,
    lowerOuterZ: 200,
    upperOuterZ: 500,
    lowerInner: [248, 175],
    upperInner: [367, 426],
    tokens: [],
    extra: [],
    eol: '\r\n',
  };
}

/** Ranges and step counts for the sweeps. SHARK keeps these in its general data; the file has only the roll travel. */
export interface Sweep2D {
  bumpTravel: number;
  bumpSteps: number;
  reboundTravel: number;
  reboundSteps: number;
  rollSteps: number;
}

export const defaultSweep = (): Sweep2D => ({ bumpTravel: 60, bumpSteps: 4, reboundTravel: 60, reboundSteps: 4, rollSteps: 4 });
