import { describe, expect, it } from 'vitest';
import {
  Volume0D, burnFraction, cylinderGeometry, cylinderVolume, dVdTheta, enthalpy, flowBetween, fuelDefaults, gasProps,
  heatTransferCoeff, internalEnergy, meanPistonSpeed, orificeMassFlow, stoichAfr, temperatureFromEnergy,
  throttleEffectiveArea, valveEffectiveArea, valveLift, wiebe, chenFlynnFmep, defaultFriction, linerArea,
  perfectDisplacement, perfectMixingScavenging,
} from '../src/thermo/index';
import type { Cylinder, Valve } from '../src/model';

const cyl: Cylinder = { id: 1, label: 'c', bore: 86, stroke: 86, conRod: 140, pinOffset: 0, compressionRatio: 10, firingAngle: 0 };
const fuel = fuelDefaults('gasoline');

describe('gas', () => {
  it('gamma values', () => {
    expect(gasProps(300, 0).gamma).toBeCloseTo(1.4, 2);
    const g = gasProps(2000, 1, fuel).gamma;
    expect(g).toBeGreaterThan(1.22);
    expect(g).toBeLessThan(1.3);
  });
  it('u/h consistent and invertible', () => {
    for (const T of [300, 900, 1500, 2500]) {
      for (const b of [0, 0.5, 1]) {
        const dT = 0.01;
        const cv = (internalEnergy(T + dT, b) - internalEnergy(T - dT, b)) / (2 * dT);
        expect(cv / gasProps(T, b).cv).toBeCloseTo(1, 3);
        expect(enthalpy(T, b) - internalEnergy(T, b)).toBeCloseTo(gasProps(T, b).R * T, 3);
        expect(temperatureFromEnergy(internalEnergy(T, b), b)).toBeCloseTo(T, 2);
      }
    }
  });
  it('stoich afr', () => {
    expect(stoichAfr(fuel)).toBeGreaterThan(14.3);
    expect(stoichAfr(fuel)).toBeLessThan(14.9);
    expect(stoichAfr(fuelDefaults('methanol'))).toBeCloseTo(6.4, 0);
  });
});

describe('kinematics', () => {
  it('volumes', () => {
    const g = cylinderGeometry(cyl);
    expect(cylinderVolume(cyl, 0)).toBeCloseTo(g.clearance, 12);
    expect(cylinderVolume(cyl, 180)).toBeCloseTo(g.clearance + g.displacement, 9);
    const h = 1e-3, th = 70;
    const num = (cylinderVolume(cyl, th + h) - cylinderVolume(cyl, th - h)) / (2 * h);
    expect(dVdTheta(cyl, th) / num).toBeCloseTo(1, 5);
    expect(meanPistonSpeed(cyl, 3000)).toBeCloseTo(8.6, 6);
    expect(linerArea(cyl, 180)).toBeGreaterThan(linerArea(cyl, 0));
  });
});

describe('combustion', () => {
  it('wiebe limits', () => {
    expect(wiebe(-20, -10, 50, 10, 2)).toBe(0);
    expect(wiebe(40, -10, 50, 10, 2)).toBe(1);
    expect(wiebe(15, -10, 50, 10, 2)).toBeGreaterThan(0.3);
    expect(burnFraction({ kind: 'wiebe2', premixFraction: 0.3, a1: 10, m1: 0.4, a2: 5, m2: 1 }, 15, -10, 50)).toBeGreaterThan(0);
    expect(burnFraction({ kind: 'user', angle: [0, 25, 50], fraction: [0, 0.5, 1] }, 15, -10, 50)).toBeCloseTo(0.5, 6);
  });
});

describe('heat transfer', () => {
  it('woschni magnitude at firing', () => {
    const h = heatTransferCoeff({ kind: 'woschni', scale: 1 }, {
      p: 50e5, T: 2000, bore: 0.086, meanPistonSpeed: 10, V: 6e-5, Vd: 5e-4,
      pMotored: 30e5, T1: 600, p1: 10e5, V1: 3e-4, combustion: true,
    });
    expect(h).toBeGreaterThan(300);
    expect(h).toBeLessThan(5000);
    const a = heatTransferCoeff({ kind: 'annand', a: 0.12, b: 0.8, c: 4.29e-9 }, { p: 50e5, T: 2000, bore: 0.086, meanPistonSpeed: 10, V: 1, Vd: 1, combustion: true, Tw: 450 });
    expect(a).toBeGreaterThan(100);
    const e = heatTransferCoeff({ kind: 'eichelberg', scale: 1 }, { p: 50e5, T: 2000, bore: 0.086, meanPistonSpeed: 10, V: 1, Vd: 1, combustion: true });
    expect(e).toBeGreaterThan(500);
  });
});

describe('valves', () => {
  const v: Valve = { id: 1, label: 'i', kind: 'intake', openAngle: 345, closeAngle: 600, maxLift: 9, diameter: 33 };
  const wrap: Valve = { ...v, kind: 'exhaust', openAngle: 650, closeAngle: 80 };
  it('lift window', () => {
    expect(valveLift(v, 100, 720)).toBe(0);
    expect(valveLift(v, 472.5, 720)).toBeCloseTo(9, 6);
    expect(valveLift(wrap, 10, 720)).toBeGreaterThan(0);
    expect(valveLift(wrap, 300, 720)).toBe(0);
    expect(valveEffectiveArea(v, 472, 720)).toBeGreaterThan(1e-4);
    expect(valveEffectiveArea(v, 100, 720)).toBe(0);
  });
  it('lift curve', () => {
    const c: Valve = { ...v, liftCurve: { angle: [340, 400, 460], lift: [0, 8, 0] } };
    expect(valveLift(c, 400, 720)).toBe(8);
    expect(valveLift(c, 100, 720)).toBe(0);
  });
  it('throttle', () => {
    const t = { id: 1, label: 't', diameter: 50, kind: 'butterfly' as const, position: 90, cd: 0.9 };
    expect(throttleEffectiveArea(t)).toBeCloseTo(0.9 * Math.PI / 4 * 0.05 ** 2, 8);
    expect(throttleEffectiveArea({ ...t, position: 10 })).toBeLessThan(throttleEffectiveArea(t) / 10);
  });
});

describe('orifice', () => {
  const g = gasProps(300, 0);
  const A = 1e-4, p0 = 2e5, T0 = 300;
  it('choked', () => {
    const gm = g.gamma;
    const exp = A * p0 * Math.sqrt(gm / (g.R * T0)) * Math.pow(2 / (gm + 1), (gm + 1) / (2 * (gm - 1)));
    expect(orificeMassFlow(p0, T0, g, 0.5e5, A)).toBeCloseTo(exp, 8);
    expect(orificeMassFlow(p0, T0, g, 1.0e5, A)).toBeCloseTo(exp, 6);
  });
  it('subsonic and zero', () => {
    const pd = 1.8e5, gm = g.gamma;
    const r = pd / p0;
    const exp = A * p0 / Math.sqrt(g.R * T0) * Math.sqrt(2 * gm / (gm - 1) * (r ** (2 / gm) - r ** ((gm + 1) / gm)));
    expect(orificeMassFlow(p0, T0, g, pd, A)).toBeCloseTo(exp, 10);
    expect(orificeMassFlow(p0, T0, g, p0, A)).toBe(0);
  });
  it('signed', () => {
    const f = flowBetween(1e5, 300, g, 2e5, 400, gasProps(400, 0), A);
    expect(f.mdot).toBeLessThan(0);
    expect(f.hFlux).toBeLessThan(0);
  });
});

describe('Volume0D', () => {
  it('adiabatic compression follows p V^gamma', () => {
    const v = new Volume0D({ V: 5e-4, p: 1e5, T: 300 });
    const V0 = v.V, p0 = v.p, T0 = v.T;
    const n = 2000;
    for (let i = 1; i <= n; i++) {
      const Vn = V0 * (1 - 0.9 * i / n);
      v.advance(1e-5, { Vnew: Vn, dV: Vn - v.V });
    }
    const gam = Math.log(v.p / p0) / Math.log(V0 / v.V);
    expect(v.T).toBeGreaterThan(T0 * 2.2);
    expect(gam).toBeGreaterThan(1.3);
    expect(gam).toBeLessThan(1.42);
    // Energy: m (u2 - u1) = work done on the gas
    const w = v.m * (internalEnergy(v.T, 0) - internalEnergy(T0, 0));
    expect(w).toBeGreaterThan(0);
  });
  it('mixing: closed fill conserves mass and energy', () => {
    const v = new Volume0D({ V: 1e-3, p: 1e5, T: 300 });
    const m0 = v.m;
    const g = gasProps(600, 1);
    const hs = enthalpy(600, 1);
    const E0 = v.m * internalEnergy(300, 0);
    v.advance(1, { Vnew: 1e-3, dV: 0, flows: [{ mdot: 1e-3, h: hs, burnt: 1 }] });
    expect(v.m).toBeCloseTo(m0 + 1e-3, 12);
    expect(v.burnt).toBeCloseTo(1e-3 / v.m, 10);
    const E1 = v.m * internalEnergy(v.T, v.burnt);
    expect(E1 - E0).toBeCloseTo(1e-3 * hs, 3);
    expect(v.T).toBeGreaterThan(300);
    expect(g.R).toBeGreaterThan(0);
  });
  it('combustion heat raises pressure', () => {
    const v = new Volume0D({ V: 1e-4, p: 20e5, T: 700 });
    const p = v.p;
    v.advance(1e-4, { Vnew: 1e-4, dV: 0, qCombustion: 200 });
    expect(v.p).toBeGreaterThan(p);
  });
});

describe('misc', () => {
  it('friction', () => {
    const f = chenFlynnFmep(defaultFriction(), 60, 10);
    expect(f).toBeGreaterThan(0.5);
    expect(f).toBeLessThan(3);
  });
  it('scavenging', () => {
    const d = perfectDisplacement({ mFresh: 0, mResidual: 1 }, 0.5, 0.4);
    expect(d.outFresh).toBe(0);
    const d2 = perfectDisplacement(d.state, 0.5, 1);
    expect(d2.outFresh).toBeGreaterThan(0);
    const m = perfectMixingScavenging(1, 0, 1, 0.5);
    expect(m.outFresh).toBeCloseTo(0.5, 10);
  });
});
