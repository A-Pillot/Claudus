/**
 * Reader and writer for SHARK 2D model files.
 *
 * A 2D file has no section names, just rows of numbers in a fixed order:
 *   version row, suspension type,
 *   general data (track, kingpin angle, kingpin offset, [damper angle for struts],
 *                 camber change in bump and rebound, static RC height, RC change in bump and rebound),
 *   lower outer Z, upper outer (or strut top) Z, lower inner Y Z, [upper inner Y Z for wishbones],
 *   roll row (roll travel, camber change in roll, RC height change in roll, RC lateral change in roll).
 * The meaning of the roll row is inferred from the sample files and the defaults in the help.
 * Anything after the roll row is kept verbatim.
 */
import { newModel2D, type Model2D, type TwoDType } from './types.js';

export class TwoDParseError extends Error {}

const toNum = (s: string) => Number(s.replace(/[dD]/, 'E'));

/** True when the text looks like a 2D file: no section names, just numbers from the first line. */
export function isTwoDText(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
  return first !== undefined && first.trim().split(/[\s,]+/).every((t) => Number.isFinite(toNum(t)));
}

export function readTwoD(text: string): Model2D {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const m = newModel2D(1);
  m.eol = text.includes('\r\n') ? '\r\n' : '\n';
  let at = 0;
  const tokens: string[][] = [];
  // Read one row that must hold at least `count` numbers; the first `count` are returned.
  const take = (count: number, what: string): number[] => {
    const toks = lines[at]?.trim().split(/[\s,]+/) ?? [];
    at++;
    if (toks.length < count || toks.slice(0, count).some((t) => !Number.isFinite(toNum(t)))) {
      throw new TwoDParseError(`2D file: expected ${count} number(s) for ${what} on line ${at}`);
    }
    tokens.push(toks.slice(0, count));
    return toks.slice(0, count).map(toNum);
  };
  m.version = take(2, 'the version');
  const type = take(1, 'the suspension type')[0];
  if (type !== 1 && type !== 2) throw new TwoDParseError(`2D file: unknown suspension type ${type}`);
  m.type = type as TwoDType;
  const strut = m.type === 2;
  const g = take(strut ? 9 : 8, 'the general data');
  [m.track, m.kingpinAngle, m.kingpinOffset] = g;
  let k = 3;
  if (strut) m.damperAngle = g[k++];
  [m.camberBump, m.camberRebound, m.rcStatic, m.rcBump, m.rcRebound] = g.slice(k);
  m.lowerOuterZ = take(1, 'the lower outer height')[0];
  m.upperOuterZ = take(1, strut ? 'the strut top height' : 'the upper outer height')[0];
  const li = take(2, 'the lower inner point');
  m.lowerInner = [li[0], li[1]];
  if (!strut) {
    const ui = take(2, 'the upper inner point');
    m.upperInner = [ui[0], ui[1]];
  }
  [m.rollTravel, m.camberRoll, m.rcRoll, m.rcLateralRoll] = take(4, 'the roll data');
  m.tokens = tokens;
  m.extra = lines.slice(at);
  // Claudus' own trailing section for Free-solve results.
  const o = m.extra.indexOf('CLAUDUS OUTER');
  if (o >= 0 && m.extra[o + 1]) {
    const [lo, up] = m.extra[o + 1].trim().split(/\s+/).map(toNum);
    m.outerY = { ...(Number.isFinite(lo) ? { lower: lo } : {}), ...(Number.isFinite(up) ? { upper: up } : {}) };
    m.extra.splice(o, 2);
  }
  return m;
}

/** Fortran-style: whole numbers get a trailing point. */
const fmt = (v: number) => (Number.isInteger(v) ? `${v}.` : String(v));

export function writeTwoD(m: Model2D): string {
  const strut = m.type === 2;
  const rows: number[][] = [
    m.version,
    [m.type],
    strut
      ? [m.track, m.kingpinAngle, m.kingpinOffset, m.damperAngle, m.camberBump, m.camberRebound, m.rcStatic, m.rcBump, m.rcRebound]
      : [m.track, m.kingpinAngle, m.kingpinOffset, m.camberBump, m.camberRebound, m.rcStatic, m.rcBump, m.rcRebound],
    [m.lowerOuterZ],
    [m.upperOuterZ],
    m.lowerInner,
    ...(strut ? [] : [m.upperInner]),
    [m.rollTravel, m.camberRoll, m.rcRoll, m.rcLateralRoll],
  ];
  const lines = rows.map((r, i) =>
    r.map((v, j) => {
      const old = m.tokens[i]?.[j];
      return old !== undefined && toNum(old) === v ? old : fmt(v);
    }).join(' '),
  );
  lines.push(...m.extra);
  if (m.outerY && (m.outerY.lower !== undefined || m.outerY.upper !== undefined)) {
    lines.push('CLAUDUS OUTER', `${m.outerY.lower ?? 'NaN'} ${m.outerY.upper ?? 'NaN'}`);
  }
  return lines.join(m.eol) + m.eol;
}
