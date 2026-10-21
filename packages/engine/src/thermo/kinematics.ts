// Slider-crank kinematics. theta in deg crank, 0 = TDC firing. Volumes m^3.
import type { Cylinder } from '../model';
import { degToRad, mmToM, rpmToRadS } from './units';

export interface CylinderGeometry {
  displacement: number; // m^3
  clearance: number; // m^3
  area: number; // piston area m^2
}

export function cylinderGeometry(cyl: Cylinder): CylinderGeometry {
  const B = mmToM(cyl.bore);
  const area = (Math.PI / 4) * B * B;
  const displacement = area * mmToM(cyl.stroke);
  return { displacement, clearance: displacement / Math.max(cyl.compressionRatio - 1, 1e-6), area };
}

// Pin-to-crank-axis distance along the bore.
function pinDistance(cyl: Cylinder, theta: number): number {
  const r = mmToM(cyl.stroke) / 2, l = mmToM(cyl.conRod), e = mmToM(cyl.pinOffset);
  const t = degToRad(theta);
  const s = r * Math.sin(t) - e;
  return r * Math.cos(t) + Math.sqrt(Math.max(l * l - s * s, 1e-12));
}

/** Piston travel below TDC (theta = 0), m. */
function travel(cyl: Cylinder, theta: number): number {
  return pinDistance(cyl, 0) - pinDistance(cyl, theta);
}

export function cylinderVolume(cyl: Cylinder, theta: number): number {
  const g = cylinderGeometry(cyl);
  return g.clearance + g.area * travel(cyl, theta);
}

/** dV/dtheta in m^3 per degree. */
export function dVdTheta(cyl: Cylinder, theta: number): number {
  const r = mmToM(cyl.stroke) / 2, l = mmToM(cyl.conRod), e = mmToM(cyl.pinOffset);
  const t = degToRad(theta);
  const s = r * Math.sin(t) - e;
  const root = Math.sqrt(Math.max(l * l - s * s, 1e-12));
  // d(pinDistance)/dt = -r sin t - s r cos t / root ; travel = -that
  const dx = r * Math.sin(t) + (s * r * Math.cos(t)) / root;
  return cylinderGeometry(cyl).area * dx * (Math.PI / 180);
}

/** Instantaneous piston speed m/s (positive moving away from the head). */
export function pistonSpeed(cyl: Cylinder, theta: number, rpm: number): number {
  const g = cylinderGeometry(cyl);
  return (dVdTheta(cyl, theta) * (180 / Math.PI) * rpmToRadS(rpm)) / g.area;
}

export function meanPistonSpeed(cyl: Cylinder, rpm: number): number {
  return (2 * mmToM(cyl.stroke) * rpm) / 60;
}

/** Exposed liner (wetted bore) area, m^2. */
export function linerArea(cyl: Cylinder, theta: number): number {
  const g = cylinderGeometry(cyl);
  const h = g.clearance / g.area + travel(cyl, theta);
  return Math.PI * mmToM(cyl.bore) * h;
}
