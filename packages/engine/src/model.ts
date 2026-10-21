// Engine model: the shared, solver-friendly description of an engine network.
// The .sim reader/writer maps Lotus files to and from this; the solver and UI use it directly.
// Units: lengths mm, areas mm^2, volumes cm^3 (cc) unless noted, angles deg crank, temps K,
// pressures bar (absolute), speeds rpm, masses kg.

export type CycleType = 2 | 4;

export interface Cylinder {
  id: number; // 1-based, as in .sim
  label: string;
  bore: number; // mm
  stroke: number; // mm
  conRod: number; // mm
  pinOffset: number; // mm
  compressionRatio: number;
  firingAngle: number; // deg, TDC firing relative to cylinder 1
  /** Raw extra values from the file that the solver does not use yet. */
  extra?: number[];
}

export type FuelType = 'gasoline' | 'diesel' | 'methanol' | 'ethanol' | 'natural-gas' | 'lpg' | 'hydrogen' | 'user';
export type CombustionSystem = 'spark-ignition' | 'direct-injection-diesel' | 'indirect-injection-diesel';

export interface Fuel {
  type: FuelType;
  lowerHeatingValue: number; // J/kg
  hcRatio: number; // H/C atom ratio
  ocRatio: number; // O/C atom ratio
  density: number; // kg/m^3
  system: CombustionSystem;
}

export type BurnModel =
  | { kind: 'wiebe'; a: number; m: number }
  | { kind: 'wiebe2'; premixFraction: number; a1: number; m1: number; a2: number; m2: number }
  | { kind: 'user'; angle: number[]; fraction: number[] }; // angle relative to start of combustion, normalised 0..1 burnt

export type HeatTransferModel =
  | { kind: 'woschni'; scale: number }
  | { kind: 'annand'; a: number; b: number; c: number }
  | { kind: 'eichelberg'; scale: number }
  | { kind: 'none' };

export interface CylinderTemperatures {
  head: number; // K
  piston: number; // K
  liner: number; // K
}

/** Poppet valve. Lift profile either user ordinates or a polynomial/ramp defined by duration and max lift. */
export interface Valve {
  id: number;
  label: string;
  kind: 'intake' | 'exhaust';
  /** Opening angle (deg ATDC firing = 0, 720 cycle) */
  openAngle: number;
  closeAngle: number;
  maxLift: number; // mm
  diameter: number; // mm (inner seat diameter)
  /** Optional explicit lift curve: angle (deg) -> lift (mm). Overrides open/close/maxLift shape. */
  liftCurve?: { angle: number[]; lift: number[] };
  /** Discharge coefficient vs L/D. Defaults used when absent. */
  cd?: { ld: number[]; cd: number[] };
  extra?: number[];
}

export interface Port {
  id: number;
  label: string;
  kind: 'intake' | 'exhaust';
  diameter: number; // mm
  length?: number; // mm
  extra?: number[];
}

export interface Pipe {
  id: number;
  label: string;
  length: number; // mm
  /** Diameter stations along the pipe: x in mm from end 1, d in mm. At least 2 points. */
  stations: { x: number; d: number }[];
  meshLength: number; // mm, target cell length
  wallTemperature: number; // K
  frictionFactor: number;
  bendAngle?: number; // deg total
  extra?: number[];
}

export interface Plenum {
  id: number;
  label: string;
  volume: number; // cc
  wallTemperature?: number; // K
  extra?: number[];
}

export interface Throttle {
  id: number;
  label: string;
  diameter: number; // mm
  /** Throttle angle deg (0 = closed, 90 = WOT) or open-area fraction when kind = 'area'. */
  kind: 'butterfly' | 'area';
  position: number;
  cd: number;
  extra?: number[];
}

export interface Boundary {
  id: number;
  label: string;
  kind: 'inlet' | 'exit';
  pressure: number; // bar
  temperature: number; // K
}

/** A plenum-style junction formed where three or more pipe ends meet. */
export interface Junction {
  id: number;
  label: string;
}

export interface Compressor { id: number; label: string; extra?: number[] }
export interface Turbine { id: number; label: string; extra?: number[] }

export type ElementKind =
  | 'cylinder'
  | 'pipe'
  | 'plenum'
  | 'inlet'
  | 'exit'
  | 'throttle'
  | 'valve'
  | 'port'
  | 'junction'
  | 'compressor'
  | 'turbine'
  | 'cooler';

/** A reference to an element, with pipe end (1 = start, 2 = end) when it is a pipe. */
export interface ElementRef {
  kind: ElementKind;
  id: number;
  end?: 1 | 2;
}

/**
 * One connection line from the .sim CONNECTIONS block. `a` and `b` are the two flow elements joined;
 * `via` lists flow restrictions sitting between them (valve + port for a cylinder, throttle for a plenum link).
 * Pipe-to-pipe connections that share an end form junctions.
 */
export interface Connection {
  a: ElementRef;
  b: ElementRef;
  via: ElementRef[];
}

export interface TestPoint {
  label: string;
  speed: number; // rpm
  /** Air/fuel ratio (by mass). */
  afr: number;
  /** Start of combustion, deg ATDC (negative = BTDC). */
  burnStart: number;
  /** 10-90 or 0-100 burn duration, deg. */
  burnDuration: number;
  ambientPressure: number; // bar
  ambientTemperature: number; // K
  /** Cycles to run (max) and convergence tolerance on cycle-to-cycle IMEP, fraction. */
  maxCycles: number;
  tolerance: number;
  /** Throttle positions keyed by throttle id; missing = model value. */
  throttle?: Record<number, number>;
  extra?: number[];
}

export interface FrictionModel {
  /** Chen-Flynn style FMEP = a + b*pmax + c*Sp + d*Sp^2 (bar, bar, m/s). */
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface EngineModel {
  title: string[];
  name: string;
  cycle: CycleType;
  cylinders: Cylinder[];
  fuel: Fuel;
  burn: BurnModel;
  heatTransfer: HeatTransferModel;
  temperatures: CylinderTemperatures;
  friction: FrictionModel;
  valves: Valve[];
  ports: Port[];
  pipes: Pipe[];
  plenums: Plenum[];
  throttles: Throttle[];
  inlets: Boundary[];
  exits: Boundary[];
  compressors: Compressor[];
  turbines: Turbine[];
  connections: Connection[];
  tests: TestPoint[];
  /** Element positions for the network builder canvas, keyed `${kind}:${id}`. */
  layout: Record<string, { x: number; y: number }>;
  /** Raw .sim sections kept for round-trip of anything not modelled above, keyed by section keyword. */
  raw?: Record<string, string[]>;
}
