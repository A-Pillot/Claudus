import type { Vec3 } from '../math/vec3.js';

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
