// Port flow analysis: air-flow bench data (.blo) and lift curves (.lft) -> flow / discharge coefficients.
import type { Valve } from '../model';
import { DEG, interp, numbersIn } from './numeric';

export interface PortFlowRow {
  lift: number; // mm
  /** Orifice reading (superflow: pressure-drop reading, old rig: volume flow in cfm). */
  flow: number;
  orifice: number; // orifice number (superflow), 0 for the old rig
  testPressure: number; // mm H2O as entered, after the pressure factor
  temperature: number; // C downstream
  valvePressure: number; // mm H2O across the valve/port, absolute
  vaneSpeed?: number; // rpm
}

export interface LiftInfo {
  ivo: number; // deg BTDC
  ivc: number; // deg ABDC
  maxLift: number; // mm
  file: string;
  speed: number; // rpm
  ratio: number;
}

export interface PortFlowData {
  title: string;
  rig: 'old' | 'superflow';
  valve: 'intake' | 'exhaust';
  definedPressure: boolean;
  swirl: 'none' | 'swirl' | 'tumble';
  bore: number;
  stroke: number;
  conRod?: number;
  nValves: number;
  throat: number; // mm
  seatAngle: number; // deg
  pressureFactor: number;
  dropFactor: number;
  orificeFactors: number[]; // cfm at 100 %
  rigBore?: number;
  swirlConstant?: number;
  lift?: LiftInfo;
  ambientPressure: number; // mbar
  ambientTemperature: number; // C
  reference: string;
  rows: PortFlowRow[];
}

/** Parse a .blo port flow bench file. */
export function parsePortFlowFile(text: string): PortFlowData {
  const lines = text.replace(/\r/g, '').split('\n');
  let pos = 0;
  const next = () => lines[pos++] ?? '';
  const title = next().trim();
  const flags = numbersIn(next());
  const [irig, ivalve, idelp, iswl, ilft] = flags;
  const geo = numbersIn(next());
  const hasRod = geo.length >= 6;
  const bore = geo[0], stroke = geo[1];
  const conRod = hasRod ? geo[2] : undefined;
  const o = hasRod ? 3 : 2;
  const nValves = geo[o], throat = geo[o + 1], seatAngle = geo[o + 2];
  const cp = numbersIn(next());
  const rig = irig === 2 ? 'superflow' : 'old';
  const orificeFactors: number[] = [];
  if (rig === 'superflow') {
    const n = Math.abs(cp[1]) || 6;
    while (orificeFactors.length < n && pos < lines.length) orificeFactors.push(...numbersIn(next()));
    orificeFactors.length = Math.min(orificeFactors.length, n);
  }
  let rigBore: number | undefined, swirlConstant: number | undefined;
  if (iswl) { const t = numbersIn(next()); rigBore = t[0]; swirlConstant = t[1]; }
  let lift: LiftInfo | undefined;
  if (ilft === 1) {
    const toks = next().replace(/:.*$/, '').replace(/,/g, ' ').trim().split(/\s+/);
    lift = { ivo: Number(toks[0]), ivc: Number(toks[1]), maxLift: Number(toks[2]), file: toks[3] ?? '', speed: Number(toks[4]), ratio: Number(toks[5] ?? 1) };
  }
  const info = next().replace(/:.*$/, '').replace(/,/g, ' ').trim().split(/\s+/);
  const npts = Number(info[info.length - 1]);
  const ambientPressure = Number(info[0]), ambientTemperature = Number(info[1]);
  const reference = info.length >= 7 ? info[5] : '';
  const rows: PortFlowRow[] = [];
  const dpFac = Math.abs(rig === 'superflow' ? cp[2] ?? 1 : 1) || 1;
  const pFac = Math.abs(cp[0] ?? 1) || 1;
  while (rows.length < npts && pos < lines.length) {
    const v = numbersIn(next());
    if (v.length < 3) continue;
    if (rig === 'superflow') {
      // lift, orifice reading, orifice number, test pressure, temperature, valve pressure drop, vane speed
      rows.push({ lift: v[0], flow: v[1], orifice: v[2], testPressure: Math.abs(v[3]) * pFac, temperature: v[4], valvePressure: Math.abs(v[5] ?? v[3]) * dpFac, vaneSpeed: v[6] });
    } else {
      // lift, flow (cfm), pressure, temperature, valve pressure, vane speed
      const dp = Math.abs(v[4] ?? v[2]) * pFac;
      rows.push({ lift: v[0], flow: v[1], orifice: 0, testPressure: Math.abs(v[2]) * pFac, temperature: v[3] ?? ambientTemperature, valvePressure: dp, vaneSpeed: v[5] });
    }
  }
  return {
    title, rig, valve: ivalve === 2 ? 'exhaust' : 'intake', definedPressure: idelp === 1,
    swirl: iswl === 1 ? 'swirl' : iswl === 2 ? 'tumble' : 'none',
    bore, stroke, conRod, nValves, throat, seatAngle,
    pressureFactor: pFac, dropFactor: dpFac, orificeFactors, rigBore, swirlConstant, lift,
    ambientPressure, ambientTemperature, reference, rows,
  };
}

/** Parse a .lft lift curve: crank angle (deg) and lift ordinates (any scale). */
export function parseLiftFile(text: string): { angle: number[]; lift: number[] } {
  const angle: number[] = [], lift: number[] = [];
  for (const l of text.replace(/\r/g, '').split('\n')) {
    const v = numbersIn(l);
    if (v.length >= 2) { angle.push(v[0]); lift.push(v[1]); }
  }
  return { angle, lift };
}

export type AreaBasis = 'min' | 'curtain' | 'throat';

export interface PortFlowOptions {
  /** Area used as the reference of the discharge coefficient (default: smaller of curtain and throat area). */
  areaBasis?: AreaBasis;
  /** Compressibility: use the isentropic mass flux instead of the incompressible velocity (default true). */
  compressible?: boolean;
}

export interface PortFlowPoint {
  lift: number; // mm
  ld: number; // lift / throat diameter
  volumeFlow: number; // m3/s
  massFlow: number; // kg/s
  curtainArea: number; // mm2 (all valves)
  throatArea: number; // mm2 (all valves)
  cd: number; // discharge coefficient
  cf: number; // flow coefficient (referred to the throat area)
  swirl?: number; // rig swirl (or tumble) number
}

export interface PortFlowSummary {
  throatBoreRatio: number;
  cfAt03: number;
  cdAt03: number;
  meanCf03: number; // mean flow coefficient over 0..0.3 L/D
  meanCd03: number;
  maxCd: number;
  meanCfOverLift?: number;
  meanAreaRatio?: number; // mean effective flow area / bore area over the valve lift event
}

export interface PortFlowResult {
  points: PortFlowPoint[];
  summary: PortFlowSummary;
  /** Cd vs L/D table ready for Valve.cd, anchored at zero lift. */
  cdTable: { ld: number[]; cd: number[] };
}

const CFM = 4.71947e-4; // m3/s per cfm
const R_AIR = 287.05;
const GAMMA = 1.4;
const MMH2O = 9.80665; // Pa per mm of water

/** Valve curtain (seat frustum) area for one valve, mm2. */
export function portCurtainArea(lift: number, throat: number, seatAngleDeg: number): number {
  const b = seatAngleDeg * DEG;
  return Math.PI * lift * Math.cos(b) * (throat + lift * Math.sin(b) * Math.cos(b));
}

/** Ideal isentropic mass flow (kg/s) through an area (m2) for an upstream stagnation pressure and a pressure drop (Pa). */
function idealMassFlow(area: number, pUp: number, dp: number, T0: number, compressible: boolean): number {
  if (!compressible) return area * Math.sqrt(2 * (pUp / (R_AIR * T0)) * dp);
  const r = Math.max((pUp - dp) / pUp, 0.528);
  const f = Math.sqrt(Math.max(Math.pow(r, 2 / GAMMA) - Math.pow(r, (GAMMA + 1) / GAMMA), 0));
  return area * pUp * Math.sqrt((2 * GAMMA) / ((GAMMA - 1) * R_AIR * T0)) * f;
}

/** Compute flow / discharge coefficients (and swirl numbers) from bench data. */
export function analysePortFlow(d: PortFlowData, opt: PortFlowOptions = {}): PortFlowResult {
  const basis = opt.areaBasis ?? 'min';
  const comp = opt.compressible ?? true;
  const pAmb = d.ambientPressure * 100; // Pa
  const points: PortFlowPoint[] = d.rows.map((r) => {
    const q = d.rig === 'superflow' ? (d.orificeFactors[Math.max(r.orifice - 1, 0)] ?? 0) * (r.flow / 100) : r.flow;
    const vol = q * CFM;
    const tAmb = d.ambientTemperature + 273.15;
    const rho = pAmb / (R_AIR * tAmb);
    const mdot = vol * rho;
    const dp = r.valvePressure * MMH2O;
    // Intake: air drawn from ambient through the valve; exhaust: blown from a raised pressure to ambient.
    const pUp = d.valve === 'intake' ? pAmb : pAmb + dp;
    const T0 = d.valve === 'intake' ? tAmb : r.temperature + 273.15;
    const curtain = d.nValves * portCurtainArea(r.lift, d.throat, d.seatAngle);
    const throatA = (d.nValves * Math.PI * d.throat * d.throat) / 4;
    const ref = basis === 'curtain' ? curtain : basis === 'throat' ? throatA : Math.min(curtain, throatA);
    const idealRef = idealMassFlow(ref * 1e-6, pUp, dp, T0, comp);
    const idealThroat = idealMassFlow(throatA * 1e-6, pUp, dp, T0, comp);
    const pt: PortFlowPoint = {
      lift: r.lift, ld: r.lift / d.throat, volumeFlow: vol, massFlow: mdot,
      curtainArea: curtain, throatArea: throatA,
      cd: idealRef > 0 ? mdot / idealRef : 0, cf: idealThroat > 0 ? mdot / idealThroat : 0,
    };
    if (d.swirl !== 'none' && r.vaneSpeed !== undefined && vol > 0) {
      const bRig = (d.rigBore ?? d.bore) / 1000;
      const vax = vol / ((Math.PI / 4) * bRig * bRig);
      pt.swirl = (((2 * Math.PI * r.vaneSpeed) / 60) * bRig * (d.swirlConstant ?? 1)) / (2 * vax);
    }
    return pt;
  });
  const lds = points.map((p) => p.ld), cds = points.map((p) => p.cd), cfs = points.map((p) => p.cf);
  const mean03 = (ys: number[]) => {
    // Trapezoid mean over 0..0.3 L/D with y(0) = 0 for the flow coefficient.
    const xs = [0, ...lds.filter((x) => x > 0 && x < 0.3), 0.3];
    const vals = xs.map((x) => (x === 0 ? ys[0] : interp(lds, ys, x)));
    let s = 0;
    for (let i = 1; i < xs.length; i++) s += ((vals[i] + vals[i - 1]) / 2) * (xs[i] - xs[i - 1]);
    return s / 0.3;
  };
  const summary: PortFlowSummary = {
    throatBoreRatio: (d.nValves * d.throat * d.throat) / (d.bore * d.bore),
    cfAt03: interp(lds, cfs, 0.3), cdAt03: interp(lds, cds, 0.3),
    meanCf03: points.length ? mean03(cfs) : NaN, meanCd03: points.length ? mean03(cds) : NaN,
    maxCd: Math.max(0, ...cds),
  };
  const ld = [0, ...lds], cd = [cds[0] ?? 0, ...cds];
  return { points, summary, cdTable: { ld, cd } };
}

/** Scale a lift file's ordinates so that the peak equals the maximum lift (mm). */
export function parseLiftScaled(lft: { angle: number[]; lift: number[] }, maxLift: number): { angle: number[]; lift: number[] } {
  const pk = Math.max(...lft.lift) || 1;
  return { angle: lft.angle.slice(), lift: lft.lift.map((l) => (l / pk) * maxLift) };
}

/** Averages over the valve event for a lift curve: mean flow coefficient and mean effective area / bore area. */
export function liftEventAverages(d: PortFlowData, res: PortFlowResult, curve: { angle: number[]; lift: number[] }): { meanCf: number; meanAreaRatio: number; machIndex: (rpm: number) => number } {
  const lifts = res.points.map((p) => p.lift), cf = res.points.map((p) => p.cf), cd = res.points.map((p) => p.cd);
  const boreArea = (Math.PI / 4) * d.bore * d.bore;
  let n = 0, sCf = 0, sA = 0;
  for (const l of curve.lift) {
    if (l <= 0) continue;
    n++;
    sCf += interp(lifts, cf, l);
    const A = d.nValves * portCurtainArea(l, d.throat, d.seatAngle);
    sA += (interp(lifts, cd, l) * Math.min(A, res.points[0]?.throatArea ?? A)) / boreArea;
  }
  const meanCf = n ? sCf / n : 0;
  const meanAreaRatio = n ? sA / curve.lift.length : 0;
  const aMean = meanAreaRatio * boreArea * 1e-6;
  return {
    meanCf, meanAreaRatio,
    machIndex: (rpm: number) => {
      const sp = (2 * d.stroke * rpm) / 60000;
      const a = Math.sqrt(1.4 * R_AIR * (d.ambientTemperature + 273.15));
      return aMean > 0 ? (sp * boreArea * 1e-6) / (a * aMean) : NaN;
    },
  };
}

/** Run the analysis including the lift-curve statistics when a lift curve is supplied. */
export function analysePortFlowWithLift(d: PortFlowData, lft: { angle: number[]; lift: number[] } | undefined, opt: PortFlowOptions = {}): PortFlowResult {
  const res = analysePortFlow(d, opt);
  if (d.lift && lft && lft.angle.length) {
    const curve = parseLiftScaled(lft, d.lift.maxLift);
    const avg = liftEventAverages(d, res, curve);
    res.summary.meanCfOverLift = avg.meanCf;
    res.summary.meanAreaRatio = avg.meanAreaRatio;
  }
  return res;
}

/** Put the Cd table on a valve (a copy is returned). */
export function applyCdToValve(valve: Valve, table: { ld: number[]; cd: number[] }): Valve {
  const r = (x: number) => Math.round(x * 10000) / 10000;
  return { ...valve, cd: { ld: table.ld.map(r), cd: table.cd.map(r) } };
}
