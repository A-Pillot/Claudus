/**
 * Reader and writer for SHARK 3D model files (.dat).
 *
 * The format is plain text in Fortran list-directed style: a section name on its own line, followed by
 * whitespace-separated numbers. Sections Claudus does not interpret yet are kept verbatim, so a file
 * read and written back keeps everything SHARK put in it.
 */
import type { Vec3 } from '../math/vec3.js';
import { parseTemplateLines, templateLines } from '../template/file.js';
import { getTemplate } from '../template/registry.js';
import { dataPoints, type Template } from '../template/types.js';
import {
  CLAUDUS_COMPLIANCE_SECTION, claudusComplianceLines, complianceLines, parseClaudusCompliance, parseCompliance, type PointOrder,
} from '../compliance/io.js';
import { defaultCompliance, type ComplianceData } from '../compliance/types.js';
import { combinedLines, extendedBumpLines, parseCombined, parseExtendedBump } from '../model/combined.js';
import { limitsLines, parseLimits } from '../model/limits.js';
import { parseSteering, steeringLines } from '../model/steering.js';
import { defaultParams, type Model, type PointGroup, type RawSection, type SuspensionData, type VehicleParams } from '../model/types.js';

export const KNOWN_SECTIONS = [
  'VERSION', 'PARAMETERS', 'FRONT SUSPENSION', 'REAR SUSPENSION', 'TOLERANCES', 'TITLES', 'TYRE', 'BODY',
  'FORMULA', 'ROLL SOLUTION', 'GROUPS', 'COMPLIANCE', 'FORCES', 'FSETS', 'RAVEN_DEFAULTS', 'EXTENDED BUMP',
  'COMBINED', 'USER LINES', 'USER TEMPLATES', 'CLAUDUS COMPLIANCE', 'CLAUDUS LIMITS', 'CLAUDUS STEERING', 'CLAUDUS COMBINED', 'CLAUDUS EXTENDED BUMP',
] as const;

const PARSED = new Set(['VERSION', 'PARAMETERS', 'FRONT SUSPENSION', 'REAR SUSPENSION', 'TOLERANCES', 'TITLES', 'TYRE', 'ROLL SOLUTION', 'GROUPS', 'USER TEMPLATES', 'CLAUDUS COMPLIANCE', 'CLAUDUS LIMITS', 'CLAUDUS STEERING', 'CLAUDUS COMBINED', 'CLAUDUS EXTENDED BUMP']);

const nums = (line: string | undefined): number[] =>
  (line ?? '').trim() === '' ? [] : (line as string).trim().split(/[\s,]+/).map((s) => Number(s.replace(/[dD]/, 'E')));

export class DatParseError extends Error {}

/** Split file text into named sections. */
export function splitSections(text: string): RawSection[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const known = new Set<string>(KNOWN_SECTIONS);
  const out: RawSection[] = [];
  let cur: RawSection | undefined;
  for (const line of lines) {
    const t = line.trim();
    if (known.has(t)) {
      cur = { name: t, lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
    else if (t !== '') throw new DatParseError(`Unexpected text before the first section: "${t}"`);
  }
  // drop trailing blank lines in each section
  for (const s of out) while (s.lines.length && s.lines[s.lines.length - 1].trim() === '') s.lines.pop();
  return out;
}

function parseParams(lines: string[]): VehicleParams {
  const p = defaultParams();
  const l = lines.map(nums);
  [p.bumpTravel, p.reboundTravel, p.bumpIncrement] = l[0] ?? [];
  [p.rollAngle, p.rollIncrement] = l[1] ?? [];
  [p.steerTravel, p.steerIncrement] = l[2] ?? [];
  [p.wheelbase, p.cogHeight, p.brakeFrontPct, p.driveFrontPct] = l[3] ?? [];
  [p.weightFrontPct] = l[4] ?? [];
  const b = l[5] ?? [2, 2, 2, 2];
  p.frontBrakeType = b[0];
  p.rearBrakeType = b[1];
  p.brakeLineExtra = [b[2] ?? 2, b[3] ?? 2];
  const s = l[6] ?? [1, 1, 1, 1];
  p.frontSuspensionType = s[0];
  p.rearSuspensionType = s[1];
  p.suspLineExtra = [s[2] ?? 1, s[3] ?? 1];
  for (const [k, v] of Object.entries(p)) if (typeof v === 'number' && !Number.isFinite(v)) throw new DatParseError(`Bad PARAMETERS value for ${k}`);
  return p;
}

function parseSuspension(lines: string[]): SuspensionData {
  const rows = lines.map(nums).filter((r) => r.length > 0);
  if (rows.length < 2) throw new DatParseError('Suspension section is too short');
  const templateSlot = rows[0][0];
  const points: Vec3[] = [];
  let rollingRadius = NaN;
  for (const r of rows.slice(1)) {
    if (r.length >= 3) points.push([r[0], r[1], r[2]]);
    else {
      rollingRadius = r[0];
      break;
    }
  }
  if (!Number.isFinite(rollingRadius)) throw new DatParseError('Suspension section has no rolling radius');
  return { templateSlot, points, rollingRadius };
}

function parseGroups(lines: string[]): PointGroup[] {
  let i = 0;
  const n = nums(lines[i++])[0] ?? 0;
  const groups: PointGroup[] = [];
  for (let g = 0; g < n; g++) {
    const label = (lines[i++] ?? '').trim();
    const count = nums(lines[i++])[0] ?? 0;
    const members = [];
    for (let k = 0; k < count; k++) {
      const [point, end] = nums(lines[i++]);
      members.push({ point, end });
    }
    groups.push({ label, members });
  }
  return groups;
}

export function readDat(text: string): Model {
  const sections = splitSections(text);
  const get = (name: string) => sections.find((s) => s.name === name);
  const version = get('VERSION');
  const params = get('PARAMETERS');
  if (!version || !params) throw new DatParseError('Not a SHARK 3D data file (missing VERSION or PARAMETERS)');
  const fr = get('FRONT SUSPENSION');
  const re = get('REAR SUSPENSION');
  const titles = get('TITLES');
  const titleCount = titles ? nums(titles.lines[0])[0] ?? 0 : 0;
  const templates = get('USER TEMPLATES') ? parseTemplateLines(get('USER TEMPLATES')!.lines, 'file') : undefined;
  const front = fr && fr.lines.some((l) => l.trim()) ? parseSuspension(fr.lines) : undefined;
  const rear = re && re.lines.some((l) => l.trim()) ? parseSuspension(re.lines) : undefined;
  const compliance = readCompliance(get('COMPLIANCE')?.lines, get(CLAUDUS_COMPLIANCE_SECTION)?.lines, pointOrder({ front, rear, templates }));
  // SHARK's COMBINED and EXTENDED BUMP stay in `raw` and are never rewritten (their layout is not known for
  // sure). Claudus's own sections win when present; otherwise our best-guess parse of SHARK's shows the data.
  const combined = parseCombined(get('CLAUDUS COMBINED')?.lines) ?? parseCombined(get('COMBINED')?.lines);
  const extendedBump = parseExtendedBump(get('CLAUDUS EXTENDED BUMP')?.lines) ?? parseExtendedBump(get('EXTENDED BUMP')?.lines);
  const limits = parseLimits(get('CLAUDUS LIMITS')?.lines);
  const steering = parseSteering(get('CLAUDUS STEERING')?.lines);
  return {
    version: nums(version.lines[0]),
    versionExtra: version.lines.slice(1),
    params: parseParams(params.lines),
    front,
    rear,
    tolerances: get('TOLERANCES')?.lines.flatMap(nums) ?? [],
    titles: titles ? titles.lines.slice(1, 1 + titleCount) : [],
    tyreWidths: get('TYRE')?.lines.flatMap(nums) ?? [150, 150, 150, 150],
    rollSolution: nums(get('ROLL SOLUTION')?.lines[0])[0] ?? 1,
    groups: get('GROUPS') ? parseGroups(get('GROUPS')!.lines) : [],
    ...(combined ? { combined } : {}),
    ...(extendedBump ? { extendedBump } : {}),
    ...(limits ? { limits } : {}),
    ...(steering ? { steering } : {}),
    ...(templates ? { templates } : {}),
    ...(compliance ? { compliance } : {}),
    sectionOrder: sections.map((s) => s.name),
    raw: sections.filter((s) => !PARSED.has(s.name)),
  };
}

// ---- compliance ----------------------------------------------------------------------------------

/** Compliance data exactly as read from SHARK's section, so an unedited file writes back unchanged. */
const pristine = new WeakMap<ComplianceData, string>();

function templateFor(slot: number, own?: Template[]): Template | undefined {
  try {
    return own?.find((t) => t.slot === slot) ?? getTemplate(slot);
  } catch {
    return undefined;
  }
}

/** Each end's data point numbers in file order, which SHARK's compliance indexes refer to. */
function pointOrder(m: Pick<Model, 'front' | 'rear' | 'templates'>): PointOrder {
  const order: PointOrder = {};
  for (const end of ['front', 'rear'] as const) {
    const s = m[end];
    const t = s && templateFor(s.templateSlot, m.templates);
    if (t) order[end] = dataPoints(t).map((p) => p.no);
  }
  return order;
}

function readCompliance(shark: string[] | undefined, claudus: string[] | undefined, order: PointOrder): ComplianceData | undefined {
  if (!shark && !claudus) return undefined;
  let data = defaultCompliance();
  try {
    if (shark) data = parseCompliance(shark, order, data);
  } catch {
    // Keep the raw section and fall back to defaults if the layout is not what we expect.
  }
  if (claudus) data = parseClaudusCompliance(claudus, data);
  else pristine.set(data, JSON.stringify(data));
  return data;
}

/** True when the compliance data still matches what came from the file's own COMPLIANCE section. */
const unedited = (c: ComplianceData) => pristine.get(c) === JSON.stringify(c);

function positions(m: Model, order: PointOrder) {
  const out: { front?: Map<number, Vec3>; rear?: Map<number, Vec3> } = {};
  for (const end of ['front', 'rear'] as const) {
    const s = m[end];
    const nos = order[end];
    if (s && nos) out[end] = new Map(nos.map((no, i) => [no, s.points[i]]));
  }
  return out;
}

// ---- writing -------------------------------------------------------------------------------------

const int = (v: number) => String(Math.round(v)).padStart(13);
/** Shortest text that reads back to exactly the same number, padded like SHARK's columns. */
const numText = (v: number) => {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return v.toFixed(1);
  const s = String(v);
  return s.includes('e') ? v.toExponential().toUpperCase() : s;
};
const real = (v: number) => numText(v).padStart(27);
const realShort = (v: number) => numText(v).padStart(16);

function writeSuspension(s: SuspensionData): string[] {
  return [int(s.templateSlot), ...s.points.map((p) => p.map(real).join('')), real(s.rollingRadius)];
}

export function writeDat(m: Model): string {
  const out: string[] = [];
  const p = m.params;
  const order = [...m.sectionOrder];
  const ensure = (name: string, after: string) => {
    if (!order.includes(name)) order.splice(order.indexOf(after) + 1, 0, name);
  };
  if (!order.includes('VERSION')) order.unshift('VERSION');
  ensure('PARAMETERS', 'VERSION');
  if (m.front) ensure('FRONT SUSPENSION', 'PARAMETERS');
  if (m.rear) ensure('REAR SUSPENSION', m.front ? 'FRONT SUSPENSION' : 'PARAMETERS');
  if (m.templates?.length && !order.includes('USER TEMPLATES')) order.push('USER TEMPLATES');
  // Edited profiles go to Claudus-only sections; a profile that is just what SHARK's section holds needs none.
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const sharkC = parseCombined(m.raw.find((r) => r.name === 'COMBINED')?.lines);
  const sharkE = parseExtendedBump(m.raw.find((r) => r.name === 'EXTENDED BUMP')?.lines);
  const writeC = !!m.combined && !same(m.combined, sharkC);
  const writeE = !!m.extendedBump && !same(m.extendedBump, sharkE);
  if (writeC && !order.includes('CLAUDUS COMBINED')) order.push('CLAUDUS COMBINED');
  if (writeE && !order.includes('CLAUDUS EXTENDED BUMP')) order.push('CLAUDUS EXTENDED BUMP');
  if (m.limits && !order.includes('CLAUDUS LIMITS')) order.push('CLAUDUS LIMITS');
  if (m.steering && !order.includes('CLAUDUS STEERING')) order.push('CLAUDUS STEERING');
  const c = m.compliance;
  if (c && !order.includes('COMPLIANCE')) order.push('COMPLIANCE');
  if (c && !unedited(c) && !order.includes(CLAUDUS_COMPLIANCE_SECTION)) order.splice(order.indexOf('COMPLIANCE') + 1, 0, CLAUDUS_COMPLIANCE_SECTION);
  for (const name of order) {
    const body: string[] = [];
    switch (name) {
      case 'VERSION':
        body.push(m.version.map(int).join(''), ...m.versionExtra);
        break;
      case 'PARAMETERS':
        body.push(
          [p.bumpTravel, p.reboundTravel, p.bumpIncrement].map(realShort).join(''),
          [p.rollAngle, p.rollIncrement].map(realShort).join(''),
          [p.steerTravel, p.steerIncrement].map(realShort).join(''),
          [p.wheelbase, p.cogHeight, p.brakeFrontPct, p.driveFrontPct].map(real).join(''),
          real(p.weightFrontPct),
          [p.frontBrakeType, p.rearBrakeType, ...p.brakeLineExtra].map(int).join(''),
          [p.frontSuspensionType, p.rearSuspensionType, ...p.suspLineExtra].map(int).join(''),
        );
        break;
      case 'FRONT SUSPENSION':
        if (!m.front) continue;
        body.push(...writeSuspension(m.front));
        break;
      case 'REAR SUSPENSION':
        if (!m.rear) continue;
        body.push(...writeSuspension(m.rear));
        break;
      case 'TOLERANCES':
        body.push(m.tolerances.map(real).join(''));
        break;
      case 'TITLES':
        body.push(int(m.titles.length), ...m.titles);
        break;
      case 'TYRE':
        body.push(m.tyreWidths.map(real).join(''));
        break;
      case 'ROLL SOLUTION':
        body.push(int(m.rollSolution));
        break;
      case 'USER TEMPLATES':
        if (!m.templates?.length) continue;
        body.push(...templateLines(m.templates));
        break;
      case 'COMPLIANCE': {
        const raw = m.raw.find((r) => r.name === name);
        if (c && !(raw && unedited(c))) {
          const po = pointOrder(m);
          body.push(...complianceLines(c, po, positions(m, po)));
        } else if (raw) body.push(...raw.lines);
        else continue;
        break;
      }
      case CLAUDUS_COMPLIANCE_SECTION:
        if (!c || unedited(c)) continue;
        body.push(...claudusComplianceLines(c));
        break;
      case 'CLAUDUS COMBINED':
        if (!writeC) continue;
        body.push(...combinedLines(m.combined!));
        break;
      case 'CLAUDUS EXTENDED BUMP':
        if (!writeE) continue;
        body.push(...extendedBumpLines(m.extendedBump!));
        break;
      case 'CLAUDUS STEERING':
        if (!m.steering) continue;
        body.push(...steeringLines(m.steering));
        break;
      case 'CLAUDUS LIMITS':
        if (!m.limits) continue;
        body.push(...limitsLines(m.limits));
        break;
      case 'GROUPS':
        body.push(int(m.groups.length));
        for (const g of m.groups) {
          body.push(g.label, int(g.members.length));
          for (const mm of g.members) body.push(int(mm.point) + int(mm.end));
        }
        break;
      default: {
        const raw = m.raw.find((r) => r.name === name);
        if (!raw) continue;
        body.push(...raw.lines);
      }
    }
    out.push(name, ...body);
  }
  return out.join('\r\n') + '\r\n';
}
