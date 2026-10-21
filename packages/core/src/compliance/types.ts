/**
 * Compliance data: bushes, springs, dampers, tyre and roll bar rates, and external force sets.
 * Units follow SHARK: mm, N, N/mm for translational rates, N.m/rad for bush rotational rates,
 * N.mm/deg for roll bar and rigid rotation rates, N.s/mm for dampers.
 */
import type { Vec3 } from '../math/vec3.js';
import type { End } from '../model/types.js';

/** How one of a bush's axis-defining points is given. */
export type AxisRef =
  | { kind: 'none' }
  /** Another hard point of the model, by point number (follows it when it moves). */
  | { kind: 'point'; point: number }
  /** An offset from the bush's own hard point. */
  | { kind: 'rel'; v: Vec3 }
  /** An absolute position. */
  | { kind: 'abs'; v: Vec3 };

export interface BushData {
  /** Template point number of the joint. */
  point: number;
  /** Local stiffnesses: x, y, z (N/mm) and about x, y, z (N.m/rad). */
  stiffness: [number, number, number, number, number, number];
  /** A point on the local z axis. With none, the bush uses the global axes. */
  zAxis: AxisRef;
  /** A point in the local x-z plane. */
  xzPlane: AxisRef;
  /** Damping as a loss angle (deg); the general default when omitted. */
  lossAngle?: number;
}

/** Mass properties of one part (SHARK's C of G data). */
export interface PartMass {
  /** Part number, 1-based. */
  part: number;
  /** Where the C of G is: a template point, or a position; none means the part's centroid. */
  cog: AxisRef;
  /** Points defining the local inertia axes, as for a bush. None means the global axes. */
  zAxis: AxisRef;
  xzPlane: AxisRef;
  /** kg. */
  mass: number;
  /** Ixx, Iyy, Izz, Ixy, Ixz, Iyz about the C of G in the local axes, kg.mm². */
  inertia: [number, number, number, number, number, number];
}

export interface SpringData {
  rate: number; // N/mm
  freeLength: number; // mm
  fittedLength: number; // mm, at the static (input) position
}

/** Compliance data for one end of the vehicle. */
export interface EndCompliance {
  /** Spring 1 and, for twin-spring corners and full axles, spring 2. */
  springs: [SpringData, SpringData];
  /** Damper 1 and 2 rates, N.s/mm. */
  dampers: [number, number];
  /** Roll bar torsional rate, N.mm/deg (only used when the template has a roll bar). */
  rollBarRate: number;
  /** Tyre vertical stiffness, N/mm. */
  tyreRate: number;
  /** Joints with bush properties; every other joint is a rigid ball joint. */
  bushes: BushData[];
  /** Part masses; parts not listed get a default 1 kg (SHARK's default) with a size-based inertia. */
  masses?: PartMass[];
}

export interface ExternalForce {
  label: string;
  on: boolean;
  end: End;
  /** Part (1-based) the force acts on; 0 for the part carrying the wheel centre. */
  part: number;
  /** Point the head and tail are measured from: a point number, or 0 for the tyre contact point. */
  at: number;
  /** Head and tail offsets from that point; the force acts at the head, pointing from tail to head. */
  head: Vec3;
  tail: Vec3;
  magnitude: number; // N
}

export interface ForceSet {
  label: string;
  on: boolean;
  forces: ExternalForce[];
}

export interface ComplianceSettings {
  /** Stiffness that holds otherwise free spins, such as a track rod about its own axis, N/mm. */
  singularity: number;
  /** Translational stiffness of a rigid (ball) joint, N/mm. */
  rigid: number;
  /** Rotational stiffness of a rigid revolute such as a rigid axle's centre joint, N.mm/deg. */
  rigidRotation: number;
  /** Default bush damping loss angle, deg. */
  lossAngle: number;
  /** Include the suspension spring preload as a load. */
  includeSpring: boolean;
}

/** One bar of a force set's coefficient chart: a variable with an optional design limit, scale and weight. */
export interface CoefficientBar {
  key: string;
  /** Design limit drawn as a line across the bar; absent for none. */
  limit?: number;
  /** Full-scale value of the bar; absent to scale to the largest value over the force sets. */
  scale?: number;
  /** Weight in the combined sum. */
  weight: number;
}

export interface ComplianceData {
  front?: EndCompliance;
  rear?: EndCompliance;
  settings: ComplianceSettings;
  /** Set 0 is the interactive set; the rest are standard load cases. */
  forceSets: ForceSet[];
  /** The set shown in the 3D view and graphs. */
  activeSet: number;
  /** The bars shown for each force set (by set index); a set not listed shows every variable with defaults. */
  bars?: CoefficientBar[][];
  /** Session switches from the Solve menu (not saved in the file). */
  switches?: SolveSwitches;
}

/** Solve menu switches for compliant analysis. Absent means the default. */
export interface SolveSwitches {
  /** Suspension roll bar force (default on). */
  rollBar?: boolean;
  /** Bush rotation pre-loads (default off). */
  bushPreload?: boolean;
}

export const defaultSettings = (): ComplianceSettings => ({
  singularity: 10,
  rigid: 1e8,
  rigidRotation: 1e8,
  lossAngle: 3,
  includeSpring: true,
});

export const defaultEndCompliance = (): EndCompliance => ({
  springs: [
    { rate: 41.5, freeLength: 300, fittedLength: 246.5 },
    { rate: 41.5, freeLength: 300, fittedLength: 246.5 },
  ],
  dampers: [0.4, 0.4],
  rollBarRate: 2e6,
  tyreRate: 400,
  bushes: [],
});

/** Default bush stiffness for a joint made compliant in the editor. */
export const defaultBush = (point: number): BushData => ({
  point,
  stiffness: [1000, 1000, 2000, 0, 0, 0],
  zAxis: { kind: 'none' },
  xzPlane: { kind: 'none' },
});

/**
 * Standard load cases at the front tyre contact point (set 0 is left empty for interactive use): 1 kN
 * lateral, longitudinal both ways, and vertical. SHARK's own seven Lotus cases were kept in its ini file,
 * which did not ship, so these are simple unit cases.
 */
export function standardForceSets(): ForceSet[] {
  const at = (label: string, head: Vec3, tail: Vec3, magnitude: number): ExternalForce => ({
    label, on: true, end: 'front', part: 0, at: 0, head, tail, magnitude,
  });
  return [
    { label: 'User set', on: true, forces: [] },
    { label: 'Lateral 1 kN inward at contact', on: true, forces: [at('Lateral', [0, 0, 0], [0, 100, 0], 1000)] },
    { label: 'Longitudinal 1 kN in +X at contact', on: true, forces: [at('Longitudinal +X', [0, 0, 0], [-100, 0, 0], 1000)] },
    { label: 'Longitudinal 1 kN in -X at contact', on: true, forces: [at('Longitudinal -X', [0, 0, 0], [100, 0, 0], 1000)] },
    { label: 'Vertical 1 kN at contact', on: true, forces: [at('Vertical', [0, 0, 0], [0, 0, -100], 1000)] },
  ];
}

export const defaultCompliance = (): ComplianceData => ({
  settings: defaultSettings(),
  forceSets: standardForceSets(),
  activeSet: 0,
});
