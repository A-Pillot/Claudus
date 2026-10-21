/**
 * SHARK's Edit menu template tools: Convert Corner to Axle Model, Add Roll Bar to Model and Add Two Part
 * Rack to Model. Each takes a template and returns a new one; the input is never changed.
 */
import { mirrorY, type Vec3 } from '../math/vec3.js';
import { dummyPosition } from './define.js';
import { GenType, GROUND, NONE, PointType, findGen, type GraphicElement, type Template, type TemplatePoint } from './types.js';

/** Which general type a corner point's copy on the left-hand side takes. */
const SECOND_SIDE: Partial<Record<GenType, GenType>> = {
  [GenType.WheelCentre]: GenType.WheelCentre2,
  [GenType.StubAxle]: GenType.StubAxle2,
  [GenType.SteeringAttachment]: GenType.SteeringAttachment2,
  [GenType.Damper1ToSuspension]: GenType.Damper2ToSuspension,
  [GenType.Damper1ToBody]: GenType.Damper2ToBody,
  [GenType.Spring1ToSuspension]: GenType.Spring2ToSuspension,
  [GenType.Spring1ToBody]: GenType.Spring2ToBody,
  [GenType.UpperBallJoint]: GenType.UpperBallJoint2,
  [GenType.LowerBallJoint]: GenType.LowerBallJoint2,
  [GenType.StrutSliderPoint]: GenType.StrutSliderPoint2,
  [GenType.StrutEndPoint]: GenType.StrutEndPoint2,
};

const maxNo = (t: Template) => Math.max(...t.points.map((p) => p.no));
const maxBush = (t: Template) => Math.max(0, ...t.points.map((p) => p.bush ?? 0));
const isData = (p: TemplatePoint) => !p.dummy;

/** Data points first in their order, then dummy points, as every template keeps them. */
const ordered = (pts: TemplatePoint[]) => [...pts.filter(isData), ...pts.filter((p) => !isData(p))];

export interface ConvertOptions {
  /** Number for the first copied point. SHARK leaves room for the part C of G points (type 1 copies start at 24). */
  startNo?: number;
  slot?: number;
  label?: string;
}

/**
 * Edit / Convert Corner to Axle Model: copy every part and point to the left-hand side (mirrored in Y),
 * tag the copies as second-side points, and mark the template as a full axle.
 */
export function convertToAxle(t: Template, opts: ConvertOptions = {}): Template {
  if (t.fullAxle || findGen(t, GenType.WheelCentre2)) throw new Error('The template already models both sides');
  const nParts = t.parts.length;
  const bush0 = maxBush(t);
  const map = new Map<number, number>();
  let next = Math.max(opts.startNo ?? 0, maxNo(t) + 1);
  for (const p of t.points.filter(isData)) map.set(p.no, next++);
  for (const p of t.points.filter((q) => !isData(q))) map.set(p.no, next++);
  const part = (x: number) => (x > 0 ? x + nParts : x);
  const gen = (g: GenType) => SECOND_SIDE[g] ?? g;
  const copies: TemplatePoint[] = t.points.map((p) => ({
    ...p,
    no: map.get(p.no)!,
    label: `${p.label} (2)`,
    def: mirrorY(p.def),
    part1: part(p.part1),
    part2: part(p.part2),
    gen1: gen(p.gen1),
    gen2: gen(p.gen2),
    bush: p.bush ? p.bush + bush0 : 0,
    ...(p.dummy
      ? {
          dummy: {
            at: map.get(p.dummy.at)!,
            offset: p.dummy.offset,
            ...(p.dummy.dir ? { dir: [map.get(p.dummy.dir[0])!, map.get(p.dummy.dir[1])!] as [number, number] } : {}),
            ...(p.dummy.vec ? { vec: mirrorY(p.dummy.vec) } : {}),
          },
        }
      : {}),
  }));
  const graphics: GraphicElement[] = t.graphics.map((g) => ({ ...g, points: g.points.map((no) => map.get(no) ?? no) }));
  return {
    ...t,
    slot: opts.slot ?? t.slot,
    label: opts.label ?? `${t.label} (full axle)`,
    parts: [...t.parts, ...t.parts.map((l) => `${l} (2)`)],
    points: ordered([...t.points, ...copies]),
    graphics: [...t.graphics, ...graphics],
    fullAxle: true,
    source: 'custom',
  };
}

/** The part a point belongs to on the right-hand side of a full axle, by number. */
function partIndex(t: Template, part: number | string): number {
  const i = typeof part === 'number' ? part : t.parts.indexOf(part) + 1;
  if (i < 1 || i > t.parts.length) throw new Error(`Unknown part ${part}`);
  return i;
}

/** The left-hand copy of a right-hand part, found by the "(2)" label convertToAxle gives it. */
function mirrorPart(t: Template, part: number): number {
  const i = t.parts.indexOf(`${t.parts[part - 1]} (2)`) + 1;
  if (i < 1) throw new Error(`Part "${t.parts[part - 1]}" has no left-hand copy`);
  return i;
}

const point = (no: number, label: string, def: Vec3, part1: number, part2: number, gen: GenType, extra: Partial<TemplatePoint> = {}): TemplatePoint => ({
  no, label, def, part1, part2, gen1: gen, gen2: GenType.None, ...extra,
});

/** Give every point that joins two parts (or a part and ground) a bush number, keeping existing ones. */
function numberBushes(points: TemplatePoint[]): TemplatePoint[] {
  let b = Math.max(0, ...points.map((p) => p.bush ?? 0));
  return points.map((p) => (p.part2 !== NONE && !p.bush ? { ...p, bush: ++b } : p));
}

export interface RollBarOptions {
  /** Right-hand part the drop link attaches to (1-based index or label), e.g. the lower wishbone. */
  part: number | string;
  /** Drop link to suspension point, right-hand side. */
  link: Vec3;
  /** Bar end (drop link to bar), right-hand side. */
  barEnd: Vec3;
  /** Bar mount to body, right-hand side. The bar turns about the line through both mounts. */
  mount: Vec3;
  startNo?: number;
}

/**
 * Edit / Add Roll Bar to Model: a bar in two halves, each turning in its body mounts, with drop links to a
 * suspension part on each side. The halves meet at a revolute on the centre line; in compliance its bush
 * stiffness is the bar's torsional rate, so in kinematics the halves turn freely.
 */
export function addRollBar(t: Template, o: RollBarOptions): Template {
  if (!t.fullAxle) throw new Error('A roll bar needs a full-axle template (use Convert Corner to Axle first)');
  const right = partIndex(t, o.part);
  const left = mirrorPart(t, right);
  const n = t.parts.length;
  const [dl1, dl2, bar1, bar2] = [n + 1, n + 2, n + 3, n + 4];
  let no = Math.max(o.startNo ?? 0, maxNo(t) + 1);
  const [a1, a2, l1, l2, m1, m2, rev] = [no++, no++, no++, no++, no++, no++, no++];
  const [d1, d2] = [no++, no++];
  const centre: Vec3 = [o.mount[0], 0, o.mount[2]];
  const added: TemplatePoint[] = [
    point(a1, 'Roll bar attachment 1', o.barEnd, bar1, dl1, GenType.RollBarBarAttachment),
    point(a2, 'Roll bar attachment 2', mirrorY(o.barEnd), bar2, dl2, GenType.RollBarBarAttachment),
    point(l1, 'Roll bar to link 1', o.link, right, dl1, GenType.RollBarLinkAttachment),
    point(l2, 'Roll bar to link 2', mirrorY(o.link), left, dl2, GenType.RollBarLinkAttachment2),
    point(m1, 'Roll bar mount 1', o.mount, bar1, GROUND, GenType.RollBarAxisPoint),
    point(m2, 'Roll bar mount 2', mirrorY(o.mount), bar2, GROUND, GenType.RollBarAxisPoint),
    point(rev, 'Roll bar revolute', centre, bar1, bar2, GenType.RollBarRevolute),
    // Second points on the bar axis make each mount a revolute.
    point(d1, 'Roll bar axis 1', [0, 0, 0], bar1, GROUND, GenType.None, { dummy: { at: m1, dir: [m1, m2], offset: 100 }, pointType: PointType.DummyAxis }),
    point(d2, 'Roll bar axis 2', [0, 0, 0], bar2, GROUND, GenType.None, { dummy: { at: m2, dir: [m2, m1], offset: 100 }, pointType: PointType.DummyAxis }),
  ];
  added[7].def = dummyPosition(o.mount, o.mount, mirrorY(o.mount), 100);
  added[8].def = dummyPosition(mirrorY(o.mount), mirrorY(o.mount), o.mount, 100);
  const graphics: GraphicElement[] = [
    { kind: 'tube', points: [a1, l1], props: [8, 0, 0] },
    { kind: 'tube', points: [a2, l2], props: [8, 0, 0] },
    { kind: 'tube', points: [a1, m1], props: [12, 0, 0] },
    { kind: 'tube', points: [m1, rev], props: [12, 0, 0] },
    { kind: 'tube', points: [a2, m2], props: [12, 0, 0] },
    { kind: 'tube', points: [m2, rev], props: [12, 0, 0] },
  ];
  return {
    ...t,
    parts: [...t.parts, 'Drop link 1', 'Drop link 2', 'Roll bar 1', 'Roll bar 2'],
    points: numberBushes(ordered([...t.points, ...added])),
    graphics: [...t.graphics, ...graphics],
    source: 'custom',
  };
}

export interface RackOptions {
  /** Right-hand end of the rack link (where it slides in the housing). */
  link: Vec3;
  /** Right-hand housing mount to the body. Defaults to the link point. */
  mount?: Vec3;
  startNo?: number;
}

/**
 * Edit / Add Two Part Rack to Model: the inner track rod joints move from the body onto a rack link, which
 * slides in a rack housing mounted to the body. In kinematics the housing is fixed and the link moves with
 * the rack; in compliance the four new bushes let both move.
 */
export function addTwoPartRack(t: Template, o: RackOptions): Template {
  if (!t.fullAxle) throw new Error('A two-part rack needs a full-axle template (use Convert Corner to Axle first)');
  const s1 = findGen(t, GenType.SteeringAttachment);
  const s2 = findGen(t, GenType.SteeringAttachment2);
  if (!s1 || !s2) throw new Error('The template needs steering attachment points on both sides');
  const n = t.parts.length;
  const [link, housing] = [n + 1, n + 2];
  let no = Math.max(o.startNo ?? 0, maxNo(t) + 1);
  const [p1, p2, m1, m2] = [no++, no++, no++, no++];
  const mount = o.mount ?? o.link;
  // The steering attachments leave the body for the rack link.
  const moved = t.points.map((p) => {
    if (p !== s1 && p !== s2) return p;
    const parts = [p.part1, p.part2].filter((x) => x !== NONE).map((x) => (x === GROUND ? link : x)).sort((a, b) => a - b);
    return { ...p, part1: parts[0], part2: parts[1] ?? NONE };
  });
  const added: TemplatePoint[] = [
    point(p1, 'Rack link P1', o.link, link, housing, GenType.RackLateralMount),
    point(p2, 'Rack link P2', mirrorY(o.link), link, housing, GenType.RackLateralMount),
    point(m1, 'Rack mount P1', mount, housing, GROUND, GenType.RackMount),
    point(m2, 'Rack mount P2', mirrorY(mount), housing, GROUND, GenType.RackMount),
  ];
  const graphics: GraphicElement[] = [
    { kind: 'tube', points: [p1, p2], props: [12, 0, 0] },
    { kind: 'line', points: [p1, s1.no] },
    { kind: 'line', points: [p2, s2.no] },
    { kind: 'cylinder', points: [m1, m2], props: [25, 0, 0] },
  ];
  return {
    ...t,
    parts: [...t.parts, 'Rack link', 'Rack housing'],
    points: numberBushes(ordered([...moved, ...added])),
    graphics: [...t.graphics, ...graphics],
    source: 'custom',
  };
}

/**
 * Convert Corner to Axle for a model: the converted template plus the model's points, with the left side
 * set to the mirror image of the model's own right-hand points (not the template defaults).
 */
export function convertPointsToAxle(t: Template, points: Vec3[], opts: ConvertOptions = {}): { template: Template; points: Vec3[] } {
  const template = convertToAxle(t, opts);
  const data = points.slice(0, t.points.filter(isData).length);
  return { template, points: [...data, ...data.map(mirrorY)] };
}
