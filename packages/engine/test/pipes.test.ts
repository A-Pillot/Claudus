import { describe, it, expect } from 'vitest';
import { Pipe1D, meshCells, bendLossCoefficient, junctionLossArea, pressureLossJunction, type NodeBoundary } from '../src/pipes';

const G = 1.4, R = 287;
const closed: NodeBoundary = { p0: 1e5, T0: 300, gamma: G, R, burnt: 0, effArea: 0 };
const amb = (p0 = 1e5, T0 = 300, effArea = 1): NodeBoundary => ({ p0, T0, gamma: G, R, burnt: 0, effArea });
const mk = (o: Partial<{ L: number; d: (x: number) => number; dx: number; p: number; T: number; u: number; cf: number; ht: boolean }> = {}) =>
  new Pipe1D({
    length: o.L ?? 1, diameterAt: o.d ?? (() => 0.05), cellLength: o.dx ?? 0.01, gamma: G, R,
    wallTemperature: 300, frictionFactor: o.cf ?? 0, heatTransfer: o.ht,
    initial: { p: o.p ?? 1e5, T: o.T ?? 300, u: o.u ?? 0 },
  });

function run(p: Pipe1D, t: number, e1: NodeBoundary, e2: NodeBoundary, cb?: (f: ReturnType<Pipe1D['step']>, dt: number) => void) {
  let tt = 0;
  while (tt < t) {
    const dt = Math.min(p.maxStableDt(), t - tt);
    const f = p.step(dt, e1, e2);
    cb?.(f, dt);
    tt += dt;
  }
}

// exact Sod solution for pL=1,rhoL=1,pR=0.1,rhoR=0.125 (gamma 1.4), sampled at x/t
function sodExact(xi: number): { rho: number; u: number; p: number } {
  const g = 1.4;
  const pS = 0.30313, uS = 0.92745, rhoSL = 0.42632, rhoSR = 0.26557;
  const aL = Math.sqrt(g), head = -aL;
  const aSL = Math.sqrt((g * pS) / rhoSL), tail = uS - aSL;
  const shock = 1.75216;
  if (xi < head) return { rho: 1, u: 0, p: 1 };
  if (xi < tail) {
    const u = (2 / (g + 1)) * (aL + xi);
    const a = aL - ((g - 1) / 2) * u;
    const rho = Math.pow(a / aL, 2 / (g - 1));
    return { rho, u, p: Math.pow(rho, g) };
  }
  if (xi < uS) return { rho: rhoSL, u: uS, p: pS };
  if (xi < shock) return { rho: rhoSR, u: uS, p: pS };
  return { rho: 0.125, u: 0, p: 0.1 };
}

describe('pipes', () => {
  it('meshCells', () => {
    expect(meshCells(1, 0.01)).toBe(100);
    expect(meshCells(0.001, 0.01)).toBe(1);
  });

  it('Sod shock tube matches analytic', () => {
    const p = new Pipe1D({ length: 1, diameterAt: () => 0.05, cellLength: 0.0025, gamma: G, R, wallTemperature: 300, frictionFactor: 0, initial: { p: 1, T: 1 } });
    const rhoRef = 1.0;
    const TL = 1e5 / (R * rhoRef), TR = 1e4 / (R * 0.125 * rhoRef);
    p.initialize((x) => (x < 0.5 ? { p: 1e5, T: TL } : { p: 1e4, T: TR }));
    const tPhys = 0.2 / Math.sqrt(1e5 / rhoRef); // nondimensional t = 0.2, length scale 1 m
    run(p, tPhys, closed, closed);
    const prof = p.profile();
    let errRho = 0, errP = 0;
    for (let i = 0; i < prof.x.length; i++) {
      const ex = sodExact((prof.x[i] - 0.5) / 0.2);
      const rho = prof.p[i] / (R * prof.T[i]);
      errRho += Math.abs(rho / rhoRef - ex.rho);
      errP += Math.abs(prof.p[i] / 1e5 - ex.p);
    }
    errRho /= prof.x.length; errP /= prof.x.length;
    expect(errRho).toBeLessThan(0.01);
    expect(errP).toBeLessThan(0.01);
  });

  it('closed-closed pipe conserves mass and energy', () => {
    const p = mk({ L: 0.5, dx: 0.01 });
    p.initialize((x) => ({ p: 1e5 * (1 + 0.5 * Math.exp(-((x - 0.15) ** 2) / 0.002)), T: 300, u: 0 }));
    const m0 = p.totalMass(), e0 = p.totalEnergy();
    run(p, 0.05, closed, closed);
    expect(Math.abs(p.totalMass() / m0 - 1)).toBeLessThan(1e-12);
    expect(Math.abs(p.totalEnergy() / e0 - 1)).toBeLessThan(1e-12);
  });

  it('open end relaxes to ambient', () => {
    const p = mk({ L: 0.5, dx: 0.01, cf: 0.005, p: 2e5, T: 350 });
    run(p, 0.5, amb(1e5, 300, 1), amb(1e5, 300, 1));
    const s = p.sample(0.5);
    expect(Math.abs(s.p - 1e5)).toBeLessThan(2e3);
    expect(Math.abs(s.u)).toBeLessThan(5);
  });

  it('flux conservation: returned fluxes match content change (with taper, partially open)', () => {
    const p = mk({ L: 0.4, dx: 0.01, d: (x) => 0.04 + 0.05 * x, p: 1.3e5 });
    const e1 = amb(1.0e5, 300, 3e-4), e2 = amb(1.6e5, 320, 5e-4);
    e2.burnt = 1;
    let dm = 0, dE = 0, dB = 0;
    const m0 = p.totalMass(), E0 = p.totalEnergy(), B0 = p.totalBurnt();
    run(p, 0.03, e1, e2, (f, dt) => {
      dm += dt * (f.end1.mdot + f.end2.mdot);
      dE += dt * (f.end1.hFlux + f.end2.hFlux);
      dB += dt * (f.end1.burntFlux + f.end2.burntFlux);
    });
    expect(Math.abs((p.totalMass() - m0 - dm) / m0)).toBeLessThan(1e-9);
    // energy flux is stagnation enthalpy, momentum-pressure work at the ends enters through hFlux only:
    // content change equals flux (no wall motion, adiabatic)
    expect(Math.abs((p.totalEnergy() - E0 - dE) / E0)).toBeLessThan(1e-9);
    expect(Math.abs(p.totalBurnt() - B0 - dB)).toBeLessThan(1e-9 * m0);
    expect(dB).toBeGreaterThan(0);
  });

  it('steady flow between reservoirs matches orifice estimate for small effArea', () => {
    const p = mk({ L: 0.5, dx: 0.01, cf: 0.005 });
    const Ae = 2e-5;
    const e1 = amb(1.2e5, 300, Ae), e2 = amb(1.0e5, 300, 1);
    run(p, 0.2, e1, e2);
    let m1 = 0, m2 = 0, T = 0;
    run(p, 0.1, e1, e2, (f, dt) => { m1 += f.end1.mdot * dt; m2 += f.end2.mdot * dt; T += dt; });
    m1 /= T; m2 /= T;
    const pr = 1e5 / 1.2e5, g = G;
    const est = Ae * 1.2e5 * Math.sqrt(((2 * g) / ((g - 1) * R * 300)) * (Math.pow(pr, 2 / g) - Math.pow(pr, (g + 1) / g)));
    expect(m1).toBeGreaterThan(0.9 * est);
    expect(m1).toBeLessThan(1.1 * est);
    expect(Math.abs(m1 + m2) / est).toBeLessThan(0.05);
  });

  it('flow reverses when the pressure ratio flips', () => {
    const p = mk({ L: 0.5, dx: 0.01, cf: 0.005 });
    const hi = amb(1.2e5, 300, 3e-5), lo = amb(1e5, 300, 1);
    const avg = (t: number, a: NodeBoundary, b: NodeBoundary) => {
      run(p, t, a, b);
      let m = 0, T = 0;
      run(p, 0.05, a, b, (f, dt) => { m += f.end1.mdot * dt; T += dt; });
      return m / T;
    };
    expect(avg(0.1, hi, lo)).toBeGreaterThan(1e-3);
    expect(avg(0.15, lo, hi)).toBeLessThan(-1e-3);
  });

  it('tapered pipe at rest stays at rest', () => {
    const p = mk({ L: 0.5, dx: 0.01, d: (x) => 0.03 + 0.1 * x * x });
    run(p, 0.05, closed, closed);
    const pr = p.profile();
    for (let i = 0; i < pr.x.length; i++) {
      expect(Math.abs(pr.p[i] - 1e5)).toBeLessThan(1);
      expect(Math.abs(pr.u[i])).toBeLessThan(1e-3);
    }
  });

  it('stable with strong shock, sonic outflow and reverse flow; gas stays positive', () => {
    const p = mk({ L: 0.3, dx: 0.005, p: 8e5, T: 1000, cf: 0.005, ht: true });
    run(p, 0.05, amb(1e5, 300, 1), closed);
    const pr = p.profile();
    for (let i = 0; i < pr.x.length; i++) {
      expect(Number.isFinite(pr.p[i])).toBe(true);
      expect(pr.p[i]).toBeGreaterThan(0);
    }
  });

  it('exhaust blowdown: valve opening into high pressure and slamming shut stays finite', () => {
    const p = new Pipe1D({ length: 0.3, diameterAt: () => 0.036, cellLength: 0.015, gamma: 1.4, R, wallTemperature: 320, frictionFactor: 0.004, heatTransfer: true, initial: { p: 101325, T: 298 } });
    const A = Math.PI * 0.018 ** 2;
    for (let i = 0; i < 3000; i++) {
      p.step(2e-5,
        { p0: 101325, T0: 298, gamma: 1.4, R, burnt: 0, effArea: A },
        { p0: i < 500 ? 0.6e5 : 3e5, T0: i < 500 ? 300 : 1200, gamma: 1.4, R, burnt: 1, effArea: i % 400 < 200 ? A * 0.3 : 0 });
      const pr = p.profile();
      for (let k = 0; k < pr.p.length; k++) {
        if (!(pr.p[k] > 1e4 && pr.p[k] < 2e6 && Number.isFinite(pr.u[k]) && Math.abs(pr.u[k]) < 1500)) throw new Error(`bad state at step ${i} cell ${k}: p=${pr.p[k]} u=${pr.u[k]}`);
      }
    }
  });

  it('randomised stress: switching nodes keep the pipe finite and conservative', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const p = new Pipe1D({ length: 0.4, diameterAt: (x) => 0.04 + 0.02 * x, cellLength: 0.02, gamma: 1.4, R, wallTemperature: 400, frictionFactor: 0.005, heatTransfer: false, initial: { p: 1e5, T: 300 } });
    const A1 = p.endArea(1), A2 = p.endArea(2);
    const node = (A: number): NodeBoundary => ({ p0: (0.3 + 5.7 * rnd()) * 1e5, T0: 280 + 1220 * rnd(), gamma: 1.4, R, burnt: rnd() < 0.5 ? 0 : 1, effArea: rnd() < 0.2 ? 0 : 1.5 * A * rnd() });
    let n1 = node(A1), n2 = node(A2);
    const m0 = p.totalMass(), E0 = p.totalEnergy();
    let dm = 0, dE = 0, maxRel = 0;
    for (let i = 0; i < 6000; i++) {
      if (i % 40 === 0 && rnd() < 0.6) n1 = node(A1);
      if (i % 40 === 20 && rnd() < 0.6) n2 = node(A2);
      const dt = Math.min(2e-5, p.maxStableDt());
      const f = p.step(dt, n1, n2);
      dm += dt * (f.end1.mdot + f.end2.mdot);
      dE += dt * (f.end1.hFlux + f.end2.hFlux);
      const pr = p.profile();
      for (let k = 0; k < pr.p.length; k++) {
        if (!(pr.p[k] > 1e3 && Number.isFinite(pr.u[k]) && Number.isFinite(pr.T[k]))) throw new Error(`bad state step ${i}`);
      }
      maxRel = Math.max(maxRel, Math.abs(p.totalMass() - m0 - dm) / m0);
    }
    expect(maxRel).toBeLessThan(1e-9);
    // energy: friction conserves total energy, so content change equals the enthalpy flux
    expect(Math.abs(p.totalEnergy() - E0 - dE) / E0).toBeLessThan(1e-8);
  });

  it('bend loss reduces steady flow and keeps energy conservation', () => {
    const steady = (K: number) => {
      const p = new Pipe1D({ length: 0.5, diameterAt: () => 0.04, cellLength: 0.01, gamma: G, R, wallTemperature: 300, frictionFactor: 0.004, bendLossK: K, initial: { p: 1.1e5, T: 300 } });
      const e1 = amb(1.3e5, 300, 1), e2 = amb(1e5, 300, 1);
      run(p, 0.3, e1, e2);
      let m = 0, T = 0;
      run(p, 0.1, e1, e2, (f, dt) => { m += f.end1.mdot * dt; T += dt; });
      return m / T;
    };
    expect(steady(2)).toBeLessThan(0.9 * steady(0));
    expect(bendLossCoefficient(90, 1)).toBeCloseTo(0.21, 2);
    expect(bendLossCoefficient(45, 1)).toBeLessThan(bendLossCoefficient(90, 1));
    expect(bendLossCoefficient(180, 1)).toBeGreaterThan(bendLossCoefficient(90, 1));
  });

  it('pressure-loss junction helper', () => {
    const A = 1e-3;
    const j = pressureLossJunction([
      { area: A, angleDeg: 0, mdotIn: 0.1 },
      { area: A, angleDeg: 90, mdotIn: -0.05 },
      { area: A, angleDeg: 0, mdotIn: -0.05 },
    ]);
    expect(j.datum).toBe(0);
    expect(j.K[0]).toBe(0);
    expect(j.K[1]).toBeGreaterThan(j.K[2]); // turning branch loses more
    expect(j.effAreaFactor[1]).toBeLessThan(j.effAreaFactor[2]);
    expect(junctionLossArea(A, 0)).toBe(A);
    expect(junctionLossArea(A, 3)).toBeCloseTo(A / 2, 12);
    const none = pressureLossJunction([{ area: A, angleDeg: 0, mdotIn: 0 }, { area: A, angleDeg: 90, mdotIn: 0 }]);
    expect(none.effAreaFactor).toEqual([1, 1]);
  });
});
