/** Solver settings from SHARK's Solve menu that change how a corner is solved. */
import type { Model } from '../model/types.js';

export interface SolverOptions {
  /** Kinematic solution tolerance (the model's TOLERANCES section, first value). */
  kinTol: number;
  /** Small bump perturbation used for rates, mm. */
  bumpPerturb: number;
  /** Small steer perturbation used for virtual kingpin axes, mm. */
  steerPerturb: number;
  /** Solve / Motion: what moves under bump. 'ground' moves the ground plane, 'body' moves the body. */
  motion: 'ground' | 'body';
  /** Solve / Roll Solution Type: the old method rolls about the roll centre of the previous step. */
  rollOld: boolean;
}

export const DEFAULT_TOLERANCES = [1e-10, 0.05, 0.05];

export const defaultSolverOptions = (): SolverOptions => ({ kinTol: 1e-9, bumpPerturb: 0.05, steerPerturb: 0.05, motion: 'ground', rollOld: false });

/**
 * Options for a model: tolerances from its data file and the roll solution type, plus the session settings
 * (`motion`) that are not part of the file. Files with an older, four-value TOLERANCES layout use defaults.
 */
export function solverOptionsFor(m: Pick<Model, 'tolerances' | 'rollSolution'>, session: Partial<SolverOptions> = {}): SolverOptions {
  const t = m.tolerances.length === 3 && m.tolerances.every((v) => Number.isFinite(v) && v > 0) ? m.tolerances : undefined;
  const d = defaultSolverOptions();
  return {
    ...d,
    ...(t ? { kinTol: Math.min(1e-4, Math.max(1e-14, t[0])), bumpPerturb: t[1], steerPerturb: t[2] } : {}),
    rollOld: m.rollSolution === 2,
    ...session,
  };
}
