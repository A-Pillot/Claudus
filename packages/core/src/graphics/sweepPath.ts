/**
 * The articulation values an animation steps through (SHARK's AVI writer animates over the defined displacement
 * range): from `min` to `max` in steps of `increment`, each step cut into `framesPerStep` frames, and with `loop`
 * back down to `min` so the film can repeat without a jump.
 */
export interface SweepPathOptions {
  min: number;
  max: number;
  increment: number;
  framesPerStep?: number;
  /** Go back and forth: min to max and back to min. */
  loop?: boolean;
  /** Most steps allowed in one direction; a smaller increment is widened to fit. */
  maxSteps?: number;
}

export function sweepPath({ min, max, increment, framesPerStep = 1, loop = false, maxSteps = 400 }: SweepPathOptions): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  let steps = increment > 0 ? Math.ceil(span / increment - 1e-9) : 40;
  steps = Math.max(1, Math.min(maxSteps, steps));
  const per = Math.max(1, Math.round(framesPerStep));
  const n = steps * per;
  const up: number[] = [];
  for (let i = 0; i <= n; i++) up.push(min + (span * i) / n);
  if (!loop) return up;
  // The way back leaves out both ends, which the way up already has.
  return [...up, ...up.slice(1, -1).reverse(), min];
}
