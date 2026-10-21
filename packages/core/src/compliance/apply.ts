/**
 * Turning a kinematic corner into a compliant one.
 */
import type { End } from '../model/types.js';
import type { Corner, CornerState } from '../solver/corner.js';
import { solveCompliance, type ComplianceResult } from './solve.js';
import { defaultEndCompliance, type ComplianceData, type EndCompliance, type ExternalForce } from './types.js';

export const endCompliance = (data: ComplianceData | undefined, end: End): EndCompliance => data?.[end] ?? defaultEndCompliance();

/** The switched-on forces of a set that act on this end. */
export function forcesFor(data: ComplianceData, end: End, set = data.activeSet): ExternalForce[] {
  const fs = data.forceSets[set];
  if (!fs || !fs.on) return [];
  return fs.forces.filter((f) => f.on && f.end === end);
}

/** Solve the compliant deflection at one kinematic state with a chosen force set. */
export function complianceAt(c: Corner, st: CornerState, data: ComplianceData, set = data.activeSet): ComplianceResult {
  return solveCompliance(c, st, endCompliance(data, c.end), { settings: data.settings, forces: forcesFor(data, c.end, set) });
}

/** Make every solve of this corner compliant, so all derivatives come from the deformed geometry. */
export function makeCompliant(c: Corner, data: ComplianceData, set = data.activeSet): Corner {
  c.deform = (st) => complianceAt(c, st, data, set).points;
  return c;
}

