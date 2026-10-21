// Combustion analysis: measured cylinder pressure -> apparent heat release, MFB, burn angles, IMEP, Wiebe fit.
import type { EngineModel } from '../model';
import { DEG, interp, nelderMead, numbersIn, crankVolumeFn } from './numeric';

/** Contents of a burn data file (.dat), with lengths in mm and pressure in bar. */
export interface BurnData {
  title: string[];
  speed: number; // rpm
  cycle: 2 | 4 | 6;
  bore: number;
  stroke: number;
  rod: number;
  pinOffset: number;
  compressionRatio: number;
  /** Clearance volume in cc; undefined = calculate from CR. */
  clearanceVolume?: number;
  /** Pressure offset in bar added to the measured values; undefined = calculate. */
  pressureOffset?: number;
  /** Absolute reference pressure (bar) at the start of the compression stroke, used for pegging when present. */
  referencePressure?: number;
  /** Data angle at which firing TDC occurs (the file's angle origin is BDC). */
  tdcAngle: number;
  /** Ignition, deg BTDC (positive = before TDC). */
  ignition: number;
  ivo: number; // deg BTDC
  ivc: number; // deg ABDC
  evo: number; // deg BBDC
  evc: number; // deg ATDC
  angle: number[]; // deg, as in the file
  pressure: number[]; // bar, as measured (before offset)
}

const PRESSURE_UNITS: Record<string, number> = { bar: 1, kpa: 0.01, mpa: 10, pa: 1e-5, psi: 0.0689476, mbar: 0.001 };

/** Parse a burn data file (title lines, units, geometry and a crank-angle / pressure table). */
export function parseBurnData(text: string): BurnData {
  const lines = text.replace(/\r/g, '').split('\n');
  // The table is preceded by a line holding its row count.
  let countIdx = -1;
  for (let i = 0; i < lines.length - 2; i++) {
    const nums = numbersIn(lines[i]);
    if (nums.length === 1 && Number.isInteger(nums[0]) && nums[0] >= 3) {
      const a = numbersIn(lines[i + 1]), b = numbersIn(lines[i + 2]);
      if (a.length === 2 && b.length === 2 && /^\s*[-+0-9.]/.test(lines[i])) { countIdx = i; break; }
    }
  }
  if (countIdx < 0) throw new Error('Burn data: no pressure table found');
  const n = numbersIn(lines[countIdx])[0];
  const angle: number[] = [], pressure: number[] = [];
  for (let i = countIdx + 1; i < lines.length && angle.length < n; i++) {
    const v = numbersIn(lines[i]);
    if (v.length >= 2) { angle.push(v[0]); pressure.push(v[1]); }
  }
  // Header: leading text lines are titles/units, the numeric lines follow in a fixed order.
  const head = lines.slice(0, countIdx);
  const title: string[] = [];
  const units: string[] = [];
  const numeric: number[][] = [];
  const allNumeric = (l: string) => l.replace(/:.*$/, '').replace(/,/g, ' ').trim().split(/\s+/).every((t) => Number.isFinite(Number(t.replace(/[dD]/, 'e'))));
  for (const l of head) {
    const t = l.trim();
    if (!t) continue;
    if (allNumeric(t)) numeric.push(numbersIn(t));
    else if (/^[A-Za-z]{1,5}$/.test(t)) units.push(t.toLowerCase());
    else title.push(t);
  }
  const unitsP = { value: 1 };
  const pu = units.find((u) => PRESSURE_UNITS[u] !== undefined);
  if (pu) unitsP.value = PRESSURE_UNITS[pu];
  const gi = numeric.findIndex((r) => r.length >= 7);
  const geom = gi >= 0 ? numeric[gi] : [];
  const tim = gi >= 0 ? (numeric[gi + 1] ?? []) : [];
  const ref = gi >= 0 ? numeric[gi + 2] : undefined;
  const pre = numeric.slice(0, Math.max(gi, 0));
  const cp = pre.find((r) => r.length >= 2) ?? [999, 999];
  const spd = pre.length > 1 ? pre[1] : pre[0];
  const k = unitsP.value;
  return {
    title,
    speed: spd?.[0] ?? 0,
    cycle: ([2, 4, 6].includes(geom[6]) ? geom[6] : 4) as 2 | 4 | 6,
    bore: geom[0], stroke: geom[1], rod: geom[2], pinOffset: geom[3], compressionRatio: geom[4],
    clearanceVolume: cp[0] >= 999 ? undefined : cp[0],
    pressureOffset: cp[1] >= 999 ? undefined : cp[1] * k,
    referencePressure: ref && ref.length === 1 ? ref[0] * k : undefined,
    tdcAngle: tim[0] ?? 180,
    ignition: tim[1] ?? 0, ivo: tim[2] ?? 0, ivc: tim[3] ?? 0, evo: tim[4] ?? 0, evc: tim[5] ?? 0,
    angle,
    pressure: pressure.map((p) => p * k),
  };
}

export interface CombustionOptions {
  /** Ratio of specific heats for the net heat release (default 1.32). */
  gamma?: number;
  /** Polytropic exponent used for pegging and the Rassweiler-Withrow method (default 1.32). */
  polytropic?: number;
  method?: 'net' | 'rassweiler';
  /** Moving-average window for the pressure (odd number of samples, default 3). */
  smooth?: number;
  /** Override for the pressure offset (bar). */
  pressureOffset?: number;
  /** Pegging method when the offset is not given: 'reference' uses the file's reference pressure, 'polytropic' fits it. */
  peg?: 'reference' | 'polytropic';
  /** Burn analysis window, deg ATDC (defaults from the ignition timing). */
  windowStart?: number;
  windowEnd?: number;
}

export interface BurnAngles {
  start: number; // 2 % burnt, deg ATDC
  b10: number;
  b50: number;
  b90: number;
  /** 10 to 90 % duration. */
  duration1090: number;
}

export interface CombustionResult {
  theta: number[]; // deg ATDC firing
  pressure: number[]; // bar absolute
  volume: number[]; // cc
  /** Apparent heat release rate J/deg (net, or pressure-rise based for Rassweiler-Withrow, scaled to nothing). */
  dQ: number[];
  cumulative: number[]; // J (net) from the window start
  mfb: number[]; // 0..1, 0 before the window start and 1 after the burn ends
  window: [number, number];
  burn: BurnAngles;
  totalHeat: number; // J, net apparent
  pressureOffset: number;
  peakPressure: number;
  peakAngle: number;
  maxPressureRise: number; // bar/deg
  imepGross: number; // bar (compression + expansion)
  imepNet: number; // bar (whole cycle, includes pumping if the data covers it)
  swept: number; // cc
  clearance: number; // cc
}

function movingAverage(a: number[], w: number): number[] {
  if (w <= 1) return a.slice();
  const h = w >> 1;
  return a.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) { s += a[j]; c++; }
    return s / c;
  });
}

function crossing(theta: number[], y: number[], level: number): number {
  for (let i = 1; i < y.length; i++) {
    if (y[i - 1] < level && y[i] >= level) return theta[i - 1] + ((level - y[i - 1]) / (y[i] - y[i - 1])) * (theta[i] - theta[i - 1]);
  }
  return NaN;
}

/** Heat release analysis of a measured pressure trace. */
export function analyseCombustion(data: BurnData, opt: CombustionOptions = {}): CombustionResult {
  const gamma = opt.gamma ?? 1.32;
  const nPoly = opt.polytropic ?? 1.32;
  const nPts = data.angle.length;
  const vol = (() => {
    const vs = (Math.PI / 4) * (data.bore / 1000) ** 2 * (data.stroke / 1000);
    const vc = data.clearanceVolume !== undefined ? data.clearanceVolume * 1e-6 : undefined;
    const f = crankVolumeFn(data.bore, data.stroke, data.rod, data.pinOffset, data.compressionRatio, vc);
    return { f, vs, vc: vc ?? vs / (data.compressionRatio - 1) };
  })();
  // Angle relative to firing TDC, wrapped to [-360, 360) for a 4-stroke trace.
  const period = data.cycle === 2 ? 360 : 720;
  const theta = data.angle.map((a) => {
    let t = a - data.tdcAngle;
    while (t >= period / 2) t -= period;
    while (t < -period / 2) t += period;
    return t;
  });
  const v = theta.map((t) => vol.f(t)); // m3
  const raw = data.pressure;

  // Pressure offset (pegging).
  let offset = opt.pressureOffset ?? data.pressureOffset;
  if (offset === undefined) {
    const mode = opt.peg ?? (data.referencePressure !== undefined ? 'reference' : 'polytropic');
    if (mode === 'reference' && data.referencePressure !== undefined) {
      // Mean measured pressure within 3 degrees of the compression BDC (theta = -180) is set to the reference.
      const near = raw.filter((_, i) => Math.abs(Math.abs(theta[i]) - 180) <= 3);
      const m = near.length ? near.reduce((s, x) => s + x, 0) / near.length : raw[0];
      offset = data.referencePressure - m;
    } else {
      // Two compression-stroke samples before ignition on a common polytrope.
      const ign = data.ignition || 30;
      const idx = (t: number) => { let b = 0; for (let i = 0; i < theta.length; i++) if (Math.abs(theta[i] - t) < Math.abs(theta[b] - t)) b = i; return b; };
      const i1 = idx(-120), i2 = idx(-Math.max(ign + 15, 40));
      const a = v[i1] ** nPoly, b = v[i2] ** nPoly;
      offset = (raw[i2] * b - raw[i1] * a) / (a - b);
      if (!Number.isFinite(offset) || Math.abs(offset) > 5) offset = 1.013 - raw[0];
    }
  }
  const pAbs = movingAverage(raw, opt.smooth ?? 3).map((p) => p + offset!);

  // Window for the burn.
  const ignAtdc = -(data.ignition || 25);
  const w0 = opt.windowStart ?? ignAtdc - 25;
  const w1 = opt.windowEnd ?? 100;
  const dQ = new Array<number>(nPts).fill(0);
  const cum = new Array<number>(nPts).fill(0);
  const rw = new Array<number>(nPts).fill(0); // Rassweiler cumulative pressure rise
  for (let i = 1; i < nPts; i++) {
    const dth = theta[i] - theta[i - 1];
    if (!(dth > 0) || dth > 5) { dQ[i] = 0; cum[i] = cum[i - 1]; rw[i] = rw[i - 1]; continue; }
    const p0 = pAbs[i - 1] * 1e5, p1 = pAbs[i] * 1e5, v0 = v[i - 1], v1 = v[i];
    const dq = (gamma / (gamma - 1)) * ((p0 + p1) / 2) * (v1 - v0) + (1 / (gamma - 1)) * ((v0 + v1) / 2) * (p1 - p0);
    dQ[i] = dq / dth;
    const inWin = theta[i] > w0 && theta[i] <= w1;
    cum[i] = cum[i - 1] + (inWin ? dq : 0);
    const dpc = pAbs[i] - pAbs[i - 1] * (v0 / v1) ** nPoly;
    rw[i] = rw[i - 1] + (inWin ? dpc : 0);
  }
  const series = opt.method === 'rassweiler' ? rw : cum;
  // Burn end: maximum of the cumulative within the window.
  let iEnd = 0, best = -Infinity;
  for (let i = 0; i < nPts; i++) if (theta[i] > w0 && theta[i] <= w1 && series[i] > best) { best = series[i]; iEnd = i; }
  const total = best > 0 ? best : 1;
  let run = 0;
  const mfb = theta.map((t, i) => {
    if (t <= w0) return 0;
    if (i >= iEnd && t > theta[iEnd]) return t <= w1 ? 1 : 1;
    run = Math.max(run, Math.min(1, Math.max(0, series[i] / total)));
    return run;
  });
  // Restrict the angle search to the window.
  const idxs = theta.map((_, i) => i).filter((i) => theta[i] > w0 && theta[i] <= w1);
  const th = idxs.map((i) => theta[i]), mf = idxs.map((i) => mfb[i]);
  const b02 = crossing(th, mf, 0.02), b10 = crossing(th, mf, 0.1), b50 = crossing(th, mf, 0.5), b90 = crossing(th, mf, 0.9);

  // Peak pressure.
  let pk = 0, dpk = 0;
  for (let i = 0; i < nPts; i++) if (Math.abs(theta[i]) < 90 && pAbs[i] > pAbs[pk]) pk = i;
  for (let i = 1; i < nPts; i++) {
    const dth = theta[i] - theta[i - 1];
    if (Math.abs(theta[i]) < 90 && dth > 0 && dth < 5) dpk = Math.max(dpk, (pAbs[i] - pAbs[i - 1]) / dth);
  }

  // IMEP: integral of p dV over the cycle (net) and over compression + expansion (gross).
  const vsCc = vol.vs * 1e6;
  let wGross = 0, wNet = 0;
  for (let i = 1; i < nPts; i++) {
    if (!(theta[i] > theta[i - 1])) continue;
    const dw = ((pAbs[i] + pAbs[i - 1]) / 2) * 1e5 * (v[i] - v[i - 1]);
    wNet += dw;
    if (theta[i] >= -180 && theta[i - 1] >= -180 && theta[i] <= 180) wGross += dw;
  }
  return {
    theta, pressure: pAbs, volume: v.map((x) => x * 1e6), dQ, cumulative: cum, mfb,
    window: [w0, w1],
    burn: { start: b02, b10, b50, b90, duration1090: b90 - b10 },
    totalHeat: total,
    pressureOffset: offset!,
    peakPressure: pAbs[pk], peakAngle: theta[pk], maxPressureRise: dpk,
    imepGross: wGross / (vol.vs * 1e5), imepNet: wNet / (vol.vs * 1e5),
    swept: vsCc, clearance: vol.vc * 1e6,
  };
}

/** Wiebe burnt fraction at crank angle theta (deg). */
export function wiebeBurnt(theta: number, a: number, m: number, start: number, duration: number): number {
  if (theta <= start) return 0;
  const x = (theta - start) / duration;
  return 1 - Math.exp(-a * Math.pow(x, m + 1));
}

export interface WiebeFit {
  a: number;
  m: number;
  start: number; // deg ATDC, 0 % point
  duration: number; // deg, 0 to ~100 %
  rms: number; // rms error of the burnt fraction
}

/** Least-squares Wiebe fit to a burnt-fraction curve. `a` stays fixed (6.908 = 99.9 % burnt) unless fitA is set. */
export function fitWiebe(theta: number[], mfb: number[], opt: { fitA?: boolean; a?: number; window?: [number, number] } = {}): WiebeFit {
  const idx: number[] = [];
  for (let i = 0; i < theta.length; i++) if (!opt.window || (theta[i] > opt.window[0] && theta[i] <= opt.window[1])) idx.push(i);
  const th = idx.map((i) => theta[i]), y = idx.map((i) => mfb[i]);
  const t10 = crossing(th, y, 0.1), t90 = crossing(th, y, 0.9);
  const t50 = crossing(th, y, 0.5);
  const a0 = opt.a ?? 6.908;
  const span = Number.isFinite(t90 - t10) ? t90 - t10 : 40;
  const start0 = Number.isFinite(t10) ? t10 - span * 0.25 : th[0];
  const x0 = [start0, Math.max(span * 1.3, 10), Number.isFinite(t50) ? 2 : 2, a0];
  const lo = [th[0] - 10, 5, 0.1, 1];
  const hi = [th[th.length - 1], 300, 8, 12];
  const rmsOf = (p: number[]) => {
    let s = 0;
    for (let k = 0; k < th.length; k++) { const e = wiebeBurnt(th[k], opt.fitA ? p[3] : a0, p[2], p[0], p[1]) - y[k]; s += e * e; }
    return Math.sqrt(s / th.length);
  };
  const free = opt.fitA ? 4 : 3;
  const r = nelderMead((p) => rmsOf(p), x0.slice(0, 4), lo, hi.map((h) => h), { maxIter: 4000, tol: 1e-12, step: [3, 10, 0.5, opt.fitA ? 1 : 0] });
  void free;
  // Restart once from the result to escape a collapsed simplex.
  const r2 = nelderMead((p) => rmsOf(p), r.x, lo, hi, { maxIter: 4000, tol: 1e-14, step: [1, 5, 0.3, opt.fitA ? 0.5 : 0] });
  const b = r2.f < r.f ? r2 : r;
  return { start: b.x[0], duration: b.x[1], m: b.x[2], a: opt.fitA ? b.x[3] : a0, rms: b.f };
}

/** User-defined burn table (angle from start of combustion, fraction 0..1) from an MFB curve. */
export function mfbToUserBurn(theta: number[], mfb: number[], start: number, duration: number, points = 21): { angle: number[]; fraction: number[] } {
  const angle: number[] = [], fraction: number[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / (points - 1)) * duration;
    angle.push(a);
    fraction.push(Math.min(1, Math.max(0, interp(theta, mfb, start + a))));
  }
  fraction[0] = 0;
  const top = fraction[points - 1] || 1;
  return { angle, fraction: fraction.map((f) => f / top) };
}

/**
 * Put a Wiebe fit into the model: burn model plus the burn start and duration of the test point(s).
 * By default the test point nearest to `speed` is updated; with `all` every test point is.
 */
export function applyWiebeToModel(model: EngineModel, fit: WiebeFit, opt: { speed?: number; all?: boolean } = {}): EngineModel {
  const tests = model.tests.map((t) => ({ ...t }));
  let target = -1;
  if (!opt.all && opt.speed !== undefined && tests.length) {
    let bd = Infinity;
    tests.forEach((t, i) => { const d = Math.abs(t.speed - opt.speed!); if (d < bd) { bd = d; target = i; } });
  }
  tests.forEach((t, i) => {
    if (opt.all || i === target) { t.burnStart = Math.round(fit.start * 100) / 100; t.burnDuration = Math.round(fit.duration * 100) / 100; }
  });
  return { ...model, burn: { kind: 'wiebe', a: Math.round(fit.a * 1000) / 1000, m: Math.round(fit.m * 1000) / 1000 }, tests };
}

