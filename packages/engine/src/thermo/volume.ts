// Zero-dimensional control volume (cylinder, plenum, junction).
import type { Fuel } from '../model';
import { enthalpy, gasProps, internalEnergy, type GasProps } from './gas';

export interface VolumeFlow {
  mdot: number; // kg/s, + into the volume
  h: number; // specific enthalpy of the stream J/kg (ignored for outflow, which uses the volume's own)
  burnt: number;
}

export interface AdvanceInputs {
  Vnew: number;
  dV: number; // Vnew - V
  qCombustion?: number; // J over the step
  qWall?: number; // J into the gas over the step
  flows?: VolumeFlow[];
  /** Mass of unburnt charge converted to burnt gas in the step, kg. */
  dBurntMass?: number;
}

export interface VolumeInit {
  V: number;
  p: number;
  T: number;
  burnt?: number;
  fuel?: Fuel;
  m?: number;
}

export class Volume0D {
  m: number;
  T: number;
  p: number;
  V: number;
  burnt: number;
  fuelUnburned?: number;
  fuel?: Fuel;

  constructor(init: VolumeInit) {
    this.V = init.V;
    this.p = init.p;
    this.T = init.T;
    this.burnt = init.burnt ?? 0;
    this.fuel = init.fuel;
    const g = gasProps(this.T, this.burnt, this.fuel);
    this.m = init.m ?? (this.p * this.V) / (g.R * this.T);
  }

  gas(): GasProps {
    return gasProps(this.T, this.burnt, this.fuel);
  }

  /** Specific enthalpy of the contents, J/kg. */
  enthalpy(): number {
    return enthalpy(this.T, this.burnt, this.fuel);
  }

  /** Stagnation state ~ static state for a 0D volume. */
  stagnation(): { p: number; T: number; gas: GasProps } {
    return { p: this.p, T: this.T, gas: this.gas() };
  }

  advance(dt: number, inp: AdvanceInputs): void {
    const flows = inp.flows ?? [];
    const hSelf = this.enthalpy();
    let dmIn = 0, dmTot = 0, dmBurntIn = 0, hIn = 0;
    for (const f of flows) {
      const dm = f.mdot * dt;
      dmTot += dm;
      if (dm > 0) { dmIn += dm; dmBurntIn += dm * f.burnt; hIn += dm * f.h; }
      else hIn += dm * hSelf;
    }
    const mOld = this.m;
    const mNew = Math.max(mOld + dmTot, 1e-12);
    // Burnt mass: outflow removes at the volume's own fraction.
    const outflow = dmTot - dmIn; // <= 0
    let mb = mOld * this.burnt + dmBurntIn + outflow * this.burnt + (inp.dBurntMass ?? 0);
    mb = Math.min(Math.max(mb, 0), mNew);
    const bNew = mb / mNew;

    const U0 = mOld * internalEnergy(this.T, this.burnt, this.fuel);
    const Ebase = U0 + hIn + (inp.qCombustion ?? 0) + (inp.qWall ?? 0);
    const pOld = this.p;
    const Vnew = inp.Vnew;
    // Solve mNew*u(T) = Ebase - 0.5 (pOld + pNew) dV, pNew = mNew R T / Vnew.
    let T = this.T;
    for (let it = 0; it < 50; it++) {
      const g = gasProps(T, bNew, this.fuel);
      const pNew = (mNew * g.R * T) / Vnew;
      const f = mNew * internalEnergy(T, bNew, this.fuel) - Ebase + 0.5 * (pOld + pNew) * inp.dV;
      const df = mNew * g.cv + 0.5 * ((mNew * g.R) / Vnew) * inp.dV;
      let dT = f / df;
      if (dT > 1000) dT = 1000; else if (dT < -1000) dT = -1000;
      T -= dT;
      if (T < 100) T = 100;
      if (Math.abs(dT) < 0.01) break;
    }
    this.m = mNew;
    this.T = T;
    this.V = Vnew;
    this.burnt = bNew;
    this.p = (mNew * gasProps(T, bNew, this.fuel).R * T) / Vnew;
  }
}


