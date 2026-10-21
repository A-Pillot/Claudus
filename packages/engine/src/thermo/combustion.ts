// Burn-rate functions: return cumulative mass fraction burned 0..1.
import type { BurnModel, FuelType } from '../model';

/** Wiebe cumulative burn, normalised so it reaches 1 at start+duration. */
export function wiebe(theta: number, start: number, duration: number, a: number, m: number): number {
  const y = (theta - start) / duration;
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  return (1 - Math.exp(-a * Math.pow(y, m + 1))) / (1 - Math.exp(-a));
}

/** Default Wiebe a, m by fuel (help: Wiebe Function Defaults). */
export function defaultWiebe(type: FuelType): { a: number; m: number } {
  switch (type) {
    case 'diesel': return { a: 6.9, m: 0.5 };
    case 'natural-gas': return { a: 5.0, m: 2.2 };
    default: return { a: 10.0, m: 2.0 };
  }
}

function interp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

export function burnFraction(model: BurnModel, theta: number, start: number, duration: number): number {
  switch (model.kind) {
    case 'wiebe':
      return wiebe(theta, start, duration, model.a, model.m);
    case 'wiebe2': {
      const p = model.premixFraction;
      return p * wiebe(theta, start, duration, model.a1, model.m1) + (1 - p) * wiebe(theta, start, duration, model.a2, model.m2);
    }
    case 'user': {
      const y = (theta - start) / duration;
      if (y <= 0) return 0;
      if (y >= 1) return 1;
      const last = model.angle[model.angle.length - 1] || 1;
      const xs = model.angle.map((a) => a / last);
      const top = model.fraction[model.fraction.length - 1] || 1;
      return Math.min(1, Math.max(0, interp(xs, model.fraction, y) / top));
    }
  }
}
