import { describe, expect, it } from 'vitest';
import { buildElement, closestOnLines, ELEMENT_OPTIONS, elementShape, measureColumns, measureValues, optionOf, type PointAt } from '../src/graphics/elements.js';
import { bumpSweep, rollSweep } from '../src/results/derivatives.js';
import { Corner } from '../src/solver/corner.js';
import { newSuspension } from '../src/model/new.js';
import { defaultParams } from '../src/model/types.js';
import { getTemplate } from '../src/template/registry.js';
import { findGen, GenType, GROUND, type GraphicElement, type Template } from '../src/template/types.js';
import { formatTemplates, parseTemplateLines } from '../src/template/file.js';
import type { Vec3 } from '../src/math/vec3.js';

const at = (pts: Record<number, Vec3>): PointAt => (no) => pts[no];
const el = (kind: GraphicElement['kind'], points: number[], props?: number[]): GraphicElement => ({ kind, points, props });
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('measurement elements', () => {
  const P = at({ 1: [0, 0, 0], 2: [3, 4, 12], 3: [10, 0, 0], 4: [0, 5, 0], 5: [0, 0, 3], 6: [0, 1, 3], 7: [0, 0, 2], 8: [1, 0, 2], 9: [0, 1, 2], 10: [5, 5, 7] });
  const m = (g: GraphicElement) => {
    const s = elementShape(g, P);
    if (s?.type !== 'measure') throw new Error('not a measurement');
    return s;
  };

  it('point to point distance and components', () => {
    expect(m(el('distance', [1, 2])).value).toBeCloseTo(13, 9);
    near(m(el('components', [1, 2], [0])).comps!, [3, 4, 12]);
  });
  it('point to line: perpendicular distance, vector from the point to the line', () => {
    const s = m(el('components', [4, 1, 3], [1]));
    expect(s.value).toBeCloseTo(5, 9);
    near(s.comps!, [0, -5, 0]);
  });
  it('line to line: minimum normal distance between skew lines', () => {
    // The X axis, and a line along Y at height 3.
    const s = m(el('distance', [1, 3, 5, 6], [2]));
    expect(s.value).toBeCloseTo(3, 9);
    near(s.to, [0, 0, 3]);
  });
  it('parallel lines fall back to the point-line distance', () => {
    const [a, b] = closestOnLines([0, 0, 0], [1, 0, 0], [0, 2, 0], [1, 2, 0]);
    near(a, [0, 0, 0]);
    near(b, [0, 2, 0]);
  });
  it('point to plane: normal distance', () => {
    const s = m(el('distance', [10, 7, 8, 9], [3]));
    expect(s.value).toBeCloseTo(5, 9);
    near(s.comps!, [0, 0, -5]);
  });
  it('three point angle with the vertex in the middle', () => {
    const Q = at({ 1: [1, 0, 0], 2: [0, 0, 0], 3: [0, 1, 0], 4: [1, 1, 0] });
    const a = elementShape(el('angle', [1, 2, 3]), Q);
    expect(a?.type === 'measure' && a.value).toBeCloseTo(90, 9);
    const b = elementShape(el('angle', [1, 2, 4]), Q);
    expect(b?.type === 'measure' && b.value).toBeCloseTo(45, 9);
  });
});

describe('element geometry', () => {
  it('circle through three points', () => {
    const s = elementShape(el('circle', [1, 2, 3]), at({ 1: [3, 1, 5], 2: [2, 2, 5], 3: [1, 1, 5] }));
    if (s?.type !== 'circle') throw new Error('no circle');
    near(s.centre, [2, 1, 5]);
    expect(s.radius).toBeCloseTo(1, 9);
    expect(Math.abs(s.normal[2])).toBeCloseTo(1, 9);
  });
  it('circle about an axis and circle from centre, point and plane point', () => {
    const P = at({ 1: [0, 3, 0], 2: [0, 0, 0], 3: [0, 0, 1], 4: [4, 0, 0] });
    const a = elementShape(el('circle', [1, 2, 3], [3]), P);
    if (a?.type !== 'circle') throw new Error('no circle');
    near(a.centre, [0, 0, 0]);
    expect(a.radius).toBeCloseTo(3, 9);
    near(a.normal, [0, 0, 1]);
    const b = elementShape(el('circle', [2, 4, 1], [2]), P);
    if (b?.type !== 'circle') throw new Error('no circle');
    expect(b.radius).toBeCloseTo(4, 9);
    near(b.normal.map(Math.abs), [0, 0, 1]);
  });
  it('spheres: through four points, by diameter, by radius', () => {
    const P = at({ 1: [3, 2, 3], 2: [-1, 2, 3], 3: [1, 4, 3], 4: [1, 2, 5] });
    const s = elementShape(el('sphere', [1, 2, 3, 4], [3]), P);
    if (s?.type !== 'sphere') throw new Error('no sphere');
    near(s.centre, [1, 2, 3]);
    expect(s.radius).toBeCloseTo(2, 9);
    const d = elementShape(el('sphere', [1, 2], [2]), P);
    if (d?.type !== 'sphere') throw new Error('no sphere');
    near(d.centre, [1, 2, 3]);
    expect(d.radius).toBeCloseTo(2, 9);
    expect(elementShape(el('sphere', [1], [1, 7]), P)).toMatchObject({ type: 'sphere', radius: 7 });
  });
  it('lines in axis directions are clipped to the global length', () => {
    const s = elementShape(el('line', [1], [3]), at({ 1: [1, 2, 3] }));
    if (s?.type !== 'segments') throw new Error('no line');
    near(s.segments[0][0], [1, -998, 3]);
    near(s.segments[0][1], [1, 1002, 3]);
  });
  it('line normal to a plane', () => {
    const s = elementShape(el('line', [1, 2, 3, 4], [5]), at({ 1: [5, 5, 5], 2: [0, 0, 0], 3: [1, 0, 0], 4: [0, 1, 0] }));
    if (s?.type !== 'segments') throw new Error('no line');
    expect(s.segments[0][0][0]).toBeCloseTo(5, 9);
    expect(s.segments[0][1][2] - s.segments[0][0][2]).toBeCloseTo(2000, 9);
  });
  it('planes: X-Z plane has a Y normal; 3-point plane is centred on the triangle', () => {
    const xz = elementShape(el('plane', [1], [2]), at({ 1: [1, 2, 3] }));
    if (xz?.type !== 'plane') throw new Error('no plane');
    expect(Math.abs(xz.u[1])).toBeCloseTo(0, 9);
    expect(Math.abs(xz.v[1])).toBeCloseTo(0, 9);
    const p3 = elementShape(el('plane', [1, 2, 3]), at({ 1: [0, 0, 0], 2: [3, 0, 0], 3: [0, 3, 0] }));
    if (p3?.type !== 'plane') throw new Error('no plane');
    near(p3.centre, [1, 1, 0]);
  });
  it('facets, tubes, pivots and cylinders', () => {
    const P = at({ 1: [0, 0, 0], 2: [1, 0, 0], 3: [0, 1, 0], 4: [0, 0, 1] });
    expect(elementShape(el('facet3', [1, 2, 3]), P)).toMatchObject({ type: 'facet' });
    expect(elementShape(el('facet4', [1, 2, 3, 4]), P)).toMatchObject({ type: 'facet' });
    expect(elementShape(el('pivot', [1, 2]), P)).toMatchObject({ type: 'pivot' });
    expect(elementShape(el('tube', [1, 2]), P)).toMatchObject({ type: 'segments', style: 'tube' });
    const c = elementShape(el('cylinder', [1, 1, 4], [0, 10, 50]), P);
    if (c?.type !== 'cylinder') throw new Error('no cylinder');
    near(c.b, [0, 0, 50]);
    expect(c.radius).toBe(10);
  });
  it('degenerate or missing points give no shape', () => {
    expect(elementShape(el('circle', [1, 1, 1]), at({ 1: [0, 0, 0] }))).toBeUndefined();
    expect(elementShape(el('line', [1, 99]), at({ 1: [0, 0, 0] }))).toBeUndefined();
  });
  it('every menu option builds an element that draws from its default numbers', () => {
    const P = at({ 1: [0, 0, 0], 2: [10, 0, 0], 3: [0, 10, 0], 4: [0, 0, 10], 5: [3, 4, 5] });
    for (const o of ELEMENT_OPTIONS) {
      const g = buildElement(o, [1, 2, 3, 4, 5].slice(0, o.points));
      expect(optionOf(g)).toBe(o);
      expect(elementShape(g, P), o.name).toBeDefined();
    }
  });
});

describe('measurements in the sweeps', () => {
  const base = getTemplate(1);
  const wc = findGen(base, GenType.WheelCentre)!.no;
  const body = base.points.find((p) => p.part1 === GROUND && p.no !== wc)!.no;
  const n0 = base.graphics.length;
  const t: Template = {
    ...base,
    graphics: [...base.graphics, el('distance', [wc, body]), el('components', [wc, body], [0]), el('angle', [wc, body, base.points[2].no])],
  };
  const c = new Corner(newSuspension(1), 'front', t);

  it('lists a column per measurement', () => {
    expect(measureColumns(t).map((k) => k.key)).toEqual([`g${n0}`, `g${n0 + 1}`, `g${n0 + 1}x`, `g${n0 + 1}y`, `g${n0 + 1}z`, `g${n0 + 2}`]);
    expect(measureColumns(base)).toEqual([]);
  });
  it('bump sweep carries the distance against bump', () => {
    const rows = bumpSweep(c, defaultParams(), [-30, 0, 30]);
    for (const r of rows) {
      const st = c.solve({ bump: r.bump });
      const direct = measureValues(t, (no) => st.points[c.mech.index.get(no)!]);
      expect(r.measures![`g${n0}`]).toBeCloseTo(direct[`g${n0}`], 6);
    }
    expect(rows[0].measures![`g${n0}`]).not.toBeCloseTo(rows[2].measures![`g${n0}`], 1);
    // The components add up to the total.
    const m = rows[1].measures!;
    expect(Math.hypot(m[`g${n0 + 1}x`], m[`g${n0 + 1}y`], m[`g${n0 + 1}z`])).toBeCloseTo(m[`g${n0 + 1}`], 9);
  });
  it('roll sweep carries them too, and templates without measurements add nothing', () => {
    expect(rollSweep(c, defaultParams(), [0])[0].measures).toBeDefined();
    const plain = new Corner(newSuspension(1), 'front');
    expect(bumpSweep(plain, defaultParams(), [0])[0].measures).toBeUndefined();
  });
  it('element props survive the template file', () => {
    const back = parseTemplateLines(formatTemplates([{ ...t, slot: 90 }]).split(/\r?\n/).slice(1))[0];
    expect(back.graphics.slice(-3).map((g) => [g.kind, g.props ?? null])).toEqual([['distance', null], ['components', [0]], ['angle', null]]);
  });
});
