/**
 * The 2D "Free" modes (SHARK's Solve / 2D Fix Option).
 *
 * In Fix All the hard points fully define the suspension. In a Free mode one hard point is released and
 * its position is found so the camber and roll centre curves match the target user lines as closely as
 * possible. SHARK does not say how it picks the point, so this is a damped least-squares fit of the point's
 * Y and Z to every target at once: static roll centre height, camber and roll centre height against bump
 * and rebound, and camber, roll centre height and roll centre lateral position against roll.
 */
import { lmStep } from '../math/linalg.js';
import type { Model2D, P2, Sweep2D } from './types.js';
import { geometry2D, rollSweep2D, bumpSweep2D, type Geo2D } from './solve.js';
import { evalLine, type UserLines } from './targets.js';

export type FreeMode = 'fixAll' | 'lowerOuter' | 'upperOuter' | 'lowerInner' | 'upperInner';

/** The points that can be freed for a suspension type. `upperOuter` is the strut top on a strut. */
export function freeModes(type: 1 | 2): FreeMode[] {
  return type === 1 ? ['fixAll', 'upperOuter', 'lowerOuter', 'upperInner', 'lowerInner'] : ['fixAll', 'upperOuter', 'lowerOuter', 'lowerInner'];
}

const KEY = { lowerOuter: 'lowerOuter', upperOuter: 'upperOuter', lowerInner: 'lowerInner', upperInner: 'upperInner' } as const;

/** The freed point's position in a geometry. */
export function freePoint(geo: Geo2D, mode: Exclude<FreeMode, 'fixAll'>): P2 {
  return [...geo[KEY[mode]]];
}

function withPoint(geo: Geo2D, mode: Exclude<FreeMode, 'fixAll'>, p: P2): Geo2D {
  // A strut's top is fixed in the body, so it moves the body-side copy too.
  return { ...geo, [KEY[mode]]: p, ...(geo.strut && mode === 'upperOuter' ? { upperInner: p } : {}) };
}


/** Degrees count this many times more than mm in the fit, so 0.1 deg weighs about as much as 1 mm. */
const CAMBER_WEIGHT = 10;

/** Squash very large misses (a nearly parallel-arm roll centre can be metres away) so they cannot swamp the fit. */
const soft = (v: number) => v / (1 + Math.abs(v) / 500);

/**
 * Differences from the targets, one number per target sample. Failed solutions count as large misses.
 * `rollWeight` scales the roll targets (0 leaves them out).
 */
export function misfit(geo: Geo2D, rollTravel: number, sweep: Sweep2D, lines: UserLines, rollWeight = 1): number[] {
  const out: number[] = [];
  const miss = 100;
  for (const b of bumpSweep2D(geo, sweep)) {
    out.push(b.ok && Number.isFinite(b.rcHeight) ? soft(b.rcHeight - evalLine(lines.rcBump, b.bump)) : miss);
    if (b.bump !== 0) out.push(b.ok ? CAMBER_WEIGHT * (b.camber - evalLine(lines.camberBump, b.bump)) : miss);
  }
  const w = rollWeight;
  for (const r of rollSweep2D(geo, rollTravel, sweep.rollSteps)) {
    const okRc = r.ok && Number.isFinite(r.rcHeight) && Number.isFinite(r.rcLateral);
    out.push(w * (okRc ? soft(r.rcHeight - evalLine(lines.rcRoll, r.roll)) : miss));
    out.push(w * (okRc ? soft(r.rcLateral - evalLine(lines.rcLateralRoll, r.roll)) : miss));
    if (r.roll !== 0) out.push(w * (r.ok ? CAMBER_WEIGHT * (r.camber - evalLine(lines.camberRoll, r.roll)) : miss));
  }
  return out;
}

const rms = (r: number[]) => Math.sqrt(r.reduce((s, v) => s + v * v, 0) / Math.max(1, r.length));

export interface FreeResult {
  /** The solved position of the freed point. */
  point: P2;
  geo: Geo2D;
  /** Root mean square of the weighted differences from the targets. */
  rms: number;
  converged: boolean;
}

/**
 * Fit the freed point to the target lines. Starts from where the point is now. The bump targets are fitted
 * first (the roll centre against roll is touchy when the arms are nearly parallel), then all targets together.
 */
export function solveFree(m: Model2D, mode: Exclude<FreeMode, 'fixAll'>, lines: UserLines, sweep: Sweep2D): FreeResult {
  const base = geometry2D(m);
  let p = freePoint(base, mode);
  let converged = false;
  for (const rollWeight of [0, 1]) {
    const cost = (q: P2) => misfit(withPoint(base, mode, q), m.rollTravel, sweep, lines, rollWeight);
    ({ p, converged } = fit(p, cost));
  }
  const r = misfit(withPoint(base, mode, p), m.rollTravel, sweep, lines);
  return { point: p, geo: withPoint(base, mode, p), rms: rms(r), converged };
}

/** Damped least squares on a point's Y and Z. */
function fit(start: P2, cost: (p: P2) => number[]): { p: P2; converged: boolean } {
  let p = start;
  let r = cost(p);
  let lambda = 1e-2;
  for (let it = 0; it < 80; it++) {
    // Numerical Jacobian of the misfit with respect to the point's Y and Z.
    const h = 1e-3;
    const J = r.map(() => [0, 0]);
    for (let k = 0; k < 2; k++) {
      const q: P2 = [...p];
      q[k] += h;
      const rq = cost(q);
      for (let i = 0; i < r.length; i++) J[i][k] = (rq[i] - r[i]) / h;
    }
    let improved = false;
    let small = false;
    for (let tries = 0; tries < 12; tries++) {
      const dx = lmStep(J, r, lambda);
      // Never jump more than 50 mm in one step.
      const len = Math.hypot(dx[0], dx[1]);
      if (len > 50) { dx[0] *= 50 / len; dx[1] *= 50 / len; }
      const q: P2 = [p[0] + dx[0], p[1] + dx[1]];
      const rq = cost(q);
      if (rms(rq) < rms(r)) {
        small = rms(r) - rms(rq) < 1e-10 || len < 1e-8;
        p = q;
        r = rq;
        lambda = Math.max(1e-7, lambda / 3);
        improved = true;
        break;
      }
      lambda *= 4;
    }
    if (!improved || small) return { p, converged: true };
  }
  return { p, converged: false };
}

/**
 * Write a solved point into the model. Inner points are stored as they are. For an outer point the file
 * holds only the height, so the height is stored and the Y position goes in `outerY`.
 */
export function applyFree(m: Model2D, mode: Exclude<FreeMode, 'fixAll'>, p: P2): Model2D {
  switch (mode) {
    case 'lowerInner': return { ...m, lowerInner: p };
    case 'upperInner': return { ...m, upperInner: p };
    case 'lowerOuter': return { ...m, lowerOuterZ: p[1], outerY: { ...m.outerY, lower: p[0] } };
    case 'upperOuter': return { ...m, upperOuterZ: p[1], outerY: { ...m.outerY, upper: p[0] } };
  }
}
