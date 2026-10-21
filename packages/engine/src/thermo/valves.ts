// Valve lift, flow areas, orifice flow and throttle area.
import type { Throttle, Valve } from '../model';
import type { GasProps } from './gas';
import { mm2ToM2, mmToM, wrapAngle } from './units';

/** Lift in mm at crank angle theta (deg, absolute 0..cycle, windows may wrap). */
export function valveLift(valve: Valve, theta: number, cycleDeg: number): number {
  const c = valve.liftCurve;
  if (c && c.angle.length >= 2) {
    const a = c.angle;
    const lo = a[0], hi = a[a.length - 1];
    for (const k of [0, -1, 1]) {
      const t = wrapAngle(theta, cycleDeg) + k * cycleDeg;
      if (t >= lo && t <= hi) {
        let i = 1;
        while (i < a.length - 1 && a[i] < t) i++;
        const f = (t - a[i - 1]) / (a[i] - a[i - 1] || 1);
        return Math.max(0, c.lift[i - 1] + f * (c.lift[i] - c.lift[i - 1]));
      }
    }
    return 0;
  }
  const dur = wrapAngle(valve.closeAngle - valve.openAngle, cycleDeg);
  if (dur <= 0) return 0;
  const x = wrapAngle(theta - valve.openAngle, cycleDeg) / dur;
  if (x >= 1) return 0;
  // Smooth cam-like profile: sin^2 shape with a slightly fuller top.
  const s = Math.sin(Math.PI * x);
  return valve.maxLift * Math.pow(s, 1.6);
}

/** Curtain area m^2 for lift in mm. */
export function valveCurtainArea(valve: Valve, lift: number): number {
  return Math.PI * mmToM(valve.diameter) * mmToM(lift);
}

/** Default discharge coefficient (on curtain/seat basis) vs L/D. */
export function defaultValveCd(ld: number, kind: 'intake' | 'exhaust'): number {
  const xs = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
  const ys = kind === 'intake' ? [0.6, 0.62, 0.6, 0.57, 0.53, 0.48, 0.45] : [0.5, 0.55, 0.57, 0.55, 0.52, 0.48, 0.45];
  if (ld <= 0) return ys[0];
  if (ld >= 0.3) return ys[6];
  const f = ld / 0.05, i = Math.floor(f), r = f - i;
  return ys[i] + r * (ys[i + 1] - ys[i]);
}

function cdFrom(table: { ld: number[]; cd: number[] }, ld: number): number {
  const { ld: xs, cd: ys } = table;
  const n = xs.length;
  if (n === 0) return 0.6;
  if (ld <= xs[0]) return ys[0];
  if (ld >= xs[n - 1]) return ys[n - 1];
  let i = 1;
  while (xs[i] < ld) i++;
  return ys[i - 1] + ((ld - xs[i - 1]) / (xs[i] - xs[i - 1] || 1)) * (ys[i] - ys[i - 1]);
}

/** Effective flow area (Cd * min(curtain, seat)) m^2. */
export function valveEffectiveArea(valve: Valve, theta: number, cycleDeg: number): number {
  const lift = valveLift(valve, theta, cycleDeg);
  if (lift <= 0) return 0;
  const ld = lift / valve.diameter;
  const cd = valve.cd && valve.cd.ld.length ? cdFrom(valve.cd, ld) : defaultValveCd(ld, valve.kind);
  const seat = mm2ToM2((Math.PI / 4) * valve.diameter * valve.diameter);
  return cd * Math.min(valveCurtainArea(valve, lift), seat);
}

// ---- Orifice flow ----
/** Isentropic nozzle mass flow from stagnation (p0,T0) to pDown, kg/s >= 0. */
export function orificeMassFlow(p0: number, T0: number, gas: GasProps, pDown: number, effArea: number): number {
  if (effArea <= 0 || p0 <= pDown || p0 <= 0) return 0;
  const g = gas.gamma;
  const crit = Math.pow(2 / (g + 1), g / (g - 1));
  const r = pDown / p0;
  const k = effArea * p0 / Math.sqrt(gas.R * T0);
  if (r <= crit) return k * Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  return k * Math.sqrt(((2 * g) / (g - 1)) * (Math.pow(r, 2 / g) - Math.pow(r, (g + 1) / g)));
}

export interface FlowResult { mdot: number; hFlux: number }

/** Signed flow a->b (positive a to b) and enthalpy flux from the upstream side. */
export function flowBetween(
  pa: number, Ta: number, gasA: GasProps, pb: number, Tb: number, gasB: GasProps, effArea: number,
): FlowResult {
  if (pa >= pb) {
    const m = orificeMassFlow(pa, Ta, gasA, pb, effArea);
    return { mdot: m, hFlux: m * (gasA.h ?? gasA.cp * Ta) };
  }
  const m = orificeMassFlow(pb, Tb, gasB, pa, effArea);
  return { mdot: -m, hFlux: -m * (gasB.h ?? gasB.cp * Tb) };
}

/** Throttle effective area m^2. Butterfly: 0 deg closed, 90 deg open. */
export function throttleEffectiveArea(t: Throttle): number {
  const full = (Math.PI / 4) * mmToM(t.diameter) ** 2;
  let open: number;
  if (t.kind === 'area') open = Math.min(Math.max(t.position, 0), 1);
  else {
    const a = (Math.min(Math.max(t.position, 0), 90) * Math.PI) / 180;
    open = 1 - Math.cos(a);
  }
  return t.cd * full * Math.max(open, 1e-4);
}
