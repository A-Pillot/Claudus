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

function vanLeer(a: number, b: number): number {
  const ab = a * b;
  return ab > 0 ? (2 * ab) / (a + b) : 0;
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
  private dr: Float64Array; private du: Float64Array; private dp: Float64Array; private dy: Float64Array;
  private F0: Float64Array; private F1: Float64Array; private F2: Float64Array; private F3: Float64Array;
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
    this.dr = mk(n); this.du = mk(n); this.dp = mk(n); this.dy = mk(n);
    this.F0 = mk(n + 1); this.F1 = mk(n + 1); this.F2 = mk(n + 1); this.F3 = mk(n + 1);
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
  }

  endArea(end: 1 | 2): number {
    return end === 1 ? this.Af[0] : this.Af[this.n];
  }

  maxStableDt(cfl = 0.7): number {
    this.toPrim(this.q0, this.q1, this.q2, this.q3);
    let s = 1e-9;
    const g = this.g;
    for (let i = 0; i < this.n; i++) {
      const a = Math.sqrt((g * this.p[i]) / this.rho[i]) + Math.abs(this.u[i]);
      if (a > s) s = a;
    }
    return (cfl * this.dx) / s;
  }

  private toPrim(a0: Float64Array, a1: Float64Array, a2: Float64Array, a3: Float64Array): void {
    const gm1 = this.g - 1;
    for (let i = 0; i < this.n; i++) {
      const rho = a0[i] > 1e-6 ? a0[i] : 1e-6;
      const u = a1[i] / rho;
      let p = gm1 * (a2[i] - 0.5 * rho * u * u);
      if (!(p > 1e2)) p = 1e2;
      this.rho[i] = rho;
      this.u[i] = u;
      this.p[i] = p;
      let yy = a3[i] / rho;
      if (yy < 0) yy = 0; else if (yy > 1) yy = 1;
      this.y[i] = yy;
    }
  }

  step(dt: number, end1: NodeBoundary, end2: NodeBoundary): { end1: EndFlux; end2: EndFlux } {
    this.end1 = end1;
    this.end2 = end2;
    this.acc1.fill(0);
    this.acc2.fill(0);
    if (dt > 0) {
      const dtMax = this.maxStableDt(0.8);
      const nSub = Math.min(400, Math.max(1, Math.ceil(dt / dtMax)));
      const h = dt / nSub;
      for (let k = 0; k < nSub; k++) this.substep(h);
    }
    const inv = dt > 0 ? 1 / dt : 0;
    return {
      end1: { mdot: this.acc1[0] * inv, hFlux: this.acc1[2] * inv, burntFlux: this.acc1[3] * inv },
      end2: { mdot: this.acc2[0] * inv, hFlux: this.acc2[2] * inv, burntFlux: this.acc2[3] * inv },
    };
  }

  private substep(dt: number): void {
    this.dtCur = dt;
    const n = this.n;
    // stage 1
    this.rhs(this.q0, this.q1, this.q2, this.q3);
    let w1a = this.b1[0], w1b = this.b1[2], w1c = this.b1[3];
    let w2a = this.b2[0], w2b = this.b2[2], w2c = this.b2[3];
    for (let i = 0; i < n; i++) {
      this.s0[i] = this.q0[i] + dt * this.r0[i];
      this.s1[i] = this.q1[i] + dt * this.r1[i];
      this.s2[i] = this.q2[i] + dt * this.r2[i];
      this.s3[i] = this.q3[i] + dt * this.r3[i];
    }
    this.clamp(this.s0, this.s1, this.s2, this.s3);
    // stage 2
    this.rhs(this.s0, this.s1, this.s2, this.s3);
    for (let i = 0; i < n; i++) {
      this.q0[i] = 0.5 * this.q0[i] + 0.5 * (this.s0[i] + dt * this.r0[i]);
      this.q1[i] = 0.5 * this.q1[i] + 0.5 * (this.s1[i] + dt * this.r1[i]);
      this.q2[i] = 0.5 * this.q2[i] + 0.5 * (this.s2[i] + dt * this.r2[i]);
      this.q3[i] = 0.5 * this.q3[i] + 0.5 * (this.s3[i] + dt * this.r3[i]);
    }
    w1a = 0.5 * (w1a + this.b1[0]); w1b = 0.5 * (w1b + this.b1[2]); w1c = 0.5 * (w1c + this.b1[3]);
    w2a = 0.5 * (w2a + this.b2[0]); w2b = 0.5 * (w2b + this.b2[2]); w2c = 0.5 * (w2c + this.b2[3]);
    this.acc1[0] += dt * w1a; this.acc1[2] += dt * w1b; this.acc1[3] += dt * w1c;
    this.acc2[0] += dt * w2a; this.acc2[2] += dt * w2b; this.acc2[3] += dt * w2c;
    this.sources(dt);
    this.clamp(this.q0, this.q1, this.q2, this.q3);
  }

  private clamp(a0: Float64Array, a1: Float64Array, a2: Float64Array, a3: Float64Array): void {
    const gm1 = this.g - 1;
    for (let i = 0; i < this.n; i++) {
      if (!(a0[i] > 1e-6)) a0[i] = 1e-6;
      const rho = a0[i];
      const kin = (0.5 * a1[i] * a1[i]) / rho;
      const emin = kin + 1e3 / gm1;
      if (!(a2[i] > emin)) a2[i] = emin;
      if (a3[i] < 0) a3[i] = 0; else if (a3[i] > rho) a3[i] = rho;
    }
  }

  /** Friction and heat transfer (split, semi-implicit). */
  private sources(dt: number): void {
    const g = this.g;
    const cf = this.Cf;
    for (let i = 0; i < this.n; i++) {
      const rho = this.q0[i];
      const u = this.q1[i] / rho;
      const au = Math.abs(u);
      if (cf > 0 && au > 0) {
        const un = u / (1 + (2 * cf * au * dt) / this.Dc[i]);
        this.q1[i] = rho * un; // total energy unchanged: dissipation heats the gas
      }
      if (this.ht && au > 0) {
        const uu = this.q1[i] / rho;
        const e = this.q2[i] - 0.5 * rho * uu * uu;
        const T = ((g - 1) * e) / (rho * this.R);
        const St = cf / 2 / Math.pow(PR_AIR, 2 / 3);
        const k = (4 * St * Math.abs(uu) * g) / this.Dc[i];
        const dT = (this.Tw - T) * (1 - Math.exp(-k * dt));
        this.q2[i] += (rho * this.R * dT) / (g - 1);
      }
    }
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

  private rhs(a0: Float64Array, a1: Float64Array, a2: Float64Array, a3: Float64Array): void {
    const n = this.n;
    const g = this.g;
    const gm1 = g - 1;
    this.toPrim(a0, a1, a2, a3);
    const { rho, u, p, y, dr, du, dp, dy, F0, F1, F2, F3, Af, Vc } = this;
    for (let i = 1; i < n - 1; i++) {
      dr[i] = vanLeer(rho[i] - rho[i - 1], rho[i + 1] - rho[i]);
      du[i] = vanLeer(u[i] - u[i - 1], u[i + 1] - u[i]);
      dp[i] = vanLeer(p[i] - p[i - 1], p[i + 1] - p[i]);
      dy[i] = vanLeer(y[i] - y[i - 1], y[i + 1] - y[i]);
    }
    if (n > 0) { dr[0] = du[0] = dp[0] = dy[0] = 0; dr[n - 1] = du[n - 1] = dp[n - 1] = dy[n - 1] = 0; }
    // interior faces
    for (let j = 1; j < n; j++) {
      const l = j - 1, r = j;
      let rL = rho[l] + 0.5 * dr[l], uL = u[l] + 0.5 * du[l], pL = p[l] + 0.5 * dp[l], yL = y[l] + 0.5 * dy[l];
      let rR = rho[r] - 0.5 * dr[r], uR = u[r] - 0.5 * du[r], pR = p[r] - 0.5 * dp[r], yR = y[r] - 0.5 * dy[r];
      if (!(rL > 0 && pL > 0)) { rL = rho[l]; uL = u[l]; pL = p[l]; yL = y[l]; }
      if (!(rR > 0 && pR > 0)) { rR = rho[r]; uR = u[r]; pR = p[r]; yR = y[r]; }
      const aL = Math.sqrt((g * pL) / rL), aR = Math.sqrt((g * pR) / rR);
      const EL = pL / gm1 + 0.5 * rL * uL * uL, ER = pR / gm1 + 0.5 * rR * uR * uR;
      const SL = Math.min(uL - aL, uR - aR);
      const SR = Math.max(uL + aL, uR + aR);
      const A = Af[j];
      let f0: number, f1: number, f2: number, f3: number;
      if (SL >= 0) {
        f0 = rL * uL; f1 = rL * uL * uL + pL; f2 = (EL + pL) * uL; f3 = f0 * yL;
      } else if (SR <= 0) {
        f0 = rR * uR; f1 = rR * uR * uR + pR; f2 = (ER + pR) * uR; f3 = f0 * yR;
      } else {
        const Sm = (pR - pL + rL * uL * (SL - uL) - rR * uR * (SR - uR)) / (rL * (SL - uL) - rR * (SR - uR));
        if (Sm >= 0) {
          const k = (rL * (SL - uL)) / (SL - Sm);
          const fl0 = rL * uL, fl1 = rL * uL * uL + pL, fl2 = (EL + pL) * uL;
          f0 = fl0 + SL * (k - rL);
          f1 = fl1 + SL * (k * Sm - rL * uL);
          f2 = fl2 + SL * (k * (EL / rL + (Sm - uL) * (Sm + pL / (rL * (SL - uL)))) - EL);
          f3 = f0 * yL;
        } else {
          const k = (rR * (SR - uR)) / (SR - Sm);
          const fr0 = rR * uR, fr1 = rR * uR * uR + pR, fr2 = (ER + pR) * uR;
          f0 = fr0 + SR * (k - rR);
          f1 = fr1 + SR * (k * Sm - rR * uR);
          f2 = fr2 + SR * (k * (ER / rR + (Sm - uR) * (Sm + pR / (rR * (SR - uR)))) - ER);
          f3 = f0 * yR;
        }
      }
      F0[j] = f0 * A; F1[j] = f1 * A; F2[j] = f2 * A; F3[j] = f3 * A;
    }
    // boundaries
    const t = this.tmp;
    this.curEnd = 0;
    this.boundary(rho[0], u[0], p[0], y[0], this.end1!, Af[0], t);
    this.limitOut(t, rho[0] * Vc[0]);
    F0[0] = t.mdot; F1[0] = t.mom; F2[0] = t.en; F3[0] = t.ys;
    this.b1[0] = t.mdot; this.b1[1] = t.mom; this.b1[2] = t.en; this.b1[3] = t.ys;
    this.curEnd = 1;
    this.boundary(rho[n - 1], -u[n - 1], p[n - 1], y[n - 1], this.end2!, Af[n], t);
    this.limitOut(t, rho[n - 1] * Vc[n - 1]);
    // axis flux: mass/energy/burnt change sign, momentum flux (rho u^2 + p) does not
    F0[n] = -t.mdot; F1[n] = t.mom; F2[n] = -t.en; F3[n] = -t.ys;
    this.b2[0] = t.mdot; this.b2[1] = t.mom; this.b2[2] = t.en; this.b2[3] = t.ys;
    // update
    for (let i = 0; i < n; i++) {
      const iv = 1 / Vc[i];
      this.r0[i] = (F0[i] - F0[i + 1]) * iv;
      this.r1[i] = (F1[i] - F1[i + 1]) * iv + (p[i] * (Af[i + 1] - Af[i])) * iv;
      this.r2[i] = (F2[i] - F2[i + 1]) * iv;
      this.r3[i] = (F3[i] - F3[i + 1]) * iv;
    }
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
    const h = (pf: number): number => this.evalFace(pf);
    let x = this.pfGuess[this.curEnd];
    if (!(x > 0) || !Number.isFinite(x)) x = pc;
    if (x < pLo) x = pLo; else if (x > pHi) x = pHi;
    let hx = h(x);
    let xa = x, ha = hx, xb = x, hb = hx;
    if (hx !== 0) {
      let step = 1.02;
      const up = hx > 0; // h decreases with pf
      for (let it = 0; it < 60; it++) {
        let xn = up ? xb * step : xa / step;
        if (xn > pHi) xn = pHi; else if (xn < pLo) xn = pLo;
        const hn = h(xn);
        if (up) { xa = xb; ha = hb; xb = xn; hb = hn; if (hn <= 0 || xn >= pHi) break; }
        else { xb = xa; hb = ha; xa = xn; ha = hn; if (hn >= 0 || xn <= pLo) break; }
        step *= 1.6;
      }
      // Illinois on [xa, xb] with ha >= 0 >= hb
      let side = 0;
      for (let it = 0; it < 40; it++) {
        if (Math.abs(xb - xa) < 1e-5 * xb || ha === hb || !(ha >= 0 && hb <= 0)) break;
        const xm = (xa * hb - xb * ha) / (hb - ha);
        const hm = h(xm);
        if (hm === 0) { xa = xb = xm; break; }
        if (hm > 0) { xa = xm; ha = hm; if (side === 1) hb *= 0.5; side = 1; }
        else { xb = xm; hb = hm; if (side === -1) ha *= 0.5; side = -1; }
      }
    }
    const pf = ha >= 0 && hb <= 0 ? 0.5 * (xa + xb) : Math.abs(ha) < Math.abs(hb) ? xa : xb;
    this.pfGuess[this.curEnd] = pf;
    h(pf);
    out.mdot = ev.mIn;
    out.mom = ev.mIn * ev.uf + ev.pf * A;
    out.en = ev.mIn * ev.h0;
    out.ys = ev.mIn * (ev.mIn > 0 ? nb.burnt : yc);
  }

  private readonly ev = {
    pc: 0, rc: 0, uc: 0, A: 0, Ae: 0, ac: 0,
    nb: null as unknown as NodeBoundary,
    mIn: 0, uf: 0, h0: 0, pf: 0, p0: 0, pSonIn: 0, pSonOut: 0,
  };
  private readonly pfGuess = new Float64Array(2).fill(NaN);
  private curEnd = 0;

  /** Nozzle mass flow (>= 0) from stagnation (pu, Tu) to static pd through area Ae. */
  private nozzle(pu: number, Tu: number, pd: number, Ae: number): number {
    if (!(pd < pu)) return 0;
    const g = this.g, R = this.R;
    const pr = pd / pu;
    const crit = Math.pow(2 / (g + 1), g / (g - 1));
    if (pr <= crit) return Ae * pu * Math.sqrt(g / (R * Tu)) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
    const pg = Math.pow(pr, 2 / g) - Math.pow(pr, (g + 1) / g);
    return Ae * pu * Math.sqrt(((2 * g) / ((g - 1) * R * Tu)) * Math.max(pg, 0));
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
    let af = ev.ac * Math.pow(pf / ev.pc, k);
    let uf = ev.uc + c2 * (af - ev.ac);
    if (uf < 0 && pf < ev.pSonOut) {
      pf = ev.pSonOut; // outflow limited to sonic at the face
      af = ev.ac * Math.pow(pf / ev.pc, k);
      uf = ev.uc + c2 * (af - ev.ac);
    }
    if (uf > 0 && pf > ev.pSonIn) {
      pf = ev.pSonIn; // inflow limited to sonic at the face (upper bound on pf)
      af = ev.ac * Math.pow(pf / ev.pc, k);
      uf = ev.uc + c2 * (af - ev.ac);
    }
    let N: number;
    if (uf < 0) {
      const rf = ev.rc * Math.pow(pf / ev.pc, 1 / g);
      const Tf = (af * af) / (g * R);
      const Tt = Tf + (uf * uf) / (2 * cp);
      const pt = pf * Math.pow(Tt / Tf, g / (g - 1));
      N = nb.p0 > pt ? this.nozzle(nb.p0, nb.T0, pt, ev.Ae) : -this.nozzle(pt, Tt, nb.p0, ev.Ae);
      ev.mIn = rf * uf * ev.A;
      ev.h0 = cp * Tt;
    } else {
      const rf = (nb.p0 / (R * nb.T0)) * Math.pow(pf / nb.p0, 1 / g);
      const Tf = (af * af) / (g * R);
      N = nb.p0 > pf ? this.nozzle(nb.p0, nb.T0, pf, ev.Ae) : -this.nozzle(pf, Tf, nb.p0, ev.Ae);
      ev.mIn = rf * uf * ev.A;
      ev.h0 = cp * nb.T0;
    }
    ev.uf = uf;
    ev.pf = pf;
    return N - ev.mIn;
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
