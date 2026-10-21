/**
 * The "maths strings" of SHARK's hard point import: a point label written as [ ... ] is a formula over other
 * points, e.g. [(P1+P2)/2.0]. P4 is the fourth point of the template. The syntax is loosely Fortran:
 * + - * / ** and round brackets, plus SQRT SIN COS TAN SIND COSD TAND ASIN ACOS ATAN ASIND ACOSD ATAND
 * LOG10 SINH COSH TANH LOG EXP ABS. A value is either a number or a point (x, y, z); operators work
 * component by component and a number mixes freely with a point, so [P1+2.0*(P2-P1)] is a point.
 */
import type { Vec3 } from '../math/vec3.js';

export type MathValue = number | Vec3;

export class MathStringError extends Error {}

const D2R = Math.PI / 180;
const FUNCTIONS: Record<string, (x: number) => number> = {
  SQRT: Math.sqrt, SIN: Math.sin, COS: Math.cos, TAN: Math.tan,
  SIND: (x) => Math.sin(x * D2R), COSD: (x) => Math.cos(x * D2R), TAND: (x) => Math.tan(x * D2R),
  ASIN: Math.asin, ACOS: Math.acos, ATAN: Math.atan,
  ASIND: (x) => Math.asin(x) / D2R, ACOSD: (x) => Math.acos(x) / D2R, ATAND: (x) => Math.atan(x) / D2R,
  LOG10: Math.log10, SINH: Math.sinh, COSH: Math.cosh, TANH: Math.tanh, LOG: Math.log, EXP: Math.exp, ABS: Math.abs,
};

const isPoint = (v: MathValue): v is Vec3 => Array.isArray(v);

/** Apply a binary operation component by component. */
function lift(a: MathValue, b: MathValue, f: (x: number, y: number) => number): MathValue {
  if (!isPoint(a) && !isPoint(b)) return f(a, b);
  const pa = isPoint(a) ? a : ([a, a, a] as Vec3);
  const pb = isPoint(b) ? b : ([b, b, b] as Vec3);
  return [f(pa[0], pb[0]), f(pa[1], pb[1]), f(pa[2], pb[2])];
}

/** True when the label is a maths string: text bounded by [ ]. */
export const isMathString = (s: string): boolean => /^\s*\[.*\]\s*$/.test(s);

/**
 * Evaluate a maths string (with or without its brackets). `point(n)` returns template point n (1-based).
 * The result must be a point.
 */
export function evalMathString(src: string, point: (n: number) => Vec3): Vec3 {
  const text = src.trim().replace(/^\[/, '').replace(/\]$/, '');
  const toks: string[] = [];
  const tokenRe = /\s*(\*\*|[+\-*/(),]|\d+\.?\d*(?:[eEdD][+-]?\d+)?|\.\d+(?:[eEdD][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*)/y;
  for (let pos = 0; text.slice(pos).trim() !== ''; ) {
    tokenRe.lastIndex = pos;
    const m = tokenRe.exec(text);
    if (!m) throw new MathStringError(`Cannot read "${text.slice(pos).trim()}" in [${text}]`);
    toks.push(m[1]);
    pos = tokenRe.lastIndex;
  }
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const expect = (t: string) => {
    if (take() !== t) throw new MathStringError(`Expected "${t}" in [${text}]`);
  };

  const expr = (): MathValue => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = take();
      const r = term();
      v = lift(v, r, op === '+' ? (x, y) => x + y : (x, y) => x - y);
    }
    return v;
  };
  const term = (): MathValue => {
    let v = unary();
    while (peek() === '*' || peek() === '/') {
      const op = take();
      const r = unary();
      v = lift(v, r, op === '*' ? (x, y) => x * y : (x, y) => x / y);
    }
    return v;
  };
  const unary = (): MathValue => {
    if (peek() === '-') {
      take();
      return lift(0, unary(), (x, y) => x - y);
    }
    if (peek() === '+') {
      take();
      return unary();
    }
    return power();
  };
  // ** is right-associative and binds tighter than unary minus on its left, as in Fortran.
  const power = (): MathValue => {
    const base = atom();
    if (peek() === '**') {
      take();
      return lift(base, unary(), Math.pow);
    }
    return base;
  };
  const atom = (): MathValue => {
    const t = take();
    if (t === undefined) throw new MathStringError(`[${text}] ends early`);
    if (t === '(') {
      const v = expr();
      expect(')');
      return v;
    }
    if (/^[\d.]/.test(t)) return Number(t.replace(/[dD]/, 'E'));
    const up = t.toUpperCase();
    if (/^P\d+$/.test(up) && peek() !== '(') {
      const n = Number(up.slice(1));
      const p = point(n);
      if (!p) throw new MathStringError(`There is no point P${n}`);
      return [p[0], p[1], p[2]];
    }
    if (up === 'PI' && peek() !== '(') return Math.PI;
    const fn = FUNCTIONS[up];
    if (fn && peek() === '(') {
      take();
      const arg = expr();
      expect(')');
      return isPoint(arg) ? [fn(arg[0]), fn(arg[1]), fn(arg[2])] : fn(arg);
    }
    throw new MathStringError(`Unknown name "${t}" in [${text}]`);
  };

  const v = expr();
  if (i < toks.length) throw new MathStringError(`Unexpected "${toks[i]}" in [${text}]`);
  if (!isPoint(v)) throw new MathStringError(`[${text}] is a number, not a point`);
  if (!v.every(Number.isFinite)) throw new MathStringError(`[${text}] does not give a finite point`);
  return v;
}
