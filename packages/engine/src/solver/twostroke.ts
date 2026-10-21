// Two-stroke support: piston-controlled ports, rotary disc valves, self-acting reed valves,
// varying-volume plenums (crankcases) and in-cylinder scavenging models.
// Angles are deg ATDC firing of the cylinder (crank angle); areas m^2.
import type { Cylinder, Plenum, ReedValveData, ScavengeModel, Valve } from '../model';
import { cylinderVolume } from '../thermo/index';

const wrap360 = (a: number) => ((a % 360) + 360) % 360;

/** True for valve mechanisms handled here instead of the poppet lift curve. */
export function isTwoStrokeValve(v: Valve): boolean {
  return v.type === 'piston-port' || v.type === 'disc' || v.type === 'reed';
}

// ---- Piston ported ----

/** Piston travel below TDC (mm) of a crank-slider with stroke and rod length (mm). */
export function sliderTravel(stroke: number, rod: number, thetaDeg: number): number {
  const r = stroke / 2;
  const t = (thetaDeg * Math.PI) / 180;
  const s = r * Math.sin(t);
  return r * (1 - Math.cos(t)) + rod - Math.sqrt(Math.max(rod * rod - s * s, 1e-9));
}

/** Port height uncovered by the piston, mm (0..height). */
export function pistonPortOpening(v: Valve, theta: number): number {
  const q = v.piston!;
  const top = sliderTravel(q.stroke, q.conRod, q.openAngle);
  return Math.min(q.height, Math.max(0, sliderTravel(q.stroke, q.conRod, wrap360(theta)) - top));
}

/** Cd falls linearly from 1.0 at zero area to cdMax at full area. */
function areaCd(frac: number, cdMax: number): number {
  return 1 - (1 - cdMax) * Math.min(1, Math.max(0, frac));
}

export function pistonPortArea(v: Valve, theta: number): number {
  const q = v.piston!;
  const h = pistonPortOpening(v, theta);
  if (h <= 0) return 0;
  return areaCd(h / q.height, q.cd) * q.width * h * 1e-6;
}

// ---- Disc valve ----

/** Fraction (0..1) of the disc port area uncovered at crank angle theta. */
export function discOpenFraction(v: Valve, theta: number): number {
  const q = v.disc!;
  const win = wrap360(q.closeAngle - q.openAngle);
  const t = wrap360(theta - q.openAngle);
  if (win <= 0 || t >= win) return 0;
  // The disc edge sweeps across the port over an angle of about port diameter / pitch radius.
  const rc = Math.max((q.discDiameter / 2 + q.portDiameter / 2) / 2, q.portDiameter / 2 + 1);
  const sweep = ((q.portDiameter / rc) * 180) / Math.PI;
  const u = Math.min(1, Math.min(t, win - t) / Math.max(sweep, 1e-6));
  if (u <= 0) return 0;
  const alpha = Math.acos(1 - 2 * u); // circular segment of fraction u of the diameter
  return (2 * alpha - Math.sin(2 * alpha)) / (2 * Math.PI);
}

export function discArea(v: Valve, theta: number): number {
  const q = v.disc!;
  const f = discOpenFraction(v, theta);
  if (f <= 0) return 0;
  const full = (Math.PI / 4) * q.portDiameter * q.portDiameter;
  return areaCd(f, q.cd) * full * f * 1e-6;
}

// ---- Reed valve ----

export interface ReedState {
  x: number; // lift, mm
  v: number; // mm/s
}

export function reedArea(q: ReedValveData, x: number): number {
  if (x <= 0) return 0;
  return areaCd(x / q.maxLift, q.cd) * q.petals * q.passageLength * x * 1e-6;
}

/** Advance the petal one step under pressure difference dp (Pa, positive = opening direction). */
export function stepReed(q: ReedValveData, s: ReedState, dp: number, dt: number): void {
  const k = q.stiffness * 1000; // N/m
  const area = q.petalArea * 1e-6;
  const xm = q.maxLift / 1000;
  if (!q.dynamic) {
    s.x = Math.min(q.maxLift, Math.max(0, ((dp * area) / k) * 1000));
    s.v = 0;
    return;
  }
  const m = Math.max(q.mass / 1000, 1e-7);
  const c = 2 * 0.15 * Math.sqrt(k * m); // light damping, no bounce at the stops
  let x = s.x / 1000;
  let v = s.v / 1000;
  const a = (dp * area - k * x - c * v) / m;
  v += a * dt;
  x += v * dt;
  if (x <= 0) { x = 0; v = Math.max(v, 0); }
  else if (x >= xm) { x = xm; v = Math.min(v, 0); }
  s.x = x * 1000;
  s.v = v * 1000;
}

// ---- Generic dispatch ----

/** Effective flow area (m^2) of a two-stroke valve; reed lift comes from its state. */
export function twoStrokeArea(v: Valve, theta: number, reed?: ReedState): number {
  switch (v.type) {
    case 'piston-port': return pistonPortArea(v, theta);
    case 'disc': return discArea(v, theta);
    case 'reed': return reed && v.reed ? reedArea(v.reed, reed.x) : 0;
    default: return 0;
  }
}

/** Lift-like number (mm) for the lift traces: port height uncovered, disc fraction * port dia, reed lift. */
export function twoStrokeLift(v: Valve, theta: number, reed?: ReedState): number {
  switch (v.type) {
    case 'piston-port': return pistonPortOpening(v, theta);
    case 'disc': return discOpenFraction(v, theta) * (v.disc?.portDiameter ?? 0);
    case 'reed': return reed?.x ?? 0;
    default: return 0;
  }
}

// ---- Crankcase (varying-volume plenum) ----

/** Volume (m^3) of a varying-volume plenum at crankshaft angle g (deg, absolute). */
export function crankVolume(p: Plenum, g: number): number {
  const q = p.varying!;
  const cyl: Cylinder = {
    id: 0, label: '', bore: q.bore, stroke: q.stroke, conRod: q.conRod, pinOffset: 0,
    compressionRatio: Math.max(q.compressionRatio, 1.0001), firingAngle: 0,
  };
  return cylinderVolume(cyl, wrap360(g * (q.speedRatio || 1) - q.tdcAngle));
}

// ---- Scavenging ----

/**
 * Burnt-gas fraction of the gas leaving the cylinder.
 * burnt = mean burnt fraction in the cylinder, sr = scavenge ratio so far this cycle (fresh in / reference mass).
 * Perfect mixing: outflow has the mean composition. Perfect displacement: burnt gas leaves first.
 * Benson-Brandham: displacement up to scavenge ratio A, perfect mixing after.
 * Blair-style (approximation): mixing exponent B > 0 sharpens the stripping towards displacement.
 */
export function scavengeOutBurnt(sc: ScavengeModel | undefined, burnt: number, sr: number): number {
  if (!sc || sc.kind === 'perfect-mixing') return burnt;
  const disp = Math.min(1, burnt / 0.002);
  switch (sc.kind) {
    case 'perfect-displacement': return disp;
    case 'benson-brandham': return sr < sc.a ? disp : burnt;
    case 'blair': return Math.pow(Math.max(burnt, 0), 1 / (1 + Math.max(sc.b, 0)));
  }
}
