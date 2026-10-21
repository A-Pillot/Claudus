/**
 * Template text format, used for user template files (SHARK's `_User_Templates.Dat` and "Save Custom
 * Templates") and for templates saved inside a model file (Setup / Include User Templates In Data Files).
 *
 * SHARK compiled the format into the executable and shipped no example, so Claudus defines its own in the
 * same plain-text, column style as the model files. A file holds a `USER TEMPLATES` section:
 *
 *   USER TEMPLATES
 *   <number of templates>
 *   then for each template:
 *   <slot> <full axle 0/1> <rigid axle 0/1> <parts> <points> <graphics>
 *   '<template label>'
 *   '<part label>'                                           one line per part, upright last
 *   <no> <x> <y> <z> <part1> <part2> <gen1> <gen2> <bush> <point type>
 *        <dummy kind> <at> <a> <b> <offset> <vx> <vy> <vz> '<label>'      one line per point
 *   <kind> <n> <points...> <m> <props...> <colour>          one line per graphic element
 *
 * Part numbers are 1-based, -1 is the body and 0 is none. Dummy kind is 0 for a data point, 1 for a dummy
 * placed along the line from point a to point b, and 2 for one placed along the vector (vx, vy, vz).
 * Labels are quoted with single quotes, doubled inside a label ('Driver''s side').
 */
import type { Vec3 } from '../math/vec3.js';
import { PointType, type GraphicElement, type GraphicKind, type Template, type TemplatePoint } from './types.js';

const KINDS: GraphicKind[] = ['line', 'pivot', 'tube', 'cylinder', 'circle', 'sphere', 'facet3', 'facet4', 'plane', 'distance', 'components', 'angle'];

export const TEMPLATES_SECTION = 'USER TEMPLATES';

export class TemplateParseError extends Error {}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
// A leading space keeps fields apart even when a value (a colour, say) is wider than the column.
const int = (v: number) => ' ' + String(Math.round(v)).padStart(5);
const num = (v: number) => {
  const s = Number.isInteger(v) ? v.toFixed(1) : String(v);
  return ' ' + s.padStart(13);
};

/** The lines of a USER TEMPLATES section body (without the section name). */
export function templateLines(templates: Template[]): string[] {
  const out = [int(templates.length)];
  for (const t of templates) {
    out.push([t.slot, t.fullAxle ? 1 : 0, t.rigidAxle ? 1 : 0, t.parts.length, t.points.length, t.graphics.length].map(int).join(''));
    out.push(quote(t.label));
    for (const p of t.parts) out.push(quote(p));
    for (const p of t.points) {
      const d = p.dummy;
      const kind = !d ? 0 : d.dir ? 1 : 2;
      const dummy = [kind, d?.at ?? 0, d?.dir?.[0] ?? 0, d?.dir?.[1] ?? 0].map(int).join('') +
        [d?.offset ?? 0, ...(d?.vec ?? [0, 0, 0])].map(num).join('');
      out.push(
        int(p.no) + p.def.map(num).join('') +
          [p.part1, p.part2, p.gen1, p.gen2, p.bush ?? 0, p.pointType ?? (d ? PointType.DummyAxis : 0)].map(int).join('') +
          dummy + '  ' + quote(p.label),
      );
    }
    for (const g of t.graphics) {
      const props = g.props ?? [];
      out.push([KINDS.indexOf(g.kind) + 1, g.points.length, ...g.points, props.length].map(int).join('') + props.map(num).join('') + int(g.colour ?? 0));
    }
  }
  return out;
}

/** A complete templates file. */
export function formatTemplates(templates: Template[]): string {
  return [TEMPLATES_SECTION, ...templateLines(templates), ''].join('\r\n');
}

/** Read the body of a USER TEMPLATES section. */
export function parseTemplateLines(lines: string[], source: Template['source'] = 'user'): Template[] {
  const rows = lines.map((l) => l.replace(/\r/g, '')).filter((l) => l.trim() !== '');
  let i = 0;
  const line = (what: string) => {
    if (i >= rows.length) throw new TemplateParseError(`Templates text ends early (expected ${what})`);
    return rows[i++];
  };
  const ints = (l: string, what: string) => {
    const v = l.trim().split(/\s+/).map(Number);
    if (v.some((x) => !Number.isFinite(x))) throw new TemplateParseError(`Bad number in ${what}: "${l.trim()}"`);
    return v;
  };
  /** A line of numbers followed by a quoted label. */
  const labelled = (l: string, what: string): [number[], string] => {
    const q = l.indexOf("'");
    if (q < 0) throw new TemplateParseError(`Missing quoted label in ${what}: "${l.trim()}"`);
    return [q > 0 && l.slice(0, q).trim() ? ints(l.slice(0, q), what) : [], unquote(l.slice(q), what)];
  };
  const [count] = ints(line('the number of templates'), 'the template count');
  const out: Template[] = [];
  for (let k = 0; k < count; k++) {
    const [slot, full, rigid, nParts, nPoints, nGraphics] = ints(line('a template header'), 'a template header');
    if (nGraphics === undefined) throw new TemplateParseError(`Template header needs six numbers`);
    const label = labelled(line('the template label'), `template ${slot}`)[1];
    const parts = Array.from({ length: nParts }, () => labelled(line('a part label'), `template ${slot} parts`)[1]);
    const points: TemplatePoint[] = Array.from({ length: nPoints }, () => {
      const [v, pl] = labelled(line('a point'), `template ${slot} points`);
      if (v.length < 18) throw new TemplateParseError(`Template ${slot} point line needs 18 numbers: "${pl}"`);
      const [no, x, y, z, part1, part2, gen1, gen2, bush, pointType, kind, at, a, b, offset, vx, vy, vz] = v;
      const p: TemplatePoint = { no, label: pl, def: [x, y, z], part1, part2, gen1, gen2, bush };
      if (pointType) p.pointType = pointType;
      if (kind === 1) p.dummy = { at, dir: [a, b], offset };
      if (kind === 2) p.dummy = { at, vec: [vx, vy, vz] as Vec3, offset };
      return p;
    });
    const graphics: GraphicElement[] = Array.from({ length: nGraphics }, () => {
      const v = ints(line('a graphic element'), `template ${slot} graphics`);
      const kind = KINDS[v[0] - 1];
      if (!kind) throw new TemplateParseError(`Template ${slot}: unknown graphic element kind ${v[0]}`);
      const n = v[1];
      const pts = v.slice(2, 2 + n);
      const m = v[2 + n] ?? 0;
      const props = v.slice(3 + n, 3 + n + m);
      const g: GraphicElement = { kind, points: pts };
      if (m) g.props = props;
      const colour = v[3 + n + m];
      if (colour) g.colour = colour;
      return g;
    });
    const t: Template = { slot, label, parts, points, graphics, source };
    if (full) t.fullAxle = true;
    if (rigid) t.rigidAxle = true;
    out.push(t);
  }
  return out;
}

/** Read a templates file (a USER TEMPLATES section, as written by formatTemplates). */
export function parseTemplates(text: string, source: Template['source'] = 'user'): Template[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.trim() === TEMPLATES_SECTION);
  if (start < 0) throw new TemplateParseError(`Not a templates file (no ${TEMPLATES_SECTION} section)`);
  return parseTemplateLines(lines.slice(start + 1), source);
}

function unquote(s: string, what: string): string {
  const t = s.trim();
  if (!t.startsWith("'") || !t.endsWith("'") || t.length < 2) throw new TemplateParseError(`Bad quoted label in ${what}: ${t}`);
  return t.slice(1, -1).replace(/''/g, "'");
}
