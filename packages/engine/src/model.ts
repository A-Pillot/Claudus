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
  /** Valve mechanism; absent or 'poppet' = lift-curve poppet valve. Two-stroke types carry their own data below. */
  type?: ValveType;
  piston?: PistonPortData;
  disc?: DiscValveData;
  reed?: ReedValveData;
  extra?: number[];
}

export type ValveType = 'poppet' | 'reed' | 'disc' | 'piston-port';

/** Port uncovered by the piston (crank-slider of its own). Angles deg ATDC firing. */
export interface PistonPortData {
  width: number; // mm
  height: number; // mm, maximum port height
  stroke: number; // mm
  conRod: number; // mm
  openAngle: number; // deg ATDC, port opens (symmetric about BDC)
  cd: number; // at maximum area; 1.0 at zero area, linear in between
}

/** Rotary disc valve. Angles deg ATDC firing (crankshaft speed). */
export interface DiscValveData {
  discDiameter: number; // mm
  portDiameter: number; // mm
  openAngle: number;
  closeAngle: number;
  cd: number;
}

/** Self-acting reed valve (spring-mass petal). */
export interface ReedValveData {
  dynamic: boolean; // false = quasi-static lift
  petals: number;
  mass: number; // g, one petal
  stiffness: number; // N/mm
  petalArea: number; // mm^2, pressure area of one petal
  passageLength: number; // mm, per petal
  cd: number; // at max lift (1.0 at zero lift)
  maxLift: number; // mm
}

/** In-cylinder scavenging model (flow-composition of the gas leaving the cylinder). */
export interface ScavengeModel {
  kind: 'perfect-mixing' | 'perfect-displacement' | 'benson-brandham' | 'blair';
  /** B&B: scavenge ratio up to which displacement applies; Blair constants A, B, C. */
  a: number;
  b: number;
  c: number;
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
  /** Varying-volume plenum (crankcase): equivalent crank-slider. Angles deg ATDC firing of the crankshaft. */
  varying?: { bore: number; stroke: number; conRod: number; compressionRatio: number; tdcAngle: number; speedRatio: number };
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

/** Turbo machine characteristic: constant speed lines of flow, pressure ratio and efficiency (SAE J1826 style). */
export interface TurboMap {
  /** Speed of each line (compressor: corrected rpm; turbine: rpm/sqrt(K)), ascending. */
  speed: number[];
  /** Per speed line: flow (compressor kg/s corrected; turbine kg*sqrt(K)/s/kPa), pressure ratio, efficiency; ascending flow. */
  flow: number[][];
  pr: number[][];
  eff: number[][];
  /** Scale factors applied to the map (speed, flow, pressure ratio above 1, efficiency). */
  scale: { speed: number; flow: number; pr: number; eff: number };
}

export interface Compressor {
  id: number;
  label: string;
  inletDia?: number; // mm
  outletDia?: number; // mm
  inertia?: number; // kg.m^2
  gearRatio?: number; // to shaft
  mechEff?: number;
  map?: TurboMap;
  /** Positive displacement (Roots type) supercharger instead of a map compressor; use drive 'crank'. */
  positive?: PositiveDisplacement;
  /** Optional drive: 'turbo' (default, via shaft), 'crank' (fixed ratio to crank speed) or 'fixed' rpm. */
  drive?: { kind: 'turbo' } | { kind: 'crank'; ratio: number } | { kind: 'fixed'; rpm: number };
  extra?: number[];
}
export interface Turbine {
  id: number;
  label: string;
  inletDia?: number;
  outletDia?: number;
  inertia?: number;
  gearRatio?: number;
  mechEff?: number;
  map?: TurboMap;
  extra?: number[];
}

/** Positive displacement supercharger data (programmatic only; the .sim layout of this element is unknown). */
export interface PositiveDisplacement {
  swept: number; // litres per revolution
  /** Pressure ratio table with volumetric, adiabatic and isentropic efficiencies. */
  pr: number[];
  volEff: number[];
  adiabaticEff: number[];
  isentropicEff: number[];
}

/** Charge cooler: quasi-static pressure loss, coolant temperature and effectiveness vs mass flow. */
export interface Cooler {
  id: number;
  label: string;
  massFlow: number[]; // kg/s, first = 0
  pressureLoss: number[]; // bar, first = 0
  coolantTemp: number[]; // K
  effectiveness: number[];
}

export interface Shaft { id: number; label: string; inertia: number /* kg.m^2 */ }

/** Sensor: reads one result from a component. `quantity` is the decoded meaning. */
export interface Sensor {
  id: number;
  label: string;
  quantity: 'plenum-pressure' | 'engine-speed' | 'turbo-speed' | 'throttle-area' | 'unknown';
  element: number; // id of the sensed element (plenum, turbo, throttle)
  header: number[]; // raw header numbers
}
export interface Actuator {
  id: number;
  label: string;
  target: 'throttle-area' | 'unknown';
  element: number;
  header: number[];
}
export type Control =
  | { kind: 'function'; label: string; expr: string; dim: 1 | 2 }
  | { kind: 'limit'; label: string; max: number; min: number }
  | { kind: 'lookup'; label: string; x: number[]; y: number[] }
  | { kind: 'integrator'; label: string; wrt: number; period: number }
  | { kind: 'limit-change'; label: string; wrt: number; type: number; rate: number }
  | { kind: 'unknown'; label: string; code: number };

/** Decoded turbo / control data of a model (derived from the raw .sim sections). */
export interface TurboModel {
  coolers: Cooler[];
  shafts: Shaft[];
  /** Mechanical links between elements, e.g. a compressor and a turbine on one shaft. */
  links: { a: ElementRef; b: ElementRef }[];
  sensors: Sensor[];
  actuators: Actuator[];
  controls: Control[];
}

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
  /** Boundary conditions per inlet / exit boundary (pressure bar abs, temperature K), in element order. */
  boundary?: { inlets: { pressure: number; temperature: number }[]; exits: { pressure: number }[] };
  /** Ambient specific humidity (kg/kg) as stored in the .sim file. */
  humidity?: number;
  /** User-specified friction mean effective pressure (bar), when the file gives one. */
  fmep?: number;
  /** Injected fuel per cylinder per cycle (mm^3), when fuelling is given as a quantity (diesel); overrides afr. */
  fuelPerInjection?: number;
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
  /** In-cylinder scavenging model; absent = perfect mixing. */
  scavenge?: ScavengeModel;
  valves: Valve[];
  ports: Port[];
  pipes: Pipe[];
  plenums: Plenum[];
  throttles: Throttle[];
  inlets: Boundary[];
  exits: Boundary[];
  compressors: Compressor[];
  turbines: Turbine[];
  /** Turbo machinery extras (coolers, shafts, links, sensors, actuators, controls); optional. */
  turbo?: TurboModel;
  connections: Connection[];
  tests: TestPoint[];
  /** Element positions for the network builder canvas, keyed `${kind}:${id}`. */
  layout: Record<string, { x: number; y: number }>;
  /** Raw .sim sections kept for round-trip of anything not modelled above, keyed by section keyword. */
  raw?: Record<string, string[]>;
  /** Section keyword order of the parsed file (for writeSim). */
  rawOrder?: string[];
}
