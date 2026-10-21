// 1D quasi-1D compressible pipe flow: finite volume, MUSCL (van Leer limiter) + HLLC, SSP-RK2.
// Area change handled with a well-balanced momentum source p*dA. Wall friction and
// Reynolds-analogy heat transfer are applied by operator splitting.
// Boundaries are quasi-steady orifice/nozzle flows between the end cell and a 0D node; the
// boundary face flux is the very flux applied to the end cell, so returned EndFlux conserve exactly.
// SI units; positive end flux = into the pipe.

export interface PipeOptions {
  length: number; // m
  diameterAt: (x: number) => number; // m, x in m from end 1
  cellLength: number; // m target
  gamma: number;
  R: number;
  wallTemperature: number; // K
  frictionFactor: number; // Fanning friction factor (tau_w = Cf * rho u|u| / 2)
  heatTransfer?: boolean; // Reynolds analogy
  /** Total bend stagnation-pressure loss coefficient Kb (dp = Kb*rho*u^2/2), spread along the pipe as a momentum sink. See bendLossCoefficient(). */
  bendLossK?: number;
  initial: { p: number; T: number; u?: number; burnt?: number };
}

/** Boundary at a pipe end: a 0D node reached through an effective flow area. */
export interface NodeBoundary {
  p0: number;
  T0: number;
  gamma: number;
  R: number;
  burnt: number;
  effArea: number; // m^2, Cd*A; >= pipe area means fully open end; 0 = closed end
}

export interface EndFlux {
  mdot: number; // kg/s, + = into the pipe
  hFlux: number; // W, stagnation enthalpy
  burntFlux: number; // kg/s burnt gas
}

export function meshCells(lengthM: number, cellLengthM: number): number {
  return Math.max(1, Math.round(lengthM / cellLengthM));
}

const PR_AIR = 0.7;
const PR_AIR_23 = Math.pow(PR_AIR, 2 / 3);

/** Hancock half-step evolution of a cell's primitives (slopes are per-cell differences). */
function evolve(o: Float64Array, r: number, u: number, p: number, y: number, sr: number, su: number, sp: number, sy: number,
  hdx: number, hdt: number, g: number, ar: number): void {
  const gp = g * p;
  const ura = hdt * u * ar;
  const rr = r - hdx * (u * sr + r * su) - r * ura;
  const pp = p - hdx * (u * sp + gp * su) - gp * ura;
  o[0] = rr > 0 ? rr : r;
  o[1] = u - hdx * (u * su + sp / r);
  o[2] = pp > 0 ? pp : p;
  o[3] = y - hdx * u * sy;
}

/** Monotonised-central limited slope (no division). */
function mc(a: number, b: number): number {
  if (a * b <= 0) return 0;
  const c = 0.5 * (a + b);
  const m = Math.min(2 * Math.abs(a), 2 * Math.abs(b), Math.abs(c));
  return c > 0 ? m : -m;
}

export class Pipe1D {
  readonly nCells: number;
  readonly length: number;
  private readonly n: number;
  private readonly dx: number;
  private readonly diam: Float64Array; // per face
  private readonly Af: Float64Array; // face areas
  private readonly Vc: Float64Array; // cell volumes
  private readonly Dc: Float64Array; // cell diameters
  private g: number;
  private R: number;
  private readonly Tw: number;
  private readonly Cf: number;
  private readonly ht: boolean;
  // conserved per unit volume: rho, rho*u, E, rho*Y
  private q0: Float64Array; private q1: Float64Array; private q2: Float64Array; private q3: Float64Array;
  private s0: Float64Array; private s1: Float64Array; private s2: Float64Array; private s3: Float64Array;
  private r0: Float64Array; private r1: Float64Array; private r2: Float64Array; private r3: Float64Array;
  // primitives
  private rho: Float64Array; private u: Float64Array; private p: Float64Array; private y: Float64Array;
  private cs: Float64Array; private kf: Float64Array; private iVc: Float64Array;
  private hasLoss = false;
  private waveMax = 1;
  private waveValid = false;
  // boundary flux scratch (inward, includes area), per end: [m, mom, e, ybar]
  private b1 = new Float64Array(4);
  private b2 = new Float64Array(4);
  private acc1 = new Float64Array(4);
  private acc2 = new Float64Array(4);
  private end1: NodeBoundary | null = null;
  private end2: NodeBoundary | null = null;
  private readonly tmp: { mdot: number; mom: number; en: number; ys: number } = { mdot: 0, mom: 0, en: 0, ys: 0 };

  constructor(opts: PipeOptions) {
    const n = meshCells(opts.length, opts.cellLength);
    this.n = n;
    this.nCells = n;
    this.length = opts.length;
    this.dx = opts.length / n;
    this.g = opts.gamma;
    this.R = opts.R;
    this.Tw = opts.wallTemperature;
    this.Cf = opts.frictionFactor;
    this.ht = !!opts.heatTransfer;
    const mk = (m: number) => new Float64Array(m);
    this.diam = mk(n + 1); this.Af = mk(n + 1); this.Vc = mk(n); this.Dc = mk(n);
    for (let j = 0; j <= n; j++) {
      const d = Math.max(1e-4, opts.diameterAt(j * this.dx));
      this.diam[j] = d;
      this.Af[j] = (Math.PI / 4) * d * d;
    }
    for (let i = 0; i < n; i++) {
      const xm = (i + 0.5) * this.dx;
      const dm = Math.max(1e-4, opts.diameterAt(xm));
      const Am = (Math.PI / 4) * dm * dm;
      this.Dc[i] = dm;
      this.Vc[i] = ((this.Af[i] + 4 * Am + this.Af[i + 1]) / 6) * this.dx; // Simpson
    }
    this.q0 = mk(n); this.q1 = mk(n); this.q2 = mk(n); this.q3 = mk(n);
    this.s0 = mk(n); this.s1 = mk(n); this.s2 = mk(n); this.s3 = mk(n);
    this.r0 = mk(n); this.r1 = mk(n); this.r2 = mk(n); this.r3 = mk(n);
    this.rho = mk(n); this.u = mk(n); this.p = mk(n); this.y = mk(n);
    this.cs = mk(n); this.kf = mk(n); this.iVc = mk(n);
    const bendK = Math.max(0, opts.bendLossK ?? 0);
    for (let i = 0; i < n; i++) {
      this.iVc[i] = 1 / this.Vc[i];
      // distributed momentum sink: friction 2*Cf/D plus bend loss K/(2L), both times rho*u*|u|
      this.kf[i] = (2 * this.Cf) / this.Dc[i] + bendK / (2 * opts.length);
    }
    this.hasLoss = this.Cf > 0 || bendK > 0;
    this.updateConsts();
    const ini = opts.initial;
    for (let i = 0; i < n; i++) this.setCell(i, ini.p, ini.T, ini.u ?? 0, ini.burnt ?? 0);
  }

  private setCell(i: number, p: number, T: number, u: number, y: number): void {
    const rho = p / (this.R * T);
    this.q0[i] = rho;
    this.q1[i] = rho * u;
    this.q2[i] = p / (this.g - 1) + 0.5 * rho * u * u;
    this.q3[i] = rho * y;
  }

  /** Set a non-uniform initial state (e.g. shock tube). x in m. */
  initialize(f: (x: number) => { p: number; T: number; u?: number; burnt?: number }): void {
    for (let i = 0; i < this.n; i++) {
      const s = f((i + 0.5) * this.dx);
      this.setCell(i, s.p, s.T, s.u ?? 0, s.burnt ?? 0);
    }
    this.waveValid = false;
  }

  setGas(gamma: number, R: number): void {
    for (let i = 0; i < this.n; i++) {
      const rho = this.q0[i];
      const u = this.q1[i] / rho;
      const p = (this.g - 1) * (this.q2[i] - 0.5 * rho * u * u);
      const T = p / (rho * this.R);
      const nr = p / (R * T);
      const sc = nr / rho;
      this.q0[i] = nr;
      this.q1[i] = nr * u;
      this.q2[i] = p / (gamma - 1) + 0.5 * nr * u * u;
      this.q3[i] *= sc;
    }
    this.g = gamma;
    this.R = R;
    this.updateConsts();
    this.waveValid = false;
  }

  endArea(end: 1 | 2): number {
    return end === 1 ? this.Af[0] : this.Af[this.n];
  }

  maxStableDt(cfl = 0.7): number {
    if (!this.waveValid) this.computeWave();
    return (cfl * this.dx) / this.waveMax;
  }

  private computeWave(): void {
    const g = this.g, gm1 = g - 1;
    const { q0, q1, q2 } = this;
    let s = 1e-9;
    for (let i = 0; i < this.n; i++) {
      const r = q0[i] > 1e-6 ? q0[i] : 1e-6;
      const u = q1[i] / r;
      let p = gm1 * (q2[i] - 0.5 * r * u * u);
      if (!(p > 1e2)) p = 1e2;
      const w = Math.sqrt((g * p) / r) + Math.abs(u);
      if (w > s) s = w;
    }
    this.waveMax = s;
    this.waveValid = true;
  }

  private toPrim(a0: Float64Array, a1: Float64Array, a2: Float64Array, a3: Float64Array): void {
    const gm1 = this.g - 1, g = this.g;
    const { rho, u, p, y, cs } = this;
    for (let i = 0; i < this.n; i++) {
      const r = a0[i] > 1e-6 ? a0[i] : 1e-6;
      const ir = 1 / r;
      const uu = a1[i] * ir;
      let pp = gm1 * (a2[i] - 0.5 * r * uu * uu);
      if (!(pp > 1e2)) pp = 1e2;
      rho[i] = r;
      u[i] = uu;
      p[i] = pp;
      cs[i] = Math.sqrt(g * pp * ir);
      let yy = a3[i] * ir;
      if (yy < 0) yy = 0; else if (yy > 1) yy = 1;
      y[i] = yy;
    }
  }

  step(dt: number, end1: NodeBoundary, end2: NodeBoundary): { end1: EndFlux; end2: EndFlux } {
    this.end1 = end1;
    this.end2 = end2;
    this.acc1.fill(0);
    this.acc2.fill(0);
    if (dt > 0) {
      let rem = dt;
      for (let k = 0; k < 400; k++) {
        const nLeft = Math.max(1, Math.ceil((rem / this.maxStableDt(0.8)) * (1 - 1e-12)));
        const h = rem / nLeft;
        this.substep(h);
        rem -= h;
        if (nLeft === 1) break;
      }
    }
    return this.finishStep(dt);
  }

  private finishStep(dt: number): { end1: EndFlux; end2: EndFlux } {
    const inv = dt > 0 ? 1 / dt : 0;
    return {
      end1: { mdot: this.acc1[0] * inv, hFlux: this.acc1[2] * inv, burntFlux: this.acc1[3] * inv },
      end2: { mdot: this.acc2[0] * inv, hFlux: this.acc2[2] * inv, burntFlux: this.acc2[3] * inv },
    };
  }

  private substep(dt: number): void {
    this.dtCur = dt;
    const n = this.n;
    const { q0, q1, q2, q3, r0, r1, r2, r3 } = this;
    this.rhs(q0, q1, q2, q3);
    this.acc1[0] += dt * this.b1[0]; this.acc1[2] += dt * this.b1[2]; this.acc1[3] += dt * this.b1[3];
    this.acc2[0] += dt * this.b2[0]; this.acc2[2] += dt * this.b2[2]; this.acc2[3] += dt * this.b2[3];
    // update, apply split sources, clamp, and measure the next wave speed in one pass
    const g = this.g, gm1 = g - 1, R = this.R;
    const { kf, Dc } = this;
    const doFric = this.hasLoss;
    const ht = this.ht && this.Cf > 0;
    const St = ht ? this.Cf / 2 / PR_AIR_23 : 0;
    const Tw = this.Tw;
    let wmax = 1e-9;
    for (let i = 0; i < n; i++) {
      let rho = q0[i] + dt * r0[i];
      let mom = q1[i] + dt * r1[i];
      let E = q2[i] + dt * r2[i];
      let by = q3[i] + dt * r3[i];
      if (!(rho > 1e-6)) rho = 1e-6;
      let u = mom / rho;
      if (doFric) {
        const au = u < 0 ? -u : u;
        u = u / (1 + kf[i] * au * dt); // dissipation heats the gas: E unchanged
        mom = rho * u;
      }
      if (ht) {
        const au = u < 0 ? -u : u;
        if (au > 0) {
          const e = E - 0.5 * rho * u * u;
          const T = (gm1 * e) / (rho * R);
          const kd = (4 * St * au * g * dt) / Dc[i];
          E += (rho * R * ((Tw - T) * kd)) / ((1 + kd) * gm1);
        }
      }
      const kin = 0.5 * mom * u;
      const emin = kin + 1e3 / gm1;
      if (!(E > emin)) E = emin;
      if (by < 0) by = 0; else if (by > rho) by = rho;
      q0[i] = rho; q1[i] = mom; q2[i] = E; q3[i] = by;
      const p = gm1 * (E - kin);
      const w = Math.sqrt((g * (p > 1e2 ? p : 1e2)) / rho) + (u < 0 ? -u : u);
      if (w > wmax) wmax = w;
    }
    this.waveMax = wmax;
    this.waveValid = true;
  }

  /** Never let a boundary drain more than a fraction of the end cell's mass in one stage. */
  private limitOut(t: { mdot: number; mom: number; en: number; ys: number }, cellMass: number): void {
    if (t.mdot < 0) {
      const maxOut = (0.25 * cellMass) / this.dtCur;
      if (-t.mdot > maxOut) {
        const f = maxOut / -t.mdot;
        t.mdot *= f; t.en *= f; t.ys *= f;
      }
    }
  }

  private dtCur = 1;
  private readonly evo = new Float64Array(4);

  /** One RK stage: face fluxes (fused with slope limiting and the cell residual update). */
  private rhs(a0: Float64Array, a1: Float64Array, a2: Float64Array, a3: Float64Array): void {
    const n = this.n;
    const gm1 = this.g - 1;
    this.toPrim(a0, a1, a2, a3);
    const { rho, u, p, y, cs, r0, r1, r2, r3, Af, iVc } = this;
    const t = this.tmp;
    this.curEnd = 0;
    this.boundary(rho[0], u[0], p[0], y[0], this.end1!, Af[0], t);
    this.limitOut(t, rho[0] / iVc[0]);
    const b1 = this.b1;
    b1[0] = t.mdot; b1[1] = t.mom; b1[2] = t.en; b1[3] = t.ys;
    let P0 = t.mdot, P1 = t.mom, P2 = t.en, P3 = t.ys;
    const hdx = (0.5 * this.dtCur) / this.dx, hdt = 0.5 * this.dtCur, g = this.g;
    const ev = this.evo;
    // Hancock half-step evolved state of the left cell, extrapolated to its right face
    evolve(ev, rho[0], u[0], p[0], y[0], 0, 0, 0, 0, hdx, hdt, g, (Af[1] - Af[0]) * iVc[0]);
    let rL0 = ev[0], uL0 = ev[1], pL0 = ev[2], yL0 = ev[3];
    let sr = 0, su = 0, sp = 0, sy = 0; // limited slopes of the left cell
    for (let j = 1; j < n; j++) {
      const l = j - 1;
      let tr = 0, tu = 0, tp = 0, ty = 0;
      if (j < n - 1) {
        tr = mc(rho[j] - rho[l], rho[j + 1] - rho[j]);
        tu = mc(u[j] - u[l], u[j + 1] - u[j]);
        tp = mc(p[j] - p[l], p[j + 1] - p[j]);
        ty = mc(y[j] - y[l], y[j + 1] - y[j]);
      }
      evolve(ev, rho[j], u[j], p[j], y[j], tr, tu, tp, ty, hdx, hdt, g, (Af[j + 1] - Af[j]) * iVc[j]);
      let rL = rL0 + 0.5 * sr, uL = uL0 + 0.5 * su, pL = pL0 + 0.5 * sp, yL = yL0 + 0.5 * sy;
      let rR = ev[0] - 0.5 * tr, uR = ev[1] - 0.5 * tu, pR = ev[2] - 0.5 * tp, yR = ev[3] - 0.5 * ty;
      rL0 = ev[0]; uL0 = ev[1]; pL0 = ev[2]; yL0 = ev[3];
      if (!(rL > 0 && pL > 0)) { rL = rho[l]; uL = u[l]; pL = p[l]; yL = y[l]; }
      if (!(rR > 0 && pR > 0)) { rR = rho[j]; uR = u[j]; pR = p[j]; yR = y[j]; }
      const aL = cs[l], aR = cs[j];
      const EL = pL / gm1 + 0.5 * rL * uL * uL, ER = pR / gm1 + 0.5 * rR * uR * uR;
      const SL = Math.min(uL - aL, uR - aR);
      const SR = Math.max(uL + aL, uR + aR);
      let f0: number, f1: number, f2: number, f3: number;
      if (SL >= 0) {
        f0 = rL * uL; f1 = f0 * uL + pL; f2 = (EL + pL) * uL; f3 = f0 * yL;
      } else if (SR <= 0) {
        f0 = rR * uR; f1 = f0 * uR + pR; f2 = (ER + pR) * uR; f3 = f0 * yR;
      } else {
        const dL = rL * (SL - uL), dR = rR * (SR - uR);
        const Sm = (pR - pL + dL * uL - dR * uR) / (dL - dR);
        if (Sm >= 0) {
          const k = dL / (SL - Sm);
          f0 = rL * uL + SL * (k - rL);
          f1 = rL * uL * uL + pL + SL * (k * Sm - rL * uL);
          f2 = (EL + pL) * uL + SL * (k * (EL / rL + (Sm - uL) * (Sm + pL / dL)) - EL);
          f3 = f0 * yL;
        } else {
          const k = dR / (SR - Sm);
          f0 = rR * uR + SR * (k - rR);
          f1 = rR * uR * uR + pR + SR * (k * Sm - rR * uR);
          f2 = (ER + pR) * uR + SR * (k * (ER / rR + (Sm - uR) * (Sm + pR / dR)) - ER);
          f3 = f0 * yR;
        }
      }
      const A = Af[j];
      f0 *= A; f1 *= A; f2 *= A; f3 *= A;
      const iv = iVc[l];
      r0[l] = (P0 - f0) * iv;
      r1[l] = (P1 - f1 + p[l] * (A - Af[l])) * iv;
      r2[l] = (P2 - f2) * iv;
      r3[l] = (P3 - f3) * iv;
      P0 = f0; P1 = f1; P2 = f2; P3 = f3;
      sr = tr; su = tu; sp = tp; sy = ty;
    }
    this.curEnd = 1;
    this.boundary(rho[n - 1], -u[n - 1], p[n - 1], y[n - 1], this.end2!, Af[n], t);
    this.limitOut(t, rho[n - 1] / iVc[n - 1]);
    const b2 = this.b2;
    b2[0] = t.mdot; b2[1] = t.mom; b2[2] = t.en; b2[3] = t.ys;
    // axis flux: mass/energy/burnt change sign, momentum flux (rho u^2 + p) does not
    const l = n - 1, iv = iVc[l];
    r0[l] = (P0 + t.mdot) * iv;
    r1[l] = (P1 - t.mom + p[l] * (Af[n] - Af[l])) * iv;
    r2[l] = (P2 + t.en) * iv;
    r3[l] = (P3 + t.ys) * iv;
  }

  /**
   * Quasi-steady end flux, in the frame where positive = into the pipe.
   * (rho, uIn, p, y): end cell state with uIn positive into the pipe.
   * Output fluxes include the area: mass kg/s, momentum N, energy W, burnt kg/s.
   */
  private boundary(rc: number, uIn: number, pc: number, yc: number, nb: NodeBoundary, A: number,
    out: { mdot: number; mom: number; en: number; ys: number }): void {
    const g = this.g, R = this.R;
    const cp = (g * R) / (g - 1);
    const Ae = Math.min(nb.effArea, A);
    if (!(Ae > 1e-9 * A)) {
      // closed end: exact wall pressure for a cell moving at -uIn toward the wall
      const a = Math.sqrt((g * pc) / rc);
      const w = -uIn; // velocity toward the wall
      const z = w / a;
      let pw: number;
      if (z >= 0) {
        const c = ((g + 1) / 4) * z;
        pw = pc * (1 + g * z * (c + Math.sqrt(c * c + 1)));
      } else {
        const b = 1 + ((g - 1) / 2) * z;
        pw = pc * Math.pow(Math.max(b, 0), (2 * g) / (g - 1));
      }
      out.mdot = 0; out.mom = pw * A; out.en = 0; out.ys = 0;
      return;
    }
    // Partially open end: find the face pressure pf where the nozzle flow between node and pipe
    // equals the flow the pipe's outgoing characteristic can deliver. Bounded gain, so explicit stepping is stable.
    const ev = this.ev;
    ev.pc = pc; ev.rc = rc; ev.uc = uIn; ev.A = A; ev.Ae = Ae; ev.nb = nb;
    ev.ac = Math.sqrt((g * pc) / rc);
    {
      const kk = (g - 1) / (2 * g), c2 = 2 / (g - 1);
      const a0 = Math.sqrt(g * R * nb.T0);
      ev.p0 = nb.p0;
      // outflow: u_f = -a_f on the cell's isentrope
      const afo = (c2 * ev.ac - uIn) / (c2 + 1);
      ev.pSonOut = afo > 0 ? pc * Math.pow(afo / ev.ac, 1 / kk) : 0;
      // inflow: u_f = +a_f on the node's isentrope
      const afi = (c2 * ev.ac - uIn) / (c2 - 1);
      void a0;
      ev.pSonIn = afi > 0 ? pc * Math.pow(afi / ev.ac, 1 / kk) : Infinity;
    }
    const pLo = 1e-2 * Math.min(pc, nb.p0), pHi = 100 * Math.max(pc, nb.p0);
    // Solve in z = sign(pf-p0)*sqrt(|pf-p0|/sc): the nozzle flow is ~linear in z (no sqrt cusp at pf = p0).
    const sc = 1e-2 * nb.p0;
    const isc = 1 / sc;
    const toZ = (pf: number): number => (pf >= nb.p0 ? Math.sqrt((pf - nb.p0) * isc) : -Math.sqrt((nb.p0 - pf) * isc));
    const toP = (z: number): number => {
      const v = nb.p0 + (z >= 0 ? z * z : -z * z) * sc;
      return v < pLo ? pLo : v > pHi ? pHi : v;
    };
    const zLo = toZ(pLo), zHi = toZ(pHi);
    const h = (z: number): number => this.evalFace(toP(z));
    let x = toZ(Math.min(Math.max(this.pfGuess[this.curEnd] > 0 ? this.pfGuess[this.curEnd] : pc, pLo), pHi));
    const hx = h(x);
    const tolH = 2e-3;
    // fast path: safeguarded secant from the warm start (ev is left valid at the returned point)
    if (Math.abs(hx) <= tolH * ev.hscale) { this.finishFace(toP(x), out, A, nb, yc); return; }
    {
      let x0 = x, h0 = hx;
      let x1 = x + (hx > 0 ? 0.05 : -0.05);
      if (x1 > zHi) x1 = zHi; else if (x1 < zLo) x1 = zLo;
      let h1 = h(x1);
      for (let it = 0; it < 7; it++) {
        if (Math.abs(h1) <= tolH * ev.hscale) { this.finishFace(toP(x1), out, A, nb, yc); return; }
        if (h1 === h0) break;
        let x2 = x1 - (h1 * (x1 - x0)) / (h1 - h0);
        if (!(x2 > zLo)) x2 = zLo; else if (x2 > zHi) x2 = zHi;
        const h2 = h(x2);
        if (Math.abs(h2) <= tolH * ev.hscale || Math.abs(x2 - x1) < 1e-4 * (1 + Math.abs(x2))) { this.finishFace(toP(x2), out, A, nb, yc); return; }
        x0 = x1; h0 = h1; x1 = x2; h1 = h2;
      }
    }
    // fallback: bracket (h decreases with z), then Illinois
    let xa = x, ha = hx, xb = x, hb = hx;
    {
      let step = 0.1;
      const up = hx > 0;
      for (let it = 0; it < 60; it++) {
        let xn = up ? xb + step : xa - step;
        if (xn > zHi) xn = zHi; else if (xn < zLo) xn = zLo;
        const hn = h(xn);
        if (up) { xa = xb; ha = hb; xb = xn; hb = hn; if (hn <= 0 || xn >= zHi) break; }
        else { xb = xa; hb = ha; xa = xn; ha = hn; if (hn >= 0 || xn <= zLo) break; }
        step *= 1.6;
      }
      let side = 0;
      for (let it = 0; it < 40; it++) {
        if (Math.abs(xb - xa) < 1e-6 * (1 + Math.abs(xb)) || ha === hb || !(ha >= 0 && hb <= 0)) break;
        const xm = (xa * hb - xb * ha) / (hb - ha);
        const hm = h(xm);
        if (hm === 0) { xa = xb = xm; break; }
        if (hm > 0) { xa = xm; ha = hm; if (side === 1) hb *= 0.5; side = 1; }
        else { xb = xm; hb = hm; if (side === -1) ha *= 0.5; side = -1; }
      }
    }
    const zf = ha >= 0 && hb <= 0 ? 0.5 * (xa + xb) : Math.abs(ha) < Math.abs(hb) ? xa : xb;
    h(zf);
    this.finishFace(toP(zf), out, A, nb, yc);
  }

  /** Store the solution and fill the flux; ev must hold the state evaluated at pf. */
  private finishFace(pf: number, out: { mdot: number; mom: number; en: number; ys: number }, A: number, nb: NodeBoundary, yc: number): void {
    const ev = this.ev;
    this.pfGuess[this.curEnd] = pf;
    out.mdot = ev.mIn;
    out.mom = ev.mIn * ev.uf + ev.pf * A;
    out.en = ev.mIn * ev.h0;
    out.ys = ev.mIn * (ev.mIn > 0 ? nb.burnt : yc);
  }

  private readonly ev = {
    pc: 0, rc: 0, uc: 0, A: 0, Ae: 0, ac: 0,
    nb: null as unknown as NodeBoundary,
    mIn: 0, uf: 0, h0: 0, pf: 0, hres: 0, hscale: 1, p0: 0, pSonIn: 0, pSonOut: 0,
  };
  private readonly pfGuess = new Float64Array(2).fill(NaN);
  private curEnd = 0;

  /** Nozzle mass flow (>= 0) from stagnation (pu, Tu) to static pd through area Ae. */
  private nozzle(pu: number, Tu: number, pd: number, Ae: number): number {
    if (!(pd < pu)) return 0;
    const g = this.g, R = this.R;
    const pr = pd / pu;
    if (pr <= this.kCrit) return Ae * pu * Math.sqrt(g / (R * Tu)) * this.kChoke;
    const lr = Math.log(pr);
    const e2 = Math.exp((2 / g) * lr);
    const pg = e2 * (1 - Math.exp(this.kGm1g * lr));
    return Ae * pu * Math.sqrt(((2 * g) / ((g - 1) * R * Tu)) * (pg > 0 ? pg : 0));
  }

  private kCrit = 0; private kChoke = 0; private kGm1g = 0;
  private updateConsts(): void {
    const g = this.g;
    this.kCrit = Math.pow(2 / (g + 1), g / (g - 1));
    this.kChoke = Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
    this.kGm1g = (g - 1) / g;
  }

  /** Mismatch (nozzle flow minus pipe-side flow, into the pipe) for a trial face pressure; fills ev. */
  private evalFace(pfTrial: number): number {
    const g = this.g, R = this.R, ev = this.ev;
    const cp = (g * R) / (g - 1);
    const k = (g - 1) / (2 * g), c2 = 2 / (g - 1);
    const nb = ev.nb;
    // Face velocity always from the pipe's outgoing characteristic on the cell-gas isentrope
    // (pressure and velocity are continuous across a contact with entering node gas).
    let pf = pfTrial;
    let lx = Math.log(pf / ev.pc);
    let af = ev.ac * Math.exp(k * lx);
    let uf = ev.uc + c2 * (af - ev.ac);
    if (uf < 0 && pf < ev.pSonOut) {
      pf = ev.pSonOut; // outflow limited to sonic at the face
      lx = Math.log(pf / ev.pc);
      af = ev.ac * Math.exp(k * lx);
      uf = ev.uc + c2 * (af - ev.ac);
    }
    if (uf > 0 && pf > ev.pSonIn) {
      pf = ev.pSonIn; // inflow limited to sonic at the face (upper bound on pf)
      lx = Math.log(pf / ev.pc);
      af = ev.ac * Math.exp(k * lx);
      uf = ev.uc + c2 * (af - ev.ac);
    }
    let N: number;
    if (uf < 0) {
      const rf = ev.rc * Math.exp(lx / g);
      const Tf = (af * af) / (g * R);
      const Tt = Tf + (uf * uf) / (2 * cp);
      const pt = pf * Math.pow(Tt / Tf, g / (g - 1));
      N = nb.p0 > pt ? this.nozzle(nb.p0, nb.T0, pt, ev.Ae) : -this.nozzle(pt, Tt, nb.p0, ev.Ae);
      ev.mIn = rf * uf * ev.A;
      ev.h0 = cp * Tt;
    } else {
      const rf = (nb.p0 / (R * nb.T0)) * Math.exp(Math.log(pf / nb.p0) / g);
      const Tf = (af * af) / (g * R);
      N = nb.p0 > pf ? this.nozzle(nb.p0, nb.T0, pf, ev.Ae) : -this.nozzle(pf, Tf, nb.p0, ev.Ae);
      ev.mIn = rf * uf * ev.A;
      ev.h0 = cp * nb.T0;
    }
    ev.uf = uf;
    ev.pf = pf;
    ev.hres = N - ev.mIn;
    ev.hscale = (N < 0 ? -N : N) + (ev.mIn < 0 ? -ev.mIn : ev.mIn) + 1e-6 * ev.A;
    return ev.hres;
  }

  sample(xFraction: number): { p: number; T: number; u: number; rho: number; burnt: number } {
    this.toPrim(this.q0, this.q1, this.q2, this.q3);
    const n = this.n;
    let s = xFraction * n - 0.5;
    if (s < 0) s = 0;
    if (s > n - 1) s = n - 1;
    const i = Math.min(n - 2 < 0 ? 0 : n - 2, Math.floor(s));
    const f = n === 1 ? 0 : s - i;
    const j = n === 1 ? 0 : i + 1;
    const rho = this.rho[i] * (1 - f) + this.rho[j] * f;
    const p = this.p[i] * (1 - f) + this.p[j] * f;
    const u = this.u[i] * (1 - f) + this.u[j] * f;
    const burnt = this.y[i] * (1 - f) + this.y[j] * f;
    return { p, T: p / (rho * this.R), u, rho, burnt };
  }

  profile(): { x: number[]; p: number[]; T: number[]; u: number[] } {
    this.toPrim(this.q0, this.q1, this.q2, this.q3);
    const x: number[] = [], p: number[] = [], T: number[] = [], u: number[] = [];
    for (let i = 0; i < this.n; i++) {
      x.push((i + 0.5) * this.dx);
      p.push(this.p[i]);
      T.push(this.p[i] / (this.rho[i] * this.R));
      u.push(this.u[i]);
    }
    return { x, p, T, u };
  }

  totalMass(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m += this.q0[i] * this.Vc[i];
    return m;
  }

  totalEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) e += this.q2[i] * this.Vc[i];
    return e;
  }

  /** Total burnt-gas mass. */
  totalBurnt(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) e += this.q3[i] * this.Vc[i];
    return e;
  }
}
