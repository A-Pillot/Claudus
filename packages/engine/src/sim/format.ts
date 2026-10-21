// Low-level helpers for the Fortran-style fixed-column .sim text format.

export const SECTION_KEYWORDS = [
  'CYCLE', 'CYLINDER', 'FUEL', 'CSYS', 'BURN', 'HEAT', 'TEMPERATURE', 'PORTS', 'VALVES', 'PLENUMS', 'PIPES',
  'THROTTLE', 'COMPRESSORS', 'TURBINES', 'COOLER', 'INLETS', 'EXITS', 'LOSSJUNCTION', 'WIRES', 'VLINKS',
  'SBOUNDARIES', 'SHAFTS', 'DPROPERTIES', 'CONNECTIONS', 'LINKS', 'TESTS', 'LPOINT', 'TRANSIENTS', 'SENSORS',
  'TSENSORS', 'ACTUATORS', 'TPLOTS', 'CONTROLS', 'ICENGINES', 'SOLVER SETTINGS', 'USER ARGUMENTS', 'BUILDER',
];
const KEYWORD_SET = new Set(SECTION_KEYWORDS);

export const HEADER_KEY = 'HEADER';

/** Split text into lines (CR stripped). A trailing newline yields a final empty element. */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export interface SplitFile {
  header: string[];
  order: string[];
  sections: Record<string, string[]>;
}

/** Split a .sim file into the header (title lines + name line) and keyword sections (lines after the keyword). */
export function splitSections(text: string): SplitFile {
  const lines = splitLines(text);
  let first = lines.findIndex((l, i) => i >= 3 && KEYWORD_SET.has(l.trimEnd()));
  if (first < 0) first = lines.length;
  const header = lines.slice(0, first);
  const order: string[] = [];
  const sections: Record<string, string[]> = {};
  let cur: string | null = null;
  for (let i = first; i < lines.length; i++) {
    const l = lines[i];
    if (KEYWORD_SET.has(l.trimEnd()) && !(l.trimEnd() in sections)) {
      cur = l.trimEnd();
      order.push(cur);
      sections[cur] = [];
    } else if (cur) sections[cur].push(l);
  }
  return { header, order, sections };
}

export function tokens(line: string | undefined): string[] {
  return line ? line.trim().split(/\s+/).filter(Boolean) : [];
}
export function nums(line: string | undefined): number[] {
  return tokens(line).map(Number);
}
const NUMERIC_LINE = /^[\s+\-.\dEeDd]*$/;
export function isNumericLine(l: string): boolean {
  return l.trim().length > 0 && NUMERIC_LINE.test(l);
}

/** Split section lines into a header chunk and item blocks, each starting `pre` lines before a `$label` line. */
export function splitBlocks(lines: string[], pre = 0): { head: string[]; blocks: string[][] } {
  const idx: number[] = [];
  lines.forEach((l, i) => {
    if (l.startsWith('$')) idx.push(i - pre);
  });
  if (!idx.length) return { head: lines.slice(), blocks: [] };
  const head = lines.slice(0, Math.max(0, idx[0]));
  const blocks = idx.map((s, k) => lines.slice(Math.max(0, s), k + 1 < idx.length ? idx[k + 1] : lines.length));
  return { head, blocks };
}

// ---- number formatting -------------------------------------------------------------------------

export function pad(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}
export function fI(v: number, w = 5): string {
  return pad(String(Math.round(v)), w);
}
export function fF(v: number, w: number, d: number): string {
  let s = v.toFixed(d);
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  return pad(s, w);
}
/** Fortran-style 0.dddddE+xx. */
export function fE(v: number, w = 13, d = 6): string {
  if (!isFinite(v) || v === 0) return pad('0.' + '0'.repeat(d) + 'E+00', w);
  let e = Math.floor(Math.log10(Math.abs(v))) + 1;
  let m = v / Math.pow(10, e);
  if (Math.abs(+m.toFixed(d)) >= 1) {
    e += 1;
    m /= 10;
  }
  const es = (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
  return pad(m.toFixed(d) + 'E' + es, w);
}
/** Fortran G-like: 6 significant digits, E format for zero (as LES writes 0.000000E+00). */
export function fG6(v: number, w = 9): string {
  if (v === 0 || !isFinite(v)) return fE(0, w + 3);
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return fE(v, w + 3);
  return pad(v.toPrecision(6), w);
}
/** Unknown format: shortest decimal, right aligned. */
export function fLoose(v: number, w = 13): string {
  return pad(String(+v.toPrecision(10)), w);
}
/** Re-format a raw token using the decimals it had, keeping width. */
export function sameFormat(raw: string, v: number): string {
  const t = raw.trim();
  if (/[Ee]/.test(t)) return fE(v, raw.length);
  const dot = t.indexOf('.');
  return fF(v, raw.length, dot < 0 ? 0 : t.length - dot - 1);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
