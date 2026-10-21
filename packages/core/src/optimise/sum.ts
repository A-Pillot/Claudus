/**
 * The kinematic sum: a weighted total of how far chosen results are from their targets. Graph results
 * are measured against their user lines, compliance coefficients against a single target value.
 */
import type { End, Model } from '../model/types.js';
import { Corner } from '../solver/corner.js';
import { bumpSweep, rollSweep, steerSweep } from '../results/derivatives.js';
import { makeCompliant } from '../compliance/apply.js';
import { complianceCoefficients, type CoefficientValues } from '../compliance/analysis.js';
import { defaultCompliance } from '../compliance/types.js';
import { deviation, lineKey, type Sweep, type UserLine } from './lines.js';

export type SumTarget =
  | { kind: 'graph'; end: End; sweep: Sweep; variable: string; weight: number; on: boolean }
  | { kind: 'compliance'; end: End; set: number; coefficient: keyof CoefficientValues; target: number; weight: number; on: boolean };

export interface SumItem {
  target: SumTarget;
  /** Deviation from target; undefined when it cannot be worked out (no user line, no overlap, no end). */
  deviation?: number;
  weighted: number;
}

export interface KinematicSum {
  total: number;
  items: SumItem[];
}

export interface SumOptions {
  /** Run the graph results in compliant mode. */
  compliant?: boolean;
}

/** Work out the kinematic sum for a model. */
export function kinematicSum(m: Model, targets: SumTarget[], lines: UserLine[], opts: SumOptions = {}): KinematicSum {
  const byKey = new Map(lines.map((l) => [lineKey(l), l]));
  const corners = new Map<End, Corner>();
  const corner = (end: End) => {
    if (!corners.has(end)) {
      const data = m[end];
      if (!data) return undefined;
      const c = new Corner(data, end);
      if (opts.compliant) makeCompliant(c, m.compliance ?? defaultCompliance());
      corners.set(end, c);
    }
    return corners.get(end);
  };
  const sweeps = new Map<string, unknown[]>();
  const rows = (end: End, sweep: Sweep) => {
    const k = `${end}:${sweep}`;
    if (!sweeps.has(k)) {
      const c = corner(end);
      if (!c) return undefined;
      sweeps.set(k, sweep === 'bump' ? bumpSweep(c, m.params) : sweep === 'roll' ? rollSweep(c, m.params) : steerSweep(c, m.params));
    }
    return sweeps.get(k) as Parameters<typeof deviation>[0];
  };
  const coeffs = new Map<End, ReturnType<typeof complianceCoefficients>>();
  const coefficientsFor = (end: End) => {
    if (!coeffs.has(end)) {
      const data = m[end];
      if (!data) return undefined;
      // Coefficients compare compliant with kinematic, so they always use a plain corner.
      coeffs.set(end, complianceCoefficients(new Corner(data, end), m.compliance ?? defaultCompliance()));
    }
    return coeffs.get(end);
  };

  const items = targets.map((target): SumItem => {
    let dev: number | undefined;
    if (target.on) {
      if (target.kind === 'graph') {
        const line = byKey.get(lineKey(target));
        const r = line && rows(target.end, target.sweep);
        dev = line && r ? deviation(r, line) : undefined;
      } else {
        const set = coefficientsFor(target.end)?.[target.set];
        dev = set ? Math.abs(set.values[target.coefficient] - target.target) : undefined;
      }
    }
    return { target, deviation: dev, weighted: dev === undefined ? 0 : dev * target.weight };
  });
  return { total: items.reduce((s, i) => s + i.weighted, 0), items };
}
