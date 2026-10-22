/**
 * SDF spline fits and spline data listings (SHARK Results / List SDF Spline Fits and Spline Data). The
 * user picks the articulation types, the ends and the variables; the fits are linear, quadratic or cubic
 * least-squares polynomials of each variable against the articulation, the data list is the points behind them.
 */
import { polyfit } from '../math/linalg.js';
import type { Model } from '../model/types.js';
import type { EndAnalysis } from './derivatives.js';
import { endHardPoints, f, sdfHeader } from './sdf.js';
import { SWEEP_VARIABLES, valueOf, type ResultVar, type SweepKind } from './variables.js';

export interface SplineOptions {
  sweeps: SweepKind[];
  ends: ('front' | 'rear')[];
  /** Variable keys to list; empty or absent means every variable of the sweep. */
  variables?: string[];
  /** Polynomial order of the fit: 1 linear, 2 quadratic, 3 cubic. */
  order: 1 | 2 | 3;
  /** Echo the hard points and the heading of each list. */
  header: boolean;
}

export const defaultSplineOptions = (): SplineOptions => ({ sweeps: ['bump', 'roll', 'steer'], ends: ['front', 'rear'], order: 3, header: true });

export const SWEEP_TITLE: Record<SweepKind, string> = { bump: 'BUMP / REBOUND', roll: 'ROLL', steer: 'STEER' };

export interface Fit {
  /** Coefficients c0..cn of y = c0 + c1 x + ... */
  coeffs: number[];
  /** Largest absolute residual over the data. */
  maxError: number;
  n: number;
}

/** Least-squares polynomial fit of the finite points. Undefined when there are too few points for the order. */
export function fitCurve(x: number[], y: number[], order: number): Fit | undefined {
  const px: number[] = [];
  const py: number[] = [];
  x.forEach((xv, i) => {
    if (Number.isFinite(xv) && Number.isFinite(y[i])) {
      px.push(xv);
      py.push(y[i]);
    }
  });
  // The order is limited by the number of distinct x values, not just the number of points.
  const ord = Math.min(order, new Set(px).size - 1);
  if (ord < 1) return undefined;
  const coeffs = polyfit(px, py, ord);
  if (!coeffs.every(Number.isFinite)) return undefined;
  while (coeffs.length < order + 1) coeffs.push(0);
  const at = (xv: number) => coeffs.reduce((s, c, k) => s + c * xv ** k, 0);
  const maxError = px.reduce((m, xv, i) => Math.max(m, Math.abs(at(xv) - py[i])), 0);
  return { coeffs, maxError, n: px.length };
}

const sci = (v: number) => (Number.isFinite(v) ? v.toExponential(6).replace(/e([+-])(\d)$/, (_m, sg, d) => `e${sg}0${d}`) : '-');

interface Curve {
  end: 'front' | 'rear';
  sweep: SweepKind;
  x: ResultVar;
  y: ResultVar;
  xs: number[];
  ys: number[];
}

/** The curves the options select: only variables with at least two finite values. */
export function selectCurves(results: EndAnalysis[], o: SplineOptions): Curve[] {
  const out: Curve[] = [];
  for (const a of results) {
    if (!o.ends.includes(a.end)) continue;
    for (const sweep of o.sweeps) {
      const rows = a[sweep] as unknown[];
      const def = SWEEP_VARIABLES[sweep];
      if (!rows.length) continue;
      const xs = rows.map((r) => valueOf(r, def.x.key));
      for (const y of def.ys) {
        if (o.variables?.length && !o.variables.includes(y.key)) continue;
        const ys = rows.map((r) => valueOf(r, y.key));
        if (ys.filter(Number.isFinite).length < 2) continue;
        out.push({ end: a.end, sweep, x: def.x, y, xs, ys });
      }
    }
  }
  return out;
}

const ORDER_NAME = { 1: 'LINEAR', 2: 'QUADRATIC', 3: 'CUBIC' } as const;

function listing(m: Model, results: EndAnalysis[], o: SplineOptions, title: string, name: string, body: (c: Curve) => string[]): string {
  const L: string[] = o.header ? sdfHeader(m, title, name) : [];
  const curves = selectCurves(results, o);
  for (const a of results) {
    if (!o.ends.includes(a.end)) continue;
    if (o.header) L.push(...endHardPoints(m, a));
    for (const sweep of o.sweeps) {
      const mine = curves.filter((c) => c.end === a.end && c.sweep === sweep);
      if (!mine.length) continue;
      L.push('', `  ${a.end.toUpperCase()} SUSPENSION - ${SWEEP_TITLE[sweep]}`);
      for (const c of mine) L.push(...body(c));
    }
  }
  if (!curves.length) L.push('', '  No results match the chosen settings.');
  L.push('');
  return L.join('\n');
}

/** Spline fit equations for the selected variables. */
export function formatSplineFits(m: Model, results: EndAnalysis[], o: SplineOptions, name = ''): string {
  return listing(m, results, o, `CLAUDUS SUSPENSION DERIVATIVE SPLINE FITS (${ORDER_NAME[o.order]})`, name, (c) => {
    const fit = fitCurve(c.xs, c.ys, o.order);
    const unit = (u: string) => (u ? ` (${u})` : '');
    const lines = ['', `    ${c.y.label}${unit(c.y.unit)} against ${c.x.label.toLowerCase()}${unit(c.x.unit)}`];
    if (!fit) return [...lines, '      Not enough data to fit.'];
    const x = c.x.key;
    lines.push(`      y = ${fit.coeffs.map((k, i) => `${i === 0 ? '' : '+ '}${sci(k)}${i === 0 ? '' : i === 1 ? ` ${x}` : ` ${x}^${i}`}`).join(' ')}`);
    lines.push(`      Points ${fit.n}   Max error ${sci(fit.maxError)}`);
    return lines;
  });
}

/** The data points behind each selected spline. */
export function formatSplineData(m: Model, results: EndAnalysis[], o: SplineOptions, name = ''): string {
  return listing(m, results, o, 'CLAUDUS SUSPENSION DERIVATIVE SPLINE DATA', name, (c) => {
    const unit = (u: string) => (u ? ` (${u})` : '');
    const lines = ['', `    ${c.y.label}${unit(c.y.unit)} against ${c.x.label.toLowerCase()}${unit(c.x.unit)}`];
    c.xs.forEach((xv, i) => {
      if (Number.isFinite(xv) && Number.isFinite(c.ys[i])) lines.push(`      ${f(xv, c.x.d)}${f(c.ys[i], Math.max(c.y.d, 4), 16)}`);
    });
    return lines;
  });
}
