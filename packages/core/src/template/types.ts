import type { Vec3 } from '../math/vec3.js';

/** Part number for the vehicle body / ground, as in SHARK. */
export const GROUND = -1;
/** "No part" marker for an unused part2 column. */
export const NONE = 0;

/**
 * SHARK point "general types" (template settings columns 12-13).
 * Numbers match the original program so template files stay compatible.
 */
export enum GenType {
  None = 0,
  WheelCentre = 1,
  StubAxle = 2,
  SteeringAttachment = 3,
  Damper1ToSuspension = 4,
  Damper1ToBody = 5, // also strut top
  Spring1ToSuspension = 6,
  Spring1ToBody = 7,
  UpperBallJoint = 8,
  LowerBallJoint = 9,
  StrutSliderPoint = 10,
  StrutEndPoint = 11,
  RollBarBarAttachment = 12,
  RollBarAxisPoint = 13,
  RollBarLinkAttachment = 14,
  RackLateralMount = 15,
  RackMount = 16,
  WheelCentre2 = 17,
  Damper2ToSuspension = 18,
  Damper2ToBody = 19,
  Spring2ToSuspension = 20,
  Spring2ToBody = 21,
  RigidAxleRevolute = 22,
  StubAxle2 = 23,
  ShearPoint = 24,
  PartCofG = 25,
  UpperBallJoint2 = 26,
  LowerBallJoint2 = 27,
  StrutSliderPoint2 = 28,
  StrutEndPoint2 = 29,
  RollBarLinkAttachment2 = 32,
  SteeringAttachment2 = 33,
  RollBarRevolute = 34,
}

/** SHARK point solution types (template settings column 2). Kept for file round-trips. */
export enum PointType {
  DummyAxis = -1,
  ToBody = 0,
  SolveDirectSphere = 1,
  SolvePostVector = 2,
  DefineZWheelCentre = 3,
  SolveDirectSliderConn = 4,
  SolvePostStubAxle = 5,
  SolveDirectSliderBottom = 6,
  SolveHookes = 7,
  SolvePostSphere = 8,
  PreSolveKineFix = 9,
}

/** A dummy point sits `offset` mm from point `at`, in the direction from point dir[0] to point dir[1]. */
export interface DummySpec {
  at: number;
  dir: [number, number];
  offset: number;
}

export interface TemplatePoint {
  /** Point number used in data files and labels (not necessarily its index). */
  no: number;
  label: string;
  /** Default coordinates for a new model, mm, right-hand (+Y) corner. */
  def: Vec3;
  /** First part the point belongs to (1-based part index, GROUND = -1). */
  part1: number;
  /** Second part (NONE = 0 when the point is on one part only). */
  part2: number;
  gen1: GenType;
  gen2: GenType;
  /** Bush number (0 = none). Joints between two parts or a part and ground carry a bush. */
  bush?: number;
  /** SHARK solution type; Claudus' solver does not need it but keeps it for file compatibility. */
  pointType?: PointType;
  refs?: number[];
  /** Text used to find this point in an Adams subsystem file. */
  adamsLabel?: string;
  /**
   * A construction point that is not stored in model files (SHARK's "dummy axis" points), used to turn a
   * shared ball joint into a revolute. Dummy points always come after the data points.
   */
  dummy?: DummySpec;
}

export type GraphicKind =
  | 'line' | 'pivot' | 'tube' | 'facet3' | 'facet4' | 'cylinder' | 'circle' | 'sphere' | 'plane'
  | 'distance' | 'components' | 'angle';

export interface GraphicElement {
  kind: GraphicKind;
  /** Point numbers the element is drawn between. */
  points: number[];
  props?: number[];
  colour?: number;
}

export interface Template {
  slot: number;
  label: string;
  /** Part labels, index 0 = part 1. By SHARK convention the upright is last. */
  parts: string[];
  points: TemplatePoint[];
  graphics: GraphicElement[];
  /** True when the template models both wheels of an axle (rigid axles, full-axle conversions). */
  fullAxle?: boolean;
  /** Where the template came from. */
  source?: 'builtin' | 'user' | 'custom' | 'file';
}

/** The points stored in model files, in file order (everything except dummy points). */
export const dataPoints = (t: Template): TemplatePoint[] => t.points.filter((p) => !p.dummy);

export const hasGen = (p: TemplatePoint, g: GenType): boolean => p.gen1 === g || p.gen2 === g;

export const findGen = (t: Template, g: GenType): TemplatePoint | undefined => t.points.find((p) => hasGen(p, g));

export const isSteerable = (t: Template): boolean => findGen(t, GenType.SteeringAttachment) !== undefined;
