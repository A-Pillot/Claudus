/**
 * Hard point import and export (SHARK's File / Import Hard Points and File / Export Hard Points).
 *
 * Each template point carries label strings that say where it lives in the other program's file. Import reads
 * the values for those labels, applies the shift, scale and axis switch, and gives a preview that the caller
 * can apply. Export does the reverse into the text of an existing file, changing only the matched numbers.
 */
import { getTemplate } from '../template/registry.js';
import { dataPoints, type Template } from '../template/types.js';
import type { Vec3 } from '../math/vec3.js';
import type { End, Model, SuspensionData } from '../model/types.js';
import { DEFAULT_SIDE_WORDS, findRows, matchRow, rewriteRows, type FileFormat, type RowSide, type SideWords } from './hpFormat.js';
import { evalMathString, isMathString, MathStringError } from './hpMath.js';

export const NOT_DEFINED = 'Not Defined';
export const DERIVED = 'DERIVED';

/** The three label strings of every data point of a template (position, bush Z axis, bush X-Z plane). */
export interface LabelSet {
  point: string[];
  bushZ: string[];
  bushXZ: string[];
}

/** The text SHARK shows for a missing label. */
export const isUndefinedLabel = (s: string | undefined): boolean => !s || s.trim() === '' || /^not defined$/i.test(s.trim());
export const isDerivedLabel = (s: string): boolean => s.trim().toUpperCase() === DERIVED;

/**
 * A sensible Adams/Car style name for a template point, from its description. Names follow Adams/Car's
 * double wishbone and strut templates (lca_front, uca_outer, tierod_inner, strut_upper, wheel_center ...).
 * Points with no obvious counterpart get "Not Defined"; the user can edit every string.
 */
export function defaultPointLabel(description: string): string {
  const d = description.toLowerCase();
  const has = (re: RegExp) => re.test(d);
  if (has(/wheel centre/)) return 'wheel_center';
  if (has(/spindle|stub axle|knuckle centre/)) return DERIVED;
  if (has(/slider lower axis/)) return DERIVED;
  if (has(/track rod|steering (arm|link)/)) return has(/inner|inboard|to wishbone/) ? 'tierod_inner' : 'tierod_outer';
  if (has(/push rod/)) return has(/rocker/) ? 'pushrod_inner' : 'pushrod_outer';
  if (has(/rocker axis 1st/)) return 'rocker_axis_1';
  if (has(/rocker axis 2nd/)) return 'rocker_axis_2';
  if (has(/strut slider/)) return 'strut_lower';
  if (has(/strut top/)) return 'strut_upper';
  if (has(/damper|spring/)) {
    if (has(/rocker/)) return 'damper_rocker';
    if (has(/body|upper|top/)) return has(/pushrod|damper to body/) ? 'damper_body' : 'strut_upper';
    return 'strut_lower';
  }
  const arm = has(/upper/) ? 'uca' : has(/lower|wishbone/) ? 'lca' : undefined;
  if (arm && has(/wishbone|link|pivot|ball joint|arm/) && !has(/axle|rack/)) {
    const outer = has(/outer|outboard|ball joint/);
    if (outer && has(/front/)) return `${arm}_outer_front`;
    if (outer && has(/rear/)) return `${arm}_outer_rear`;
    if (has(/front/)) return `${arm}_front`;
    if (has(/rear/)) return `${arm}_rear`;
    if (outer) return `${arm}_outer`;
    if (has(/inner|inboard/)) return `${arm}_inner`;
  }
  return NOT_DEFINED;
}

/**
 * The label strings in force for a template: the template's own Adams labels where it has them, then any
 * saved overrides, then the defaults.
 */
export function labelsFor(t: Template, overrides?: Partial<LabelSet>): LabelSet {
  const pts = dataPoints(t);
  return {
    point: pts.map((p, i) => overrides?.point?.[i] ?? p.adamsLabel ?? defaultPointLabel(p.label)),
    bushZ: pts.map((_, i) => overrides?.bushZ?.[i] ?? NOT_DEFINED),
    bushXZ: pts.map((_, i) => overrides?.bushXZ?.[i] ?? NOT_DEFINED),
  };
}

// ---- shift, scale and switch -----------------------------------------------------------------------

export interface TransferSettings {
  /** Added on import, subtracted on export. mm. */
  shift: Vec3;
  /** Multiplier after the shift on import (divided out on export). */
  scale: Vec3;
  /** Axis switch: result axis i takes source axis switch[i] (0 = x, 1 = y, 2 = z). Identity by default. */
  switch: [number, number, number];
  /** Which side of the car the model's corner is on, so the right rows are read. */
  side: 'left' | 'right';
  /** What the file calls left, right and centre. */
  words: SideWords;
}

export const defaultTransfer = (): TransferSettings => ({
  shift: [0, 0, 0],
  scale: [1, 1, 1],
  switch: [0, 1, 2],
  side: 'right',
  words: { ...DEFAULT_SIDE_WORDS },
});

const validSwitch = (s: number[]) => s.length === 3 && [0, 1, 2].every((a) => s.includes(a));

/** File coordinates to model coordinates: shift, then scale, then switch. */
export function toModelCoords(p: Vec3, s: TransferSettings): Vec3 {
  if (!validSwitch(s.switch)) throw new Error('The axis switch must use x, y and z once each');
  const q = p.map((v, k) => (v + s.shift[k]) * s.scale[k]);
  return [q[s.switch[0]], q[s.switch[1]], q[s.switch[2]]];
}

/** Model coordinates to file coordinates: the reverse order, undoing the switch, then scale, then shift. */
export function toFileCoords(p: Vec3, s: TransferSettings): Vec3 {
  if (!validSwitch(s.switch)) throw new Error('The axis switch must use x, y and z once each');
  const q: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) q[s.switch[i]] = p[i];
  return q.map((v, k) => v / s.scale[k] - s.shift[k]) as Vec3;
}

// ---- plans ---------------------------------------------------------------------------------------------

export type RowStatus =
  | 'found' // the label was found in the file
  | 'maths' // a [formula] label, worked out from other points
  | 'derived' // DERIVED: not transferred
  | 'undefined' // no label
  | 'missing' // a label that the file does not contain
  | 'error'; // a formula that could not be worked out

export interface PlanRow {
  /** Index into the end's points. */
  index: number;
  /** Point number from the template. */
  no: number;
  name: string;
  label: string;
  status: RowStatus;
  /** What the model holds now (import) or what the file holds now (export), in model coordinates. */
  current: Vec3;
  /** What would be written: model values on import, file-side values converted to model coordinates on export. */
  next?: Vec3;
  /** True when the value would change. */
  changes: boolean;
  message?: string;
}

export interface TransferPlan {
  format: FileFormat;
  end: End;
  rows: PlanRow[];
  /** Number of rows that would change. */
  changed: number;
  /** Rows (label found twice, say) worth a warning. */
  notes: string[];
}

const TOL = 1e-6; // files hold six decimals
const same = (a: Vec3, b: Vec3) => a.every((v, k) => Math.abs(v - b[k]) <= TOL);

function context(model: Model, end: End, labels?: Partial<LabelSet>) {
  const data = model[end];
  if (!data) throw new Error(`The model has no ${end} suspension`);
  const t = getTemplate(data.templateSlot);
  return { data, t, pts: dataPoints(t), ls: labelsFor(t, labels) };
}

/** Which side of the file's car a template point is on: the far side of the axle for mirrored points. */
function pointSide(def: Vec3, s: TransferSettings): RowSide {
  const flip = def[1] < 0;
  return (s.side === 'right') !== flip ? 'right' : 'left';
}

/**
 * Two points whose labels match the same file row would both read it on import, and both write it on export,
 * the second over the first. Only the first point gets the row; this returns that point's number for a later one.
 */
function claim(claimed: Map<number, number>, line: number, no: number): number | undefined {
  const first = claimed.get(line);
  if (first === undefined) claimed.set(line, no);
  return first;
}

function sharedRow(first: number, label: string, notes: string[]): { status: 'error'; message: string } {
  const message = `Label "${label}" matches the same file row as point ${first}; not transferred`;
  notes.push(message);
  return { status: 'error', message };
}

/** Preview of an import: what each point would become. Nothing is changed. */
export function planImport(model: Model, end: End, fileText: string, format: FileFormat, settings: TransferSettings = defaultTransfer(), labels?: Partial<LabelSet>): TransferPlan {
  const { data, pts, ls } = context(model, end, labels);
  const rows = findRows(fileText, format, settings.words);
  const working: Vec3[] = data.points.map((p) => [...p] as Vec3);
  const out: PlanRow[] = [];
  const notes: string[] = [];
  const claimed = new Map<number, number>();
  pts.forEach((tp, i) => {
    const label = ls.point[i];
    const base = { index: i, no: tp.no, name: tp.label, label, current: data.points[i] };
    const done = (r: Omit<PlanRow, 'index' | 'no' | 'name' | 'label' | 'current' | 'changes'>): void => {
      const changes = r.next ? !same(r.next, data.points[i]) : false;
      if (r.next) working[i] = r.next;
      out.push({ ...base, ...r, changes });
    };
    if (isUndefinedLabel(label)) return done({ status: 'undefined' });
    if (isDerivedLabel(label)) return done({ status: 'derived' });
    if (isMathString(label)) {
      try {
        return done({ status: 'maths', next: evalMathString(label, (n) => working[n - 1]) });
      } catch (e) {
        return done({ status: 'error', message: e instanceof MathStringError ? e.message : String(e) });
      }
    }
    const row = matchRow(rows, label, pointSide(tp.def, settings));
    if (!row) return done({ status: 'missing' });
    const first = claim(claimed, row.line, tp.no);
    if (first !== undefined) return done(sharedRow(first, label, notes));
    done({ status: 'found', next: toModelCoords(row.value, settings) });
  });
  return { format, end, rows: out, changed: out.filter((r) => r.changes).length, notes };
}

/** Apply an import plan: a new model with the found and worked-out points replaced. */
export function applyImport(model: Model, plan: TransferPlan): Model {
  const data = model[plan.end] as SuspensionData;
  const points = data.points.map((p) => p);
  for (const r of plan.rows) if (r.next && (r.status === 'found' || r.status === 'maths')) points[r.index] = r.next;
  return { ...model, [plan.end]: { ...data, points } };
}

/** Preview of an export into an existing file's text. */
export function planExport(model: Model, end: End, fileText: string, format: FileFormat, settings: TransferSettings = defaultTransfer(), labels?: Partial<LabelSet>): TransferPlan {
  const { data, pts, ls } = context(model, end, labels);
  const rows = findRows(fileText, format, settings.words);
  const out: PlanRow[] = [];
  const notes: string[] = [];
  const claimed = new Map<number, number>();
  pts.forEach((tp, i) => {
    const label = ls.point[i];
    const base = { index: i, no: tp.no, name: tp.label, label, current: data.points[i] };
    if (isUndefinedLabel(label)) return void out.push({ ...base, status: 'undefined', changes: false });
    if (isDerivedLabel(label)) return void out.push({ ...base, status: 'derived', changes: false });
    // A formula point is worked out from other points, so there is no row of its own to write.
    if (isMathString(label)) return void out.push({ ...base, status: 'maths', changes: false, message: 'Worked out from other points, not written' });
    const row = matchRow(rows, label, pointSide(tp.def, settings));
    if (!row) return void out.push({ ...base, status: 'missing', changes: false });
    const first = claim(claimed, row.line, tp.no);
    if (first !== undefined) return void out.push({ ...base, changes: false, ...sharedRow(first, label, notes) });
    const inFile = toModelCoords(row.value, settings);
    out.push({ ...base, status: 'found', current: inFile, next: data.points[i], changes: !same(inFile, data.points[i]) });
  });
  return { format, end, rows: out, changed: out.filter((r) => r.changes).length, notes };
}

/** The file text with the model's values written over the matched rows. Everything else is untouched. */
export function applyExport(model: Model, plan: TransferPlan, fileText: string, settings: TransferSettings = defaultTransfer(), labels?: Partial<LabelSet>): string {
  const { ls, pts } = context(model, plan.end, labels);
  const found = findRows(fileText, plan.format, settings.words);
  const edits: { row: ReturnType<typeof matchRow> & object; value: Vec3 }[] = [];
  for (const r of plan.rows) {
    if (r.status !== 'found' || !r.changes || !r.next) continue;
    const row = matchRow(found, ls.point[r.index], pointSide(pts[r.index].def, settings));
    if (row) edits.push({ row, value: toFileCoords(r.next, settings) });
  }
  return rewriteRows(fileText, edits);
}
