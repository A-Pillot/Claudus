import type { ComplianceData } from '../compliance/types.js';
import type { Vec3 } from '../math/vec3.js';
import type { BodyData, OptimiserFileData } from './extras.js';
import type { Template } from '../template/types.js';

/** General vehicle data (the SHARK "Parameters" data set). */
export interface VehicleParams {
  bumpTravel: number; // mm
  reboundTravel: number; // mm
  bumpIncrement: number; // mm
  rollAngle: number; // deg
  rollIncrement: number; // deg
  steerTravel: number; // mm of rack travel
  steerIncrement: number; // mm
  wheelbase: number; // mm
  cogHeight: number; // mm
  brakeFrontPct: number; // %
  weightFrontPct: number; // %
  driveFrontPct: number; // %
  /** 1 = inboard, 2 = outboard. */
  frontBrakeType: number;
  rearBrakeType: number;
  /** Two more integers on the brake line whose meaning is not documented; kept for round-trips. */
  brakeLineExtra: [number, number];
  /** 1 = independent, 2 = rigid. */
  frontSuspensionType: number;
  rearSuspensionType: number;
  suspLineExtra: [number, number];
}

export type End = 'front' | 'rear';

/** One end of the car: a template plus its hard points (right-hand side, +Y). */
export interface SuspensionData {
  templateSlot: number;
  /** Hard points in template order. */
  points: Vec3[];
  /** Tyre rolling radius, mm. */
  rollingRadius: number;
}

/** A named set of points, as in SHARK's GROUPS section. */
export interface PointGroup {
  label: string;
  members: { point: number; end: number }[];
}

/** A file section Claudus does not interpret yet. Kept verbatim so files round-trip. */
export interface RawSection {
  name: string;
  lines: string[];
}

/** One step of the combined motion path: a bump (+) / rebound (-) travel with a rack position. */
export interface CombinedStep {
  bump: number; // mm
  rack: number; // mm
}

/** The combined bump and steer path (SHARK's COMBINED section), used for ball joint and wheel envelope analysis. */
export interface CombinedProfile {
  steps: CombinedStep[];
}

/** The prescribed list of bump positions used instead of even increments (SHARK's EXTENDED BUMP section). */
export interface ExtendedBump {
  use: boolean;
  steps: { bump: number; label: string }[];
}

/** Point limit box: the lowest and highest coordinate the point may take on each axis, mm. */
export interface PointLimit {
  min: Vec3;
  max: Vec3;
}

/** Steering mechanism of one end. A box needs three more points (SHARK's points 101 to 103). */
export interface SteeringData {
  type: 'rack' | 'box';
  /** First and second point on the box axis, and the pitman joint. */
  points: [Vec3, Vec3, Vec3];
}

export interface Model {
  /** File format version and module number from the VERSION section, plus any extra lines. */
  version: number[];
  versionExtra: string[];
  params: VehicleParams;
  front?: SuspensionData;
  rear?: SuspensionData;
  tolerances: number[];
  titles: string[];
  /** Tyre widths: front left, front right, rear left, rear right (mm). */
  tyreWidths: number[];
  rollSolution: number;
  groups: PointGroup[];
  /** Steering type and box points per end; absent means a rack. Kept in Claudus's own file section. */
  steering?: { front?: SteeringData; rear?: SteeringData };
  combined?: CombinedProfile;
  extendedBump?: ExtendedBump;
  /** Point limit boxes per end, by data point index; a missing entry means the default tolerance. */
  limits?: { front?: PointLimit[]; rear?: PointLimit[] };
  /**
   * Templates saved with the model (SHARK's Setup / Include User Templates In Data Files), so a model built
   * on an edited or custom template opens anywhere.
   */
  templates?: Template[];
  /** Bushes, springs, dampers and force sets for compliant analysis (SHARK's COMPLIANCE section and Claudus extras). */
  compliance?: ComplianceData;
  /** Body graphics (Claudus section; SHARK's own BODY section is kept as it was). */
  body?: BodyData;
  /** Optimiser set-up saved with the file (Include Optimiser Settings in Data Files). */
  optimiser?: OptimiserFileData;
  /** Order of sections as read, so a written file keeps the same layout. */
  sectionOrder: string[];
  raw: RawSection[];
}

export const defaultParams = (): VehicleParams => ({
  bumpTravel: 60,
  reboundTravel: 60,
  bumpIncrement: 5,
  rollAngle: 3,
  rollIncrement: 0.25,
  steerTravel: 30,
  steerIncrement: 2,
  wheelbase: 2240,
  cogHeight: 60,
  brakeFrontPct: 60,
  weightFrontPct: 40,
  driveFrontPct: 0,
  frontBrakeType: 2,
  rearBrakeType: 2,
  brakeLineExtra: [2, 2],
  frontSuspensionType: 1,
  rearSuspensionType: 1,
  suspLineExtra: [1, 1],
});
