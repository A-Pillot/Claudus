import { useMemo } from 'react';
import {
  analyse2D, applyFree, geometry2D, solveBump, solveFree, solveRoll, staticRollCentre, userLinesFromModel,
  type BumpResult, type FreeResult, type Geo2D, type Model2D, type Results2D, type RollResult, type UserLines,
} from '@claudus/core';
import { useTwoD } from './store2d';

export interface Solution2D {
  /** The model as solved: in a Free mode, the stored model with the freed point moved to its solved position. */
  model: Model2D;
  geo: Geo2D;
  free?: FreeResult;
  lines: UserLines;
  results: Results2D;
  /** The static position, for the faint outline. */
  rest: BumpResult;
  /** The articulation shown now (bump or roll slider). */
  bump: BumpResult;
  roll: RollResult;
}

/** Everything the 2D view and graphs need, recomputed when the model, targets, Free mode or sweep change. */
export function useSolution(): Solution2D {
  const model = useTwoD((s) => s.model);
  const sweep = useTwoD((s) => s.sweep);
  const freeMode = useTwoD((s) => s.freeMode);
  const userLines = useTwoD((s) => s.userLines);
  const art = useTwoD((s) => s.art);

  const base = useMemo(() => {
    const lines = userLines ?? userLinesFromModel(model, sweep);
    let solved = model;
    let free: FreeResult | undefined;
    if (freeMode !== 'fixAll') {
      free = solveFree(model, freeMode, lines, sweep);
      solved = applyFree(model, freeMode, free.point);
    }
    const geo = geometry2D(solved);
    return { lines, free, solved, geo, results: analyse2D(solved, sweep, geo) };
  }, [model, sweep, freeMode, userLines]);

  // Articulating is cheap, so it is solved separately and the sliders stay smooth.
  const pose = useMemo(
    () => ({ rest: solveBump(base.geo, 0), bump: solveBump(base.geo, art.bump), roll: solveRoll(base.geo, art.roll, staticRollCentre(base.geo)) }),
    [base.geo, art.bump, art.roll],
  );

  return { model: base.solved, geo: base.geo, free: base.free, lines: base.lines, results: base.results, ...pose };
}
