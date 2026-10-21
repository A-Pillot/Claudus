// Turbo machinery for the network solver: map based compressors and turbines, positive displacement
// superchargers, charge coolers, the shaft speed balance and the sensor -> control -> actuator chain that
// drives a waste-gate (a throttle whose area is set by a boost pressure controller).
//
// Models (quasi-steady, evaluated every time step between the two 0D nodes the element joins):
//  - Compressor: SAE J1826 style map. Corrected speed N/sqrt(T01/Tref), flow m*sqrt(T01/Tref)/(p01/pref); the
//    constant speed lines are interpolated at the instantaneous pressure ratio (surge side: flow decays to zero,
//    choke side: flow rises gently, outside the speed range: affinity scaling). T02 from isentropic efficiency.
//  - Turbine: corrected flow m*sqrt(T01)/p01[kPa] and efficiency from the map at N/sqrt(T01) and p01/p02
//    (choked above the last map point, linear to zero flow at pressure ratio 1, no reverse flow).
//  - Shaft: 0.5*I*w^2 integrated from turbine power * mech efficiency - compressor power / mech efficiency.
//  - Positive displacement supercharger: swept volume * speed * volumetric efficiency, isentropic efficiency for
//    outlet temperature, adiabatic efficiency for the power taken from the crank.
//  - Charge cooler: mass flow from the instantaneous pressure drop (table inverse), outlet temperature from
//    effectiveness and coolant temperature.
//  - Controller: moving-average / limit / lookup / user function chain inferred from the CONTROLS section.
import type { Compressor, Cooler, EngineModel, Fuel, Turbine, TurboMap } from '../model';
import type { TurboSummary, TurboTrace } from '../results';
import { compileExpression } from '../sim/turbo';
import { enthalpy } from '../thermo/index';
import type { Network, NodeLink, SimNode } from './network';

const T_REF = 288.15;
const P_REF = 101325;
const RPM_TO_RADS = (2 * Math.PI) / 60;

/** Gas state of a node as used by the solver. */
export interface MachineNodeState {
  p: number;
  T: number;
  gas: { gamma: number; R: number };
  burnt: number;
}

export interface MachineFlow {
  /** kg/s, positive from node a to node b. */
  mdot: number;
  /** Specific enthalpy of the stream entering node a / node b (only used when that node receives flow). */
  hA: number;
  hB: number;
  burnt: number;
}

// ---- map evaluation -------------------------------------------------------------------------------

export interface CompLine { n: number; m: number[]; pr: number[]; eta: number[]; kp: number }
export interface TurbLine { n: number; phi: number[]; pr: number[]; eta: number[] }

function scaleCompMap(map: TurboMap): CompLine[] {
  const s = map.scale;
  return map.speed.map((n, i) => {
    const m = map.flow[i].map((x) => x * s.flow);
    const pr = map.pr[i].map((x) => 1 + (x - 1) * s.pr);
    const eta = map.eff[i].map((x) => Math.min(0.95, x * s.eff));
    let kp = 0;
    for (let k = 1; k < pr.length; k++) if (pr[k] > pr[kp]) kp = k;
    return { n: n * s.speed, m, pr, eta, kp };
  });
}

function scaleTurbMap(map: TurboMap): TurbLine[] {
  const s = map.scale;
  return map.speed.map((n, i) => ({
    n: n * s.speed,
    phi: map.flow[i].map((x) => x * s.flow),
    pr: map.pr[i].map((x) => 1 + (x - 1) * s.pr),
    eta: map.eff[i].map((x) => Math.min(0.95, x * s.eff)),
  }));
}

function compLineAt(l: CompLine, PR: number): { m: number; eta: number } {
  const { m, pr, eta, kp } = l;
  const last = m.length - 1;
  const prMax = pr[kp];
  if (PR >= prMax) {
    const f = Math.max(0, 1 - (PR - prMax) / (0.3 * Math.max(prMax - 1, 0.05)));
    return { m: m[kp] * f, eta: eta[kp] };
  }
  if (PR <= pr[last]) {
    const x = Math.min(1, (pr[last] - PR) / Math.max(pr[last] - 1, 0.05));
    return { m: m[last] * (1 + 0.5 * x), eta: eta[last] };
  }
  for (let i = kp; i < last; i++) {
    if (PR <= pr[i] && PR > pr[i + 1]) {
      const t = (pr[i] - PR) / Math.max(pr[i] - pr[i + 1], 1e-9);
      return { m: m[i] + t * (m[i + 1] - m[i]), eta: eta[i] + t * (eta[i + 1] - eta[i]) };
    }
  }
  return { m: m[last], eta: eta[last] };
}

/** Compressor map lookup: flow (kg/s corrected) and isentropic efficiency at corrected speed and pressure ratio. */
export function compressorMap(lines: CompLine[], N: number, PR: number): { m: number; eta: number } {
  const n0 = lines[0].n;
  const nl = lines[lines.length - 1].n;
  if (N <= n0 || N >= nl || lines.length === 1) {
    const l = N <= n0 ? lines[0] : lines[lines.length - 1];
    const r = Math.max(N / l.n, 1e-3);
    const r2 = r * r;
    const res = compLineAt(l, 1 + (PR - 1) / r2);
    return { m: res.m * r, eta: res.eta };
  }
  let i = 0;
  while (i < lines.length - 2 && N > lines[i + 1].n) i++;
  const w = (N - lines[i].n) / Math.max(lines[i + 1].n - lines[i].n, 1e-9);
  const a = compLineAt(lines[i], PR);
  const b = compLineAt(lines[i + 1], PR);
  return { m: a.m + w * (b.m - a.m), eta: a.eta + w * (b.eta - a.eta) };
}

function turbLineAt(l: TurbLine, PR: number): { phi: number; eta: number } {
  const { phi, pr, eta } = l;
  const last = phi.length - 1;
  if (PR <= 1) return { phi: 0, eta: eta[0] };
  if (PR <= pr[0]) return { phi: (phi[0] * (PR - 1)) / Math.max(pr[0] - 1, 1e-9), eta: eta[0] };
  if (PR >= pr[last]) return { phi: phi[last], eta: eta[last] };
  for (let i = 0; i < last; i++) {
    if (PR >= pr[i] && PR <= pr[i + 1]) {
      const t = (PR - pr[i]) / Math.max(pr[i + 1] - pr[i], 1e-9);
      return { phi: phi[i] + t * (phi[i + 1] - phi[i]), eta: eta[i] + t * (eta[i + 1] - eta[i]) };
    }
  }
  return { phi: phi[last], eta: eta[last] };
}

/** Turbine map lookup: flow parameter (kg sqrt(K)/s/kPa) and efficiency at corrected speed and pressure ratio. */
export function turbineMap(lines: TurbLine[], N: number, PR: number): { phi: number; eta: number } {
  if (N <= lines[0].n || lines.length === 1) return turbLineAt(lines[0], PR);
  if (N >= lines[lines.length - 1].n) return turbLineAt(lines[lines.length - 1], PR);
  let i = 0;
  while (i < lines.length - 2 && N > lines[i + 1].n) i++;
  const w = (N - lines[i].n) / Math.max(lines[i + 1].n - lines[i].n, 1e-9);
  const a = turbLineAt(lines[i], PR);
  const b = turbLineAt(lines[i + 1], PR);
  return { phi: a.phi + w * (b.phi - a.phi), eta: a.eta + w * (b.eta - a.eta) };
}

function interp1(x: number[], y: number[], v: number): number {
  const n = x.length;
  if (n === 0) return 0;
  if (v <= x[0]) return y[0];
  if (v >= x[n - 1]) return y[n - 1];
  let i = 0;
  while (i < n - 2 && v > x[i + 1]) i++;
  const t = (v - x[i]) / Math.max(x[i + 1] - x[i], 1e-12);
  return y[i] + t * (y[i + 1] - y[i]);
}

// ---- runtime state --------------------------------------------------------------------------------

interface Shaft {
  /** Shaft speed rpm. */
  N: number;
  /** Rotating inertia referred to the shaft (kg m^2). */
  I: number;
  /** Power (W) from turbine / absorbed by compressor in the current step. */
  pT: number;
  pC: number;
  fixed: boolean;
  startN: number;
}

interface Acc {
  time: number; tIn: number; mC: number; pC: number; pCis: number; prC: number; pOut: number; pIn: number;
  mT: number; pT: number; pTis: number; prT: number; N: number; area: number; wgArea: number;
}
const zeroAcc = (): Acc => ({ time: 0, tIn: 0, mC: 0, pC: 0, pCis: 0, prC: 0, pOut: 0, pIn: 0, mT: 0, pT: 0, pTis: 0, prT: 0, N: 0, area: 0, wgArea: 0 });

interface Unit {
  id: number;
  label: string;
  shaft: Shaft;
  comp?: { c: Compressor; lines: CompLine[] | null; link?: NodeLink };
  turb?: { t: Turbine; lines: TurbLine[]; link?: NodeLink };
  acc: Acc;
  last: TurboSummary | null;
  lastN: number;
  // instantaneous values for traces
  inst: { prC: number; prT: number; mC: number; mT: number; boost: number };
  trace: { speed: number[]; prC: number[]; prT: number[]; mC: number[]; mT: number[]; boost: number[]; wg: number[] };
}

interface CoolerRt { c: Cooler; dp: number[]; }

class Controller {
  private readonly out = new Map<number, number>(); // throttle id -> m^2
  private readonly fnMain?: (a: number[]) => number;
  private readonly fn2?: (a: number[]) => number;
  private readonly lookup?: { x: number[]; y: number[] };
  private readonly limit?: { max: number; min: number };
  private readonly avgPeriod: number;
  private readonly avgOnInput: boolean;
  private readonly lc?: { type: number; rate: number };
  private readonly sensP?: number;
  private readonly sensN: boolean;
  private readonly targets: number[] = [];
  private bins: number[] = [];
  private binSum = 0;
  private binCount = 0;
  private binTime = 0;
  private binVal = 0;
  private lastDeg = NaN;
  private value = 0;
  readonly warnings: string[] = [];
  active = false;

  constructor(model: EngineModel) {
    const tm = model.turbo;
    if (!tm || tm.actuators.length === 0) { this.avgPeriod = 0; this.avgOnInput = false; this.sensN = false; return; }
    const act = tm.actuators.filter((a) => a.target === 'throttle-area' && model.throttles.some((t) => t.id === a.element));
    for (const a of tm.actuators) {
      if (!act.includes(a)) this.warnings.push(`Actuator "${a.label}" (class ${a.header[0]}/${a.header[1]}) is not simulated.`);
    }
    this.targets = act.map((a) => a.element);
    const sp = tm.sensors.find((s) => s.quantity === 'plenum-pressure');
    this.sensP = sp?.element;
    this.sensN = tm.sensors.some((s) => s.quantity === 'engine-speed');
    const fns = tm.controls.filter((c): c is Extract<typeof c, { kind: 'function' }> => c.kind === 'function');
    const integ = tm.controls.find((c): c is Extract<typeof c, { kind: 'integrator' }> => c.kind === 'integrator');
    const f2 = fns.find((f) => f.dim === 2);
    const f1 = fns.filter((f) => f.dim === 1);
    // The divider that follows an integrator is "F1/period": it only normalises the integral.
    const main = f1.find((f) => !(integ && /^F1\/[\d.]+$/i.test(f.expr.replace(/\s+/g, ''))));
    if (f2) this.fn2 = compileExpression(f2.expr);
    if (main && !f2) this.fnMain = compileExpression(main.expr);
    const lk = tm.controls.find((c): c is Extract<typeof c, { kind: 'lookup' }> => c.kind === 'lookup');
    if (lk) this.lookup = { x: lk.x, y: lk.y };
    const lim = tm.controls.find((c): c is Extract<typeof c, { kind: 'limit' }> => c.kind === 'limit');
    if (lim) this.limit = { max: lim.max, min: lim.min };
    const lc = tm.controls.find((c): c is Extract<typeof c, { kind: 'limit-change' }> => c.kind === 'limit-change');
    if (lc) this.lc = { type: lc.type, rate: lc.rate };
    this.avgPeriod = integ ? Math.max(1, Math.round(integ.period)) : 0;
    this.avgOnInput = !!f2;
    for (const c of tm.controls) if (c.kind === 'unknown') this.warnings.push(`Control "${c.label}" (type ${c.code}) is not simulated.`);
    this.active = this.targets.length > 0 && this.sensP !== undefined && (!!this.fnMain || !!this.fn2);
    if (!this.active && this.targets.length > 0) this.warnings.push('Waste-gate control chain could not be reconstructed; actuated throttles keep their model area.');
    this.bins = new Array(this.avgPeriod).fill(NaN);
    for (const t of this.targets) this.out.set(t, model.throttles.find((x) => x.id === t)!.diameter ? Math.PI / 4 * Math.pow(model.throttles.find((x) => x.id === t)!.diameter / 1000, 2) : 0);
  }

  get sensedPlenum(): number | undefined { return this.sensP; }

  private average(x: number, deg: number, dDeg: number): number {
    // Moving average over avgPeriod crank degrees using 1-degree bins.
    this.binVal += x * dDeg;
    this.binTime += dDeg;
    if (Math.floor(deg) !== this.lastDeg) {
      if (this.binTime > 0) {
        const v = this.binVal / this.binTime;
        this.bins.push(v);
        if (this.bins.length > this.avgPeriod) this.bins.shift();
      }
      this.binVal = 0;
      this.binTime = 0;
      this.lastDeg = Math.floor(deg);
    }
    let s = 0;
    let n = 0;
    for (const b of this.bins) if (Number.isFinite(b)) { s += b; n++; }
    const cur = this.binTime > 0 ? this.binVal / this.binTime : x;
    return n === 0 ? x : (s + cur) / (n + 1);
  }

  /** Advance the controller by one solver step. pressure in Pa, rpm, angle in crank degrees. */
  update(pressure: number, rpm: number, deg: number, dDeg: number): void {
    if (!this.active) return;
    let p = pressure;
    if (this.avgPeriod > 0 && this.avgOnInput) p = this.average(p, deg, dDeg);
    let u: number;
    if (this.fn2) u = this.fn2([p, this.lookup ? interp1Extrap(this.lookup.x, this.lookup.y, rpm) : 0]);
    else u = this.fnMain!([p]);
    if (!Number.isFinite(u)) u = 0;
    if (this.limit) u = Math.min(this.limit.max, Math.max(this.limit.min, u));
    if (this.avgPeriod > 0 && !this.avgOnInput) u = this.average(u, deg, dDeg);
    if (this.lc) {
      const d = u - this.value;
      const maxStep = this.lc.rate * dDeg;
      // type 3 = limit decreases only, 2 = increases only, otherwise both
      if (d < -maxStep && this.lc.type !== 2) u = this.value - maxStep;
      else if (d > maxStep && this.lc.type !== 3 && this.lc.type !== 1) u = this.value + maxStep;
    }
    this.value = u;
    for (const t of this.targets) this.out.set(t, Math.max(0, u) * 1e-6);
  }

  area(id: number): number | undefined { return this.out.get(id); }
  get currentValue(): number { return this.value; }
  get targetIds(): number[] { return this.targets; }
}

function interp1Extrap(x: number[], y: number[], v: number): number {
  const n = x.length;
  if (n === 0) return 0;
  if (n === 1) return y[0];
  if (v < x[0]) return y[0] + ((v - x[0]) * (y[1] - y[0])) / (x[1] - x[0]);
  if (v > x[n - 1]) return y[n - 1] + ((v - x[n - 1]) * (y[n - 1] - y[n - 2])) / (x[n - 1] - x[n - 2]);
  return interp1(x, y, v);
}

export interface TurboContext {
  rpm: number;
  cycleDeg: number;
  fuel: Fuel;
  nodeState: (n: SimNode) => MachineNodeState;
  /** Number of grid points of the trace arrays. */
  nGrid: number;
}

export class TurboSystem {
  readonly units: Unit[] = [];
  readonly warnings: string[] = [];
  private readonly coolers = new Map<number, CoolerRt>();
  private readonly byCompLink = new Map<NodeLink, Unit>();
  private readonly byTurbLink = new Map<NodeLink, Unit>();
  private readonly controller: Controller;
  private crankW = 0;
  private crankAcc = 0;
  private crankT = 0;
  private lastCrankW = 0;
  private wgIds: number[] = [];

  constructor(private readonly model: EngineModel, private readonly net: Network, private readonly ctx: TurboContext) {
    // Shaft groups: compressors and turbines joined by LINKS share a shaft.
    const links = model.turbo?.links ?? [];
    const group = new Map<string, Unit>();
    const compById = new Map(model.compressors.map((c) => [c.id, c]));
    const turbById = new Map(model.turbines.map((t) => [t.id, t]));
    const unitFor = (kind: 'compressor' | 'turbine', id: number): Unit => {
      const key = `${kind}:${id}`;
      let u = group.get(key);
      if (u) return u;
      u = {
        id: this.units.length + 1,
        label: `Turbocharger ${this.units.length + 1}`,
        shaft: { N: 0, I: 1e-5, pT: 0, pC: 0, fixed: false, startN: 0 },
        acc: zeroAcc(), last: null, lastN: 0,
        inst: { prC: 1, prT: 1, mC: 0, mT: 0, boost: 0 },
        trace: { speed: [], prC: [], prT: [], mC: [], mT: [], boost: [], wg: [] },
      };
      this.units.push(u);
      group.set(key, u);
      return u;
    };
    for (const l of links) {
      const a = unitFor(l.a.kind as 'compressor' | 'turbine', l.a.id);
      group.set(`${l.b.kind}:${l.b.id}`, a);
    }
    // Attach machines to the node links that carry them.
    for (const nl of net.links) {
      const mc = nl.machine;
      if (!mc) continue;
      if (mc.kind === 'compressor') {
        const c = compById.get(mc.id);
        if (!c) continue;
        const u = unitFor('compressor', mc.id);
        u.comp = { c, lines: c.map && c.map.speed.length > 0 ? scaleCompMap(c.map) : null, link: nl };
        this.byCompLink.set(nl, u);
      } else if (mc.kind === 'turbine') {
        const t = turbById.get(mc.id);
        if (!t) continue;
        if (!t.map || t.map.speed.length === 0) { this.warnings.push(`Turbine ${t.id} has no map; ignored.`); continue; }
        const u = unitFor('turbine', mc.id);
        u.turb = { t, lines: scaleTurbMap(t.map), link: nl };
        this.byTurbLink.set(nl, u);
      } else if (mc.kind === 'cooler') {
        const c = model.turbo?.coolers.find((x) => x.id === mc.id);
        if (c && c.massFlow.length >= 2) this.coolers.set(this.coolerKey(nl), { c, dp: c.pressureLoss.map((x) => x * 1e5) });
        else this.warnings.push(`Cooler ${mc.id} has no data; treated as an open duct.`);
      }
    }
    for (const u of this.units) this.initShaft(u);
    this.controller = new Controller(model);
    this.warnings.push(...this.controller.warnings);
    this.wgIds = this.controller.targetIds;
  }

  private coolerKey(nl: NodeLink): number { return this.net.links.indexOf(nl); }

  private initShaft(u: Unit): void {
    const sh = u.shaft;
    const c = u.comp?.c;
    const t = u.turb?.t;
    const gc = c?.gearRatio && c.gearRatio > 0 ? c.gearRatio : 1;
    const gt = t?.gearRatio && t.gearRatio > 0 ? t.gearRatio : 1;
    sh.I = Math.max(1e-7, (c?.inertia ?? 0) * gc * gc + (t?.inertia ?? 0) * gt * gt);
    if (c?.drive?.kind === 'crank') { sh.fixed = true; sh.N = this.ctx.rpm * c.drive.ratio; return; }
    if (c?.drive?.kind === 'fixed') { sh.fixed = true; sh.N = c.drive.rpm; return; }
    if (c?.positive) { sh.fixed = true; sh.N = this.ctx.rpm; return; }
    // Start half way between the slowest and fastest compressor speed lines, as LES does.
    let N: number;
    if (u.comp?.lines) {
      const ls = u.comp.lines;
      N = 0.5 * (ls[0].n + ls[ls.length - 1].n) / gc;
    } else if (u.turb) {
      const ls = u.turb.lines;
      N = 0.5 * (ls[0].n + ls[ls.length - 1].n) * Math.sqrt(900) / gt;
    } else N = 50000;
    sh.N = N;
    sh.startN = N;
    // A turbine without a compressor (or the reverse) on its shaft cannot balance: keep the speed.
    if (!u.comp || !u.turb) {
      sh.fixed = true;
      this.warnings.push(`${u.label}: ${u.comp ? 'compressor' : 'turbine'} has no linked partner; shaft speed held at ${Math.round(N)} rpm.`);
    }
  }

  has(): boolean {
    return this.units.length > 0 || this.coolers.size > 0 || this.controller.active;
  }

  /** Throttle area (m^2) forced by the controller, if the throttle is an actuator target. */
  throttleArea(id: number): number | undefined {
    return this.controller.area(id);
  }

  /** Mass flow, enthalpies and power for one machine link; undefined when the link carries no machine. */
  flow(l: NodeLink, a: SimNode, b: SimNode, dt: number): MachineFlow | undefined {
    const m = l.machine;
    if (!m) return undefined;
    const sa = this.ctx.nodeState(a);
    const sb = this.ctx.nodeState(b);
    const fuel = this.ctx.fuel;
    if (m.kind === 'cooler') {
      const rt = this.coolers.get(this.coolerKey(l));
      const up = sa.p >= sb.p ? sa : sb;
      const dpPa = Math.abs(sa.p - sb.p);
      let mdot: number;
      let eps = 0;
      let Tc = up.T;
      if (!rt) {
        mdot = Math.sign(sa.p - sb.p) * 0.02 * Math.sqrt(dpPa / 100) * (up.p / 1e5);
        eps = 0;
      } else {
        const c = rt.c;
        const dp = rt.dp;
        const n = dp.length;
        let mm: number;
        if (dpPa >= dp[n - 1]) mm = c.massFlow[n - 1] * Math.sqrt(dpPa / Math.max(dp[n - 1], 1e-9));
        else mm = interp1(dp, c.massFlow, dpPa);
        mdot = Math.sign(sa.p - sb.p) * mm;
        eps = interp1(c.massFlow, c.effectiveness, Math.abs(mdot));
        Tc = interp1(c.massFlow, c.coolantTemp, Math.abs(mdot));
      }
      mdot = this.limitFlow(mdot, a, b, dt);
      const Tout = Math.max(100, up.T - eps * (up.T - Tc));
      const h = enthalpy(Tout, up.burnt, fuel);
      return { mdot, hA: h, hB: h, burnt: up.burnt };
    }
    if (m.kind === 'compressor') {
      const u = this.byCompLink.get(l);
      if (!u || !u.comp) return undefined;
      return this.compressorFlow(u, sa, sb, a, b, dt);
    }
    const u = this.byTurbLink.get(l);
    if (!u || !u.turb) return undefined;
    return this.turbineFlow(u, sa, sb, a, b, dt);
  }

  private limitFlow(mdot: number, a: SimNode, b: SimNode, dt: number): number {
    const src = mdot >= 0 ? a : b;
    const m = src.vol?.m;
    if (m !== undefined && Math.abs(mdot) * dt > 0.3 * m) return Math.sign(mdot) * (0.3 * m) / dt;
    return mdot;
  }

  private compressorFlow(u: Unit, sa: MachineNodeState, sb: MachineNodeState, a: SimNode, b: SimNode, dt: number): MachineFlow {
    const c = u.comp!.c;
    const fuel = this.ctx.fuel;
    const sh = u.shaft;
    const PR = sb.p / Math.max(sa.p, 1);
    const g = sa.gas.gamma;
    const k = (g - 1) / g;
    const cp = (g * sa.gas.R) / (g - 1);
    const mech = c.mechEff && c.mechEff > 0 ? c.mechEff : 1;
    let mdot = 0;
    let eta = 0.7;
    if (c.positive) {
      const pd = c.positive;
      const Nsc = sh.N;
      const prc = Math.max(PR, pd.pr[0]);
      const ev = interp1(pd.pr, pd.volEff, prc);
      const rho = sa.p / (sa.gas.R * sa.T);
      mdot = ev * pd.swept * 1e-3 * (Nsc / 60) * rho;
      eta = Math.max(0.05, interp1(pd.pr, pd.isentropicEff, prc));
      const etaAd = Math.max(0.05, interp1(pd.pr, pd.adiabaticEff, prc));
      const dh = cp * sa.T * (Math.pow(Math.max(PR, 1), k) - 1);
      const power = (mdot * dh) / (etaAd * mech);
      sh.pC = power;
      this.crankW += power;
    } else if (u.comp!.lines) {
      const gc = c.gearRatio && c.gearRatio > 0 ? c.gearRatio : 1;
      const th = Math.sqrt(sa.T / T_REF);
      const dl = sa.p / P_REF;
      const Ncorr = (sh.N * gc) / th;
      const r = compressorMap(u.comp!.lines, Ncorr, PR);
      mdot = (r.m * dl) / th;
      eta = Math.max(0.05, r.eta);
      const dh = cp * sa.T * (Math.pow(Math.max(PR, 1), k) - 1);
      sh.pC = (mdot * dh) / (eta * mech);
      if (c.drive?.kind === 'crank') this.crankW += sh.pC;
    } else {
      // No map: a simple fixed pressure-ratio pump is not defined; behave as an open duct.
      mdot = 0.02 * Math.sqrt(Math.abs(sa.p - sb.p) / 100) * Math.sign(sa.p - sb.p);
      eta = 0.7;
    }
    mdot = Math.max(0, mdot);
    mdot = this.limitFlow(mdot, a, b, dt);
    const PRe = Math.max(PR, 1);
    const Tout = sa.T * (1 + (Math.pow(PRe, k) - 1) / eta);
    const hOut = enthalpy(Tout, sa.burnt, fuel);
    // statistics
    const ac = u.acc;
    const dh = cp * sa.T * (Math.pow(PRe, k) - 1);
    ac.tIn += sa.T * dt;
    ac.mC += mdot * dt;
    ac.pC += ((mdot * dh) / eta) * dt;
    ac.pCis += mdot * dh * dt;
    ac.prC += PR * dt;
    ac.pOut += sb.p * dt;
    ac.pIn += sa.p * dt;
    u.inst.prC = PR;
    u.inst.mC = mdot;
    u.inst.boost = sb.p;
    return { mdot, hA: hOut, hB: hOut, burnt: sa.burnt };
  }

  private turbineFlow(u: Unit, sa: MachineNodeState, sb: MachineNodeState, a: SimNode, b: SimNode, dt: number): MachineFlow {
    const t = u.turb!.t;
    const fuel = this.ctx.fuel;
    const sh = u.shaft;
    const PR = sa.p / Math.max(sb.p, 1);
    const g = sa.gas.gamma;
    const k = (g - 1) / g;
    const cp = (g * sa.gas.R) / (g - 1);
    const gt = t.gearRatio && t.gearRatio > 0 ? t.gearRatio : 1;
    const mech = t.mechEff && t.mechEff > 0 ? t.mechEff : 1;
    const th = Math.sqrt(Math.max(sa.T, 100));
    const Ncorr = (sh.N * gt) / th;
    const r = turbineMap(u.turb!.lines, Ncorr, PR);
    let mdot = (r.phi * (sa.p / 1000)) / th;
    mdot = Math.max(0, mdot);
    mdot = this.limitFlow(mdot, a, b, dt);
    const eta = Math.max(0.05, r.eta);
    const PRe = Math.max(PR, 1);
    const dhIs = cp * sa.T * (1 - Math.pow(PRe, -k));
    const w = eta * dhIs;
    sh.pT = mdot * w * mech;
    const Tout = Math.max(100, sa.T - w / cp);
    const hOut = enthalpy(Tout, sa.burnt, fuel);
    const ac = u.acc;
    ac.mT += mdot * dt;
    ac.pT += mdot * w * dt;
    ac.pTis += mdot * dhIs * dt;
    ac.prT += PR * dt;
    u.inst.prT = PR;
    u.inst.mT = mdot;
    return { mdot, hA: hOut, hB: hOut, burnt: sa.burnt };
  }

  /** End of step: integrate the shaft speeds and run the controller. */
  update(dt: number, dDeg: number, gAngle: number, rpm: number): void {
    for (const u of this.units) {
      const sh = u.shaft;
      const ac = u.acc;
      if (!sh.fixed) {
        const w = sh.N * RPM_TO_RADS;
        const E = Math.max(0.5 * sh.I * w * w + (sh.pT - sh.pC) * dt, 0.5 * sh.I * Math.pow(1000 * RPM_TO_RADS, 2));
        sh.N = Math.sqrt((2 * E) / sh.I) / RPM_TO_RADS;
      } else if (u.comp?.c.drive?.kind === 'crank') {
        sh.N = rpm * u.comp.c.drive.ratio;
      }
      ac.N += sh.N * dt;
      ac.time += dt;
      sh.pT = 0;
      sh.pC = 0;
    }
    this.crankAcc += this.crankW * dt;
    this.crankT += dt;
    this.crankW = 0;
    const sens = this.controller.sensedPlenum;
    if (this.controller.active && sens !== undefined) {
      const node = this.net.nodes.find((n) => n.kind === 'plenum' && n.id === sens);
      if (node?.vol) this.controller.update(node.vol.p, rpm, gAngle, dDeg);
    }
    if (this.wgIds.length > 0) {
      const area = (this.controller.area(this.wgIds[0]) ?? 0) * 1e6;
      for (const u of this.units) u.acc.wgArea += area * dt;
    }
  }

  /** Record the instantaneous values on the trace grid (index k). */
  record(k: number): void {
    const wg = (this.controller.area(this.wgIds[0] ?? -1) ?? 0) * 1e6;
    for (const u of this.units) {
      const t = u.trace;
      t.speed[k] = u.shaft.N;
      t.prC[k] = u.inst.prC;
      t.prT[k] = u.inst.prT;
      t.mC[k] = u.inst.mC;
      t.mT[k] = u.inst.mT;
      t.boost[k] = u.inst.boost / 1e5;
      t.wg[k] = wg;
    }
  }

  resetTraces(): void {
    for (const u of this.units) u.trace = { speed: [], prC: [], prT: [], mC: [], mT: [], boost: [], wg: [] };
  }

  /** Close a cycle: store the cycle averages; returns true when the shaft speeds have settled. */
  endCycle(): boolean {
    let settled = true;
    for (const u of this.units) {
      const ac = u.acc;
      const T = Math.max(ac.time, 1e-12);
      const Navg = ac.N / T;
      const gc = u.comp?.c.gearRatio && u.comp.c.gearRatio > 0 ? u.comp.c.gearRatio : 1;
      const Tin = ac.tIn > 0 && ac.mC > 0 ? ac.tIn / T : T_REF;
      const sum: TurboSummary = {
        id: u.id,
        label: u.label,
        speed: Navg * gc,
        correctedSpeed: (Navg * gc) / Math.sqrt(Tin / T_REF),
        compressorPressureRatio: ac.mC > 0 ? ac.prC / T : 1,
        boostPressure: ac.pOut / T / 1e5,
        compressorMassFlow: ac.mC / T,
        compressorEfficiency: ac.pC > 0 ? ac.pCis / ac.pC : 0,
        compressorPower: ac.pC / T / 1000,
        turbineMassFlow: ac.mT / T,
        turbinePressureRatio: ac.mT > 0 ? ac.prT / T : 1,
        turbineEfficiency: ac.pTis > 0 ? ac.pT / ac.pTis : 0,
        turbinePower: ac.pT / T / 1000,
        wastegateArea: this.wgIds.length > 0 ? ac.wgArea / T : undefined,
      };
      u.last = sum;
      const prev = u.lastN;
      if (!u.shaft.fixed && (prev === 0 || Math.abs(Navg - prev) / Math.max(Navg, 1) > 0.01)) settled = false;
      u.lastN = Navg;
      u.acc = zeroAcc();
    }
    this.lastCrankW = this.crankT > 0 ? this.crankAcc / this.crankT : 0;
    this.crankAcc = 0;
    this.crankT = 0;
    return settled;
  }

  /** Power (kW) taken from the crankshaft by crank driven compressors / superchargers, last cycle. */
  crankPowerKW(): number { return this.lastCrankW / 1000; }

  summary(): TurboSummary[] {
    return this.units.map((u) => u.last).filter((x): x is TurboSummary => !!x);
  }

  traces(angles: number[]): TurboTrace[] {
    return this.units.map((u) => ({
      id: u.id,
      angle: angles,
      speed: fillGaps(u.trace.speed, angles.length),
      compressorPressureRatio: fillGaps(u.trace.prC, angles.length),
      turbinePressureRatio: fillGaps(u.trace.prT, angles.length),
      compressorMassFlow: fillGaps(u.trace.mC, angles.length),
      turbineMassFlow: fillGaps(u.trace.mT, angles.length),
      boostPressure: fillGaps(u.trace.boost, angles.length),
      wastegateArea: this.wgIds.length > 0 ? fillGaps(u.trace.wg, angles.length) : undefined,
    }));
  }
}

function fillGaps(a: number[], n: number): number[] {
  const out = new Array<number>(n);
  let last = a.find((x) => x !== undefined && !Number.isNaN(x)) ?? 0;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    out[i] = v === undefined || Number.isNaN(v) ? last : (last = v);
  }
  return out;
}

/** Build the turbo system for a network, or undefined when the model has no turbo machinery or controls. */
export function createTurbo(model: EngineModel, net: Network, ctx: TurboContext): TurboSystem | undefined {
  const any = net.links.some((l) => l.machine) || (model.turbo?.actuators.length ?? 0) > 0;
  if (!any) return undefined;
  const ts = new TurboSystem(model, net, ctx);
  return ts.has() ? ts : undefined;
}
