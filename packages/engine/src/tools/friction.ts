// Friction estimator: FMEP-vs-speed correlations (excluding pumping work) and Chen-Flynn fitting.
//
// The correlations follow the structure of the published models named in the Lotus help (Patton/Nitschke/
// Heywood, Sandoval & Heywood, Howard/Barnes/Moss, Millington & Hartles, Honda). The original equations are
// not available as text, so the coefficients below are reconstructed to give typical magnitudes
// (about 1 to 1.5 bar FMEP at 3000 rpm for a 2 L four-cylinder spark-ignition engine).
import type { FrictionModel } from '../model';
import { numbersIn, polyFit } from './numeric';

export type FrictionModelName = 'patton' | 'sandoval' | 'hbm' | 'millington' | 'honda' | 'honda-mod';
export type FollowerType = 'flat' | 'roller';
/** 1 direct acting bucket, 2 finger follower, 3 rocker arm, 4 pushrod (scales the oscillating friction). */
export type ValvetrainType = 1 | 2 | 3 | 4;

export interface FrictionInput {
  title: string;
  bore: number; // mm
  stroke: number; // mm
  compressionRatio: number;
  cylinders: number;
  mainBearings: number;
  /** Main bearing diameter/length in mm; undefined = estimated from the bore. */
  mainDiameter?: number;
  mainLength?: number;
  crankpinDiameter?: number;
  crankpinLength?: number;
  valvetrain: ValvetrainType;
  follower: FollowerType;
  valvesPerCylinder: number;
  maxValveLift: number; // mm
  camBearingDiameter?: number;
  camBearingLength?: number;
  startRpm: number;
  endRpm: number;
  stepRpm: number;
  /** Scales cylinder pressure (ring gas loading). */
  loadRatio: number;
  /** Intake manifold and ambient pressure for the ring gas loading, bar. */
  intakePressure?: number;
  ambientPressure?: number;
  /** Oil temperature, C, for the viscosity scaling in the Sandoval-Heywood model (reference 90 C). */
  oilTemperature?: number;
  /** Cycle: strokes per cycle. */
  cycle?: 2 | 4;
}

export function defaultFrictionInput(): FrictionInput {
  return {
    title: 'FRICTION ESTIMATE', bore: 86, stroke: 86, compressionRatio: 10, cylinders: 4, mainBearings: 5,
    valvetrain: 2, follower: 'flat', valvesPerCylinder: 4, maxValveLift: 9,
    startRpm: 1000, endRpm: 7000, stepRpm: 500, loadRatio: 1,
  };
}

/** Parse a .fri friction input file. 9999 marks "use the default estimate". */
export function parseFrictionFile(text: string): FrictionInput {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim().length);
  const title = lines[0].trim();
  const rows = lines.slice(1).map((l) => numbersIn(l));
  const d = defaultFrictionInput();
  const g = rows[0] ?? [];
  const pair = (r: number[] | undefined): [number | undefined, number | undefined] =>
    r && r.length >= 2 && r[0] < 9000 ? [r[0], r[1]] : [undefined, undefined];
  const [md, ml] = pair(rows[1]);
  const [cd, cl] = pair(rows[2]);
  const v = rows[3] ?? [];
  const [cbd, cbl] = pair(rows[4]);
  const load = rows[5] ?? [];
  return {
    ...d, title,
    bore: g[0] ?? d.bore, stroke: g[1] ?? d.stroke, compressionRatio: g[2] ?? d.compressionRatio,
    cylinders: g[3] ?? d.cylinders, mainBearings: g[4] ?? d.mainBearings,
    mainDiameter: md, mainLength: ml, crankpinDiameter: cd, crankpinLength: cl,
    valvetrain: ([1, 2, 3, 4].includes(v[0]) ? v[0] : 2) as ValvetrainType,
    follower: v[1] === 2 ? 'roller' : 'flat',
    valvesPerCylinder: v[2] ?? d.valvesPerCylinder, maxValveLift: v[3] ?? d.maxValveLift,
    camBearingDiameter: cbd, camBearingLength: cbl,
    startRpm: load[0] ?? d.startRpm, endRpm: load[1] ?? d.endRpm, stepRpm: load[2] ?? d.stepRpm,
    loadRatio: load[3] ?? 1,
  };
}

/** Bearing sizes: user values or estimates from the bore. */
export function bearingSizes(f: FrictionInput) {
  const b = f.bore;
  return {
    mainD: f.mainDiameter ?? 0.64 * b, mainL: f.mainLength ?? 0.26 * b,
    pinD: f.crankpinDiameter ?? 0.56 * b, pinL: f.crankpinLength ?? 0.23 * b,
    camD: f.camBearingDiameter ?? 0.32 * b, camL: f.camBearingLength ?? 0.19 * b,
  };
}

/** Mean piston speed, m/s. */
export const pistonSpeedMean = (strokeMm: number, rpm: number) => (2 * strokeMm * rpm) / 60000;

/** Oil viscosity ratio relative to 90 C (simple Arrhenius form). */
function viscosityRatio(oilC: number | undefined): number {
  if (oilC === undefined) return 1;
  return Math.exp(3200 * (1 / (oilC + 273.15) - 1 / 363.15));
}

/** Total swept volume, litres. */
export const sweptLitres = (f: FrictionInput) => (Math.PI / 4) * f.bore * f.bore * f.stroke * f.cylinders * 1e-6;

export interface FrictionBreakdown { rotating: number; reciprocating: number; valvetrain: number; auxiliary: number; total: number }

/** Component breakdown (kPa) of the Patton-type model at one speed; visc scales the hydrodynamic terms. */
function pattonComponents(f: FrictionInput, rpm: number, visc: number, variant: 'patton' | 'sandoval'): FrictionBreakdown {
  const { mainD, mainL, pinD, pinL, camD, camL } = bearingSizes(f);
  const B = f.bore, S = f.stroke, nc = f.cylinders, N = rpm;
  const sp = pistonSpeedMean(S, N);
  const vol = B * B * S * nc; // proportional to swept volume
  const pi = (f.intakePressure ?? 1) * f.loadRatio, pa = f.ambientPressure ?? 1;
  const sv = variant === 'sandoval' ? 0.96 : 1;

  const seal = (12000 * mainD * mainD) / vol;
  const lube = visc * 0.045 * N * mainL * f.mainBearings * mainD * mainD / vol;
  const turb = 1.0e-5 * N * N * mainD ** 3 / vol;
  const rotating = seal + lube + turb;

  const pistonHyd = visc * 0.18 * sp * sp * (86 / B);
  const pistonMixed = 21 / (N / 1000);
  const ringBase = 3.6 * (1 + 1000 / N) * (86 / B);
  const ringGas = 0.9 * (pi / pa) * f.compressionRatio * (variant === 'sandoval' ? 1.05 : 1);
  const rod = visc * 0.036 * N * pinL * nc * pinD * pinD / vol;
  const reciprocating = sv * (pistonHyd + pistonMixed) + ringBase + ringGas + rod;

  const nv = f.valvesPerCylinder * nc;
  const camBearing = 0.04 * N * camL * f.mainBearings * camD * camD / vol;
  const cam = f.follower === 'flat'
    ? 7200 * (1 + 1000 / N) * nv / (nc * B * S)
    : 1.589 * N * nv / (nc * B * S);
  const typeMixed = [0, 1.0, 0.8, 1.15, 1.3][f.valvetrain];
  const lift = f.maxValveLift;
  const oscHyd = visc * 5 * Math.sqrt(N) * nv * Math.pow(lift, 1.5) / (nc * B * S);
  const oscMixed = typeMixed * 1500 * (1000 / N) * nv * lift / (nc * B * S);
  const valvetrain = camBearing + cam + oscHyd + oscMixed;

  const aconst = Math.max(0.5, 2.2 / Math.sqrt(sweptLitres(f)));
  const auxiliary = (0.5 + 0.002 * N + 0.5e-7 * N * N) * aconst;

  const total = rotating + reciprocating + valvetrain + auxiliary;
  return { rotating, reciprocating, valvetrain, auxiliary, total };
}

/** Friction model FMEP in bar at a speed. */
export function frictionFmep(model: FrictionModelName, f: FrictionInput, rpm: number): number {
  const sp = pistonSpeedMean(f.stroke, rpm);
  const n = rpm / 1000;
  switch (model) {
    case 'patton': return pattonComponents(f, rpm, 1, 'patton').total / 100;
    case 'sandoval': return pattonComponents(f, rpm, viscosityRatio(f.oilTemperature), 'sandoval').total / 100;
    case 'hbm': return 0.42 + 0.075 * n + 0.0055 * sp * sp;
    case 'millington': return 0.28 + 0.012 * f.compressionRatio + 0.09 * n + 0.0045 * sp * sp;
    case 'honda':
    case 'honda-mod': {
      const { mainD, pinD } = bearingSizes(f);
      const nbb = f.cylinders;
      const cmd = (mainD * f.mainBearings + pinD * nbb) / (f.mainBearings + nbb);
      const nde = Math.pow(cmd / f.bore, 2) * Math.sqrt(f.stroke / f.bore);
      return model === 'honda' ? nde * (1.0 + 0.7 * n) : nde * (1.1 + 0.45 * n + 0.1 * n * n);
    }
  }
}

/** Component breakdown for the Patton model (kPa) at a speed, for display. */
export function pattonBreakdown(f: FrictionInput, rpm: number): FrictionBreakdown {
  return pattonComponents(f, rpm, 1, 'patton');
}

export const FRICTION_MODEL_LABELS: Record<FrictionModelName, string> = {
  patton: 'Patton, Nitschke & Heywood (SI)',
  sandoval: 'Sandoval & Heywood (SI)',
  hbm: 'Howard, Barnes & Moss (SI)',
  millington: 'Millington & Hartles (Diesel)',
  honda: 'Honda (SI)',
  'honda-mod': 'Modified Honda (SI)',
};

export interface FrictionCurves {
  rpm: number[];
  sp: number[]; // m/s
  models: Record<FrictionModelName, number[]>; // FMEP bar
  mean: number[]; // mean of the five SI/diesel model values (Patton, Sandoval, HBM, Millington, Honda)
  /** Friction power kW per model. */
  power: Record<FrictionModelName, number[]>;
}

/** FMEP and friction power of every model over the speed range. */
export function estimateFriction(f: FrictionInput): FrictionCurves {
  const rpm: number[] = [];
  const step = f.stepRpm > 0 ? f.stepRpm : 500;
  for (let r = f.startRpm; r <= f.endRpm + 1e-9; r += step) rpm.push(r);
  if (!rpm.length) rpm.push(f.startRpm);
  const names = Object.keys(FRICTION_MODEL_LABELS) as FrictionModelName[];
  const models = {} as Record<FrictionModelName, number[]>;
  const power = {} as Record<FrictionModelName, number[]>;
  const vd = (Math.PI / 4) * (f.bore / 1000) ** 2 * (f.stroke / 1000) * f.cylinders; // m3
  const revsPerCycle = (f.cycle ?? 4) === 4 ? 2 : 1;
  for (const m of names) {
    models[m] = rpm.map((r) => frictionFmep(m, f, r));
    power[m] = rpm.map((r, i) => (models[m][i] * 1e5 * vd * (r / 60) / revsPerCycle) / 1000);
  }
  const five: FrictionModelName[] = ['patton', 'sandoval', 'hbm', 'millington', 'honda'];
  const mean = rpm.map((_, i) => five.reduce((s, m) => s + models[m][i], 0) / five.length);
  return { rpm, sp: rpm.map((r) => pistonSpeedMean(f.stroke, r)), models, mean, power };
}

/**
 * Fit the Chen-Flynn model FMEP = a + b*pmax + c*Sp + d*Sp^2 to an FMEP curve.
 * b multiplies the peak cylinder pressure, which a friction-only curve cannot identify, so b and the
 * reference peak pressure are fixed and folded into a: a_fit = a0 - b * pmaxRef.
 */
export function fitChenFlynn(sp: number[], fmepBar: number[], opt: { b?: number; pmaxRef?: number } = {}): FrictionModel & { rms: number } {
  const b = opt.b ?? 0.005, pref = opt.pmaxRef ?? 45;
  const [a0, c, d] = polyFit(sp, fmepBar, [() => 1, (x) => x, (x) => x * x]);
  let s = 0;
  sp.forEach((x, i) => { const e = a0 + c * x + d * x * x - fmepBar[i]; s += e * e; });
  return { a: a0 - b * pref, b, c, d, rms: Math.sqrt(s / sp.length) };
}
