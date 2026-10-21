// Gas properties: air + stoichiometric combustion products, NASA-7 polynomials for N2, O2, CO2, H2O.
// Sensible energy/enthalpy are referenced to 298.15 K (u = 0 there); h = u + R T for every mixture.
import type { Fuel, FuelType } from '../model';

export interface GasProps {
  R: number; // J/kgK
  cp: number;
  cv: number;
  gamma: number;
  /** Specific enthalpy J/kg (same reference as enthalpy()), when known. */
  h?: number;
}

const RU = 8314.462; // J/kmolK
const T_REF = 298.15;
// species order: N2, O2, CO2, H2O
const MW = [28.0134, 31.9988, 44.0095, 18.01528];
const HI = [
  [2.92664, 1.4879768e-3, -5.68476e-7, 1.0097038e-10, -6.753351e-15, -922.7977],
  [3.28253784, 1.48308754e-3, -7.57966669e-7, 2.09470555e-10, -2.16717794e-14, -1088.45772],
  [3.85746029, 4.41437026e-3, -2.21481404e-6, 5.23490188e-10, -4.72084164e-14, -48759.166],
  [3.03399249, 2.17691804e-3, -1.64072518e-7, -9.7041987e-11, 1.68200992e-14, -30004.2971],
];
const LO = [
  [3.298677, 1.4082404e-3, -3.963222e-6, 5.641515e-9, -2.444854e-12, -1020.8999],
  [3.78245636, -2.99673416e-3, 9.84730201e-6, -9.68129509e-9, 3.24372837e-12, -1063.94356],
  [2.35677352, 8.98459677e-3, -7.12356269e-6, 2.45919022e-9, -1.43699548e-13, -48371.9697],
  [4.19864056, -2.0364341e-3, 6.52040211e-6, -5.48797062e-9, 1.77197817e-12, -30293.7267],
];

const coef = (i: number, T: number): number[] => (T < 1000 ? LO[i] : HI[i]);
const cpOverR = (a: number[], T: number): number => a[0] + T * (a[1] + T * (a[2] + T * (a[3] + T * a[4])));
const hOverRT = (a: number[], T: number): number =>
  a[0] + T * (a[1] / 2 + T * (a[2] / 3 + T * (a[3] / 4 + (T * a[4]) / 5))) + a[5] / T;
// Sensible enthalpy h(T)-h(Tref) per kmol/R, using the range matching each temperature.
const dhOverR = (i: number, T: number): number => {
  const hT = hOverRT(coef(i, T), T) * T;
  const hR = hOverRT(coef(i, T_REF), T_REF) * T_REF;
  // If T and Tref sit in different ranges, add the offset at the 1000 K junction.
  const off = T >= 1000 ? hOverRT(HI[i], 1000) * 1000 - hOverRT(LO[i], 1000) * 1000 : 0;
  return hT - hR - off;
};

interface Comp { y: number[]; R: number }
const AIR_Y = [0.7686, 0.2314, 0, 0];
const cache = new Map<string, Comp>();

function mixR(y: number[]): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s += y[i] / MW[i];
  return RU * s;
}

/** Mass fractions of stoichiometric products for a fuel (per its H/C and O/C). */
function productsComp(fuel?: Fuel): number[] {
  let nC = 1, nH = 1.87, nO = 0;
  if (fuel) {
    if (fuel.hcRatio > 100) { nC = 0; nH = 1; nO = 0; } else { nH = fuel.hcRatio; nO = fuel.ocRatio; }
  }
  const o2 = nC + nH / 4 - nO / 2;
  const n2 = 3.76 * o2;
  const m = [n2 * MW[0], 0, nC * MW[2], (nH / 2) * MW[3]];
  const tot = m[0] + m[2] + m[3];
  return m.map((x) => x / tot);
}

function comps(fuel?: Fuel): [Comp, Comp] {
  const key = fuel ? `${fuel.hcRatio}/${fuel.ocRatio}` : 'def';
  let a = cache.get('a');
  if (!a) { a = { y: AIR_Y, R: mixR(AIR_Y) }; cache.set('a', a); }
  let b = cache.get(key);
  if (!b) { const y = productsComp(fuel); b = { y, R: mixR(y) }; cache.set(key, b); }
  return [a, b];
}

function mixY(burnt: number, fuel?: Fuel): { y: number[]; R: number } {
  const [a, p] = comps(fuel);
  const bb = burnt < 0 ? 0 : burnt > 1 ? 1 : burnt;
  const y = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) y[i] = (1 - bb) * a.y[i] + bb * p.y[i];
  return { y, R: (1 - bb) * a.R + bb * p.R };
}

function cpMix(T: number, y: number[]): number {
  let cp = 0;
  for (let i = 0; i < 4; i++) if (y[i] !== 0) cp += y[i] * cpOverR(coef(i, T), T) * (RU / MW[i]);
  return cp;
}

/** Sensible internal energy J/kg (zero at 298.15 K). */
export function internalEnergy(T: number, burnt: number, fuel?: Fuel): number {
  const { y, R } = mixY(burnt, fuel);
  let dh = 0;
  for (let i = 0; i < 4; i++) if (y[i] !== 0) dh += y[i] * dhOverR(i, T) * (RU / MW[i]);
  return dh - R * (T - T_REF);
}

/** Enthalpy J/kg = u + R T. */
export function enthalpy(T: number, burnt: number, fuel?: Fuel): number {
  return internalEnergy(T, burnt, fuel) + mixY(burnt, fuel).R * T;
}

export function gasProps(T: number, burnt: number, fuel?: Fuel): GasProps {
  const Tc = T < 200 ? 200 : T > 4000 ? 4000 : T;
  const { y, R } = mixY(burnt, fuel);
  const cp = cpMix(Tc, y);
  const cv = cp - R;
  return { R, cp, cv, gamma: cp / cv, h: internalEnergy(T, burnt, fuel) + R * T };
}

/** Invert u(T) by Newton, starting at guess T0 (default 1000 K). */
export function temperatureFromEnergy(u: number, burnt: number, fuel?: Fuel, T0 = 1000): number {
  let T = T0;
  for (let i = 0; i < 30; i++) {
    const f = internalEnergy(T, burnt, fuel) - u;
    const cv = gasProps(T, burnt, fuel).cv;
    let dT = f / cv;
    if (dT > 500) dT = 500; else if (dT < -500) dT = -500;
    T -= dT;
    if (T < 150) T = 150;
    if (Math.abs(dT) < 1e-4) break;
  }
  return T;
}

// ---- Fuel ----
export function fuelDefaults(type: FuelType): Fuel {
  switch (type) {
    case 'diesel':
      return { type, lowerHeatingValue: 42.5e6, hcRatio: 1.8, ocRatio: 0, density: 840, system: 'direct-injection-diesel' };
    case 'methanol':
      return { type, lowerHeatingValue: 19.9e6, hcRatio: 4, ocRatio: 1, density: 792, system: 'spark-ignition' };
    case 'ethanol':
      return { type, lowerHeatingValue: 26.8e6, hcRatio: 3, ocRatio: 0.5, density: 789, system: 'spark-ignition' };
    case 'natural-gas':
      return { type, lowerHeatingValue: 50.0e6, hcRatio: 4, ocRatio: 0, density: 0.72, system: 'spark-ignition' };
    case 'lpg':
      return { type, lowerHeatingValue: 46.0e6, hcRatio: 8 / 3, ocRatio: 0, density: 540, system: 'spark-ignition' };
    case 'hydrogen':
      return { type, lowerHeatingValue: 120e6, hcRatio: 1e6, ocRatio: 0, density: 0.09, system: 'spark-ignition' };
    case 'gasoline':
    case 'user':
    default:
      return { type, lowerHeatingValue: 44.0e6, hcRatio: 1.87, ocRatio: 0, density: 745, system: 'spark-ignition' };
  }
}

/** Stoichiometric air/fuel ratio by mass. */
export function stoichAfr(fuel: Fuel): number {
  let nC = 1, nH = fuel.hcRatio, nO = fuel.ocRatio;
  if (fuel.hcRatio > 100) { nC = 0; nH = 1; nO = 0; }
  const o2 = nC + nH / 4 - nO / 2;
  const fuelMass = nC * 12.011 + nH * 1.008 + nO * 15.999;
  return (o2 * (1 + 3.76) * 28.85) / fuelMass;
}
