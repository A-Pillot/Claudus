/**
 * Finding and rewriting hard point rows in text files.
 *
 * Both of SHARK's hard point formats work by "text recognition strings": a point's label string is looked up in
 * the file, and the three numbers after it are its x, y and z. This module does the looking up and the in-place
 * rewriting; it knows nothing about templates.
 *
 * - Adams subsystem (.sub): the rows of the `[HARDPOINT]` block, as written by Adams/Car:
 *       {symmetry   hardpoint_name        x_value   y_value   z_value}
 *       'left'      'lca_front'          -130.0     -400.0     -90.0
 *   The symmetry column is optional (older files put the side in the name instead, `hpl_lca_front`,
 *   `hpr_lca_front`, `hps_tierod_inner`). The side is left, right or single (on the centre line).
 * - User 'A' format: SHARK never documented it, so Claudus defines a plain one. Any line holding a label
 *   followed by three numbers is a row, anywhere in the file:
 *       lca_front   -130.0  -400.0  -90.0
 *       lca_front = -130.0, -400.0, -90.0
 *   Lines starting with `#`, `!`, `$` or `;` are comments. Labels with spaces can be quoted.
 */

export type FileFormat = 'adams' | 'usera';
export type RowSide = 'left' | 'right' | 'single';

/** One hard point row found in a file. */
export interface HpRow {
  /** 0-based line number. */
  line: number;
  /** The name as written, without quotes. */
  name: string;
  /** The name with any hpl_/hpr_/hps_ prefix removed. */
  bare: string;
  /** Side from the symmetry column or the name prefix; undefined when the file does not say. */
  side?: RowSide;
  value: [number, number, number];
  /** Where the three number tokens sit in the line, for rewriting in place. */
  spans: [number, number][];
}

/** The words a file uses for left, right and centre. SHARK keeps these in its general label strings. */
export interface SideWords {
  left: string;
  right: string;
  single: string;
}

export const DEFAULT_SIDE_WORDS: SideWords = { left: 'left', right: 'right', single: 'single' };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/;
const toNumber = (s: string) => Number(s.replace(/[dD]/, 'E'));
const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2');

/** Index of the line after the `[HARDPOINT]` header and the line the block ends on. */
function adamsBlock(lines: string[]): [number, number] | undefined {
  const start = lines.findIndex((l) => /^\s*\[\s*HARDPOINT\s*\]/i.test(l));
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start + 1, end];
}

/** Every hard point row in the text. */
export function findRows(text: string, format: FileFormat, words: SideWords = DEFAULT_SIDE_WORDS): HpRow[] {
  const lines = text.split(/\r?\n/);
  const block = format === 'adams' ? adamsBlock(lines) : undefined;
  const [from, to] = block ?? [0, lines.length];
  const sideOf = (tok: string): RowSide | undefined => {
    const t = tok.toLowerCase();
    return t === words.left.toLowerCase() ? 'left' : t === words.right.toLowerCase() ? 'right' : t === words.single.toLowerCase() ? 'single' : undefined;
  };
  const rows: HpRow[] = [];
  for (let li = from; li < to; li++) {
    const line = lines[li];
    const trimmed = line.trim();
    if (trimmed === '' || /^[#!$;{]/.test(trimmed)) continue;
    const toks = [...line.matchAll(/'[^']*'|"[^"]*"|[^\s,=]+/g)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
    // The row is the name followed by exactly three numbers (a symmetry word may come before the name).
    for (let j = 1; j + 2 < toks.length; j++) {
      const nums = toks.slice(j, j + 3);
      if (!nums.every((t) => NUMBER.test(t.text))) continue;
      if (NUMBER.test(toks[j - 1].text)) continue;
      const name = unquote(toks[j - 1].text);
      let side: RowSide | undefined = j >= 2 ? sideOf(unquote(toks[j - 2].text)) : undefined;
      let bare = name;
      const m = /^hp([lrs])_(.*)$/i.exec(name);
      if (m) {
        bare = m[2];
        side ??= m[1].toLowerCase() === 'l' ? 'left' : m[1].toLowerCase() === 'r' ? 'right' : 'single';
      }
      rows.push({ line: li, name, bare, side, value: nums.map((t) => toNumber(t.text)) as HpRow['value'], spans: nums.map((t) => [t.start, t.end] as [number, number]) });
      break;
    }
  }
  return rows;
}

/**
 * The row for a label on a given side. A row whose side is stated and different is skipped; a row with no
 * stated side or "single" matches either side. An exact side match beats a sideless one.
 */
export function matchRow(rows: HpRow[], label: string, side: RowSide): HpRow | undefined {
  const want = label.trim().toLowerCase();
  if (!want) return undefined;
  const hits = rows.filter((r) => r.name.toLowerCase() === want || r.bare.toLowerCase() === want);
  const exact = hits.find((r) => r.side === side);
  if (exact) return exact;
  return hits.find((r) => r.side === undefined || r.side === 'single');
}

/** Number text for writing back: up to six decimals, no trailing zeros, always a decimal point. */
export function formatCoord(v: number): string {
  const s = String(Number(v.toFixed(6)));
  return s.includes('.') || s.includes('e') ? s : s + '.0';
}

/** Rewrite the three numbers of each row in place; everything else in the file stays as it was. */
export function rewriteRows(text: string, edits: { row: HpRow; value: [number, number, number] }[]): string {
  const lines = text.split(/(\r?\n)/); // keeps the line endings as odd entries
  const done = new Set<number>();
  for (const { row, value } of edits) {
    // The spans describe the original line, so a line is rewritten once only.
    if (done.has(row.line)) continue;
    done.add(row.line);
    const i = row.line * 2;
    let s = lines[i];
    // Replace from the last number backwards so earlier spans stay valid.
    for (let k = 2; k >= 0; k--) s = s.slice(0, row.spans[k][0]) + formatCoord(value[k]) + s.slice(row.spans[k][1]);
    lines[i] = s;
  }
  return lines.join('');
}
