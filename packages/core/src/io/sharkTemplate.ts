/**
 * SHARK's own template records inside a model file (TEMP_SETTINGS), and the part C of G points newer SHARK
 * versions (VERSION 15) store with each suspension.
 *
 * A TEMP_SETTINGS section, as written by SHARK 4.03 (decoded from a real file):
 *
 *   <slot>
 *   <template label>
 *   <parts> <points> <bushes> <graphic elements> <n>
 *   <part label>                                       one line per part
 *   then for each point, nine lines:
 *   <point label>
 *   <five more text strings>                           Adams / user format search strings, or 'Not Defined'
 *   <x> <y> <z>                                        template default position
 *   <no> <point type> <part1> <part2> <bush> <ref a> <ref b> <ref c> <n>
 *   <n> <n> <gen1> <gen2> <n> <n> <n>
 *   then a few trailing lines (not used here).
 *
 * The suspension sections then hold one row per template point, in this order. For the built-in templates,
 * SHARK 4.03 adds one "Part n C of G" point per part after the kinematic points, so a type 14 model has
 * 16 kinematic points and 6 C of G points.
 */
import type { Vec3 } from '../math/vec3.js';
import { GenType, GROUND, NONE, dataPoints, type Template, type TemplatePoint } from '../template/types.js';

export interface SharkTemplatePoint {
  no: number;
  label: string;
  def: Vec3;
  pointType: number;
  part1: number;
  part2: number;
  gen1: number;
  gen2: number;
}

export interface SharkTemplate {
  slot: number;
  label: string;
  parts: string[];
  points: SharkTemplatePoint[];
}

const nums = (line: string | undefined): number[] =>
  (line ?? '').trim() === '' ? [] : (line as string).trim().split(/\s+/).map((s) => Number(s.replace(/[dD]/, 'E')));

/** Read one TEMP_SETTINGS section body. Returns undefined when the layout is not the one described above. */
export function parseSharkTemplate(lines: string[]): SharkTemplate | undefined {
  const l = lines.map((s) => s.replace(/\r$/, ''));
  let i = 0;
  const slot = nums(l[i++])[0];
  const label = (l[i++] ?? '').trim();
  const [nParts, nPoints] = nums(l[i++]);
  if (!Number.isInteger(slot) || !Number.isInteger(nParts) || !Number.isInteger(nPoints) || nParts < 1 || nPoints < 1) return undefined;
  const parts = l.slice(i, i + nParts).map((s) => s.trim());
  i += nParts;
  const points: SharkTemplatePoint[] = [];
  for (let k = 0; k < nPoints; k++) {
    const name = (l[i] ?? '').trim();
    const xyz = nums(l[i + 6]);
    const a = nums(l[i + 7]);
    const b = nums(l[i + 8]);
    if (xyz.length < 3 || a.length < 4 || b.length < 4 || [...xyz, ...a, ...b].some((v) => !Number.isFinite(v))) return undefined;
    points.push({ no: a[0], label: name, def: [xyz[0], xyz[1], xyz[2]], pointType: a[1], part1: a[2], part2: a[3], gen1: b[2], gen2: b[3] });
    i += 9;
  }
  return { slot, label, parts, points };
}

/**
 * The template a suspension section needs when it has more rows than the template's data points: the
 * template with the extra points (part C of G points) added, so every row has a place and is written back.
 * Uses the file's own TEMP_SETTINGS record for the slot when it has one with the right number of points;
 * otherwise takes the extra rows as one C of G point per part, SHARK's convention for its built-in templates.
 * Returns undefined when the template already fits.
 */
export function templateWithExtraPoints(base: Template, rows: Vec3[], file?: SharkTemplate): Template | undefined {
  const data = dataPoints(base);
  if (rows.length <= data.length) return undefined;
  const dummies = base.points.filter((p) => p.dummy);
  const byNo = new Map(data.map((p) => [p.no, p]));
  let points: TemplatePoint[];
  if (file && file.points.length === rows.length && data.every((p) => file.points.some((f) => f.no === p.no))) {
    // The file's order, with Claudus' own definition for each point it knows.
    points = file.points.map((f) => byNo.get(f.no) ?? extraPoint(f, base.parts.length));
  } else {
    const extra = rows.length - data.length;
    const perPart = extra === base.parts.length;
    let no = Math.max(0, ...base.points.map((p) => p.no));
    const added = rows.slice(data.length).map((r, k): TemplatePoint => ({
      no: ++no,
      label: perPart ? `Part ${k + 1} C of G` : `Extra point ${k + 1}`,
      def: [...r] as Vec3,
      part1: perPart ? k + 1 : GROUND,
      part2: NONE,
      gen1: perPart ? GenType.PartCofG : GenType.None,
      gen2: GenType.None,
    }));
    points = [...data, ...added];
  }
  const t: Template = { ...base, points: [...points, ...dummies], source: 'file' };
  rebuilt.set(t, rebuilt.get(base) ?? base);
  return t;
}

const rebuilt = new WeakMap<Template, Template>();
/**
 * True for a template made by templateWithExtraPoints and not edited since. It is rebuilt from the rows each
 * time the file is read, so it need not be saved in the file (which keeps the file as SHARK wrote it).
 */
export const isRebuiltTemplate = (t: Template): boolean => rebuilt.has(t);
/** The template a rebuilt one was made from (the template itself when it was not rebuilt). */
export const baseTemplate = (t: Template): Template => rebuilt.get(t) ?? t;

function extraPoint(f: SharkTemplatePoint, nParts: number): TemplatePoint {
  const part = (p: number) => (p === GROUND || (p >= 1 && p <= nParts) ? p : NONE);
  const part1 = part(f.part1) || GROUND;
  return {
    no: f.no,
    label: f.label || `Point ${f.no}`,
    def: [...f.def] as Vec3,
    part1,
    part2: part(f.part2) === part1 ? NONE : part(f.part2),
    gen1: (f.gen1 in GenType ? f.gen1 : 0) as GenType,
    gen2: (f.gen2 in GenType ? f.gen2 : 0) as GenType,
    pointType: f.pointType,
  };
}
