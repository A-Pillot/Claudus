import { describe, expect, it } from 'vitest';
import { readDat, writeDat } from '../src/io/dat.js';
import { BODY_USER, bodyLines, parseStl } from '../src/model/extras.js';
import { newModel } from '../src/model/new.js';
import { addPointToTemplate, addSpringDamper, hasElement } from '../src/template/edit.js';
import { getTemplate } from '../src/template/registry.js';
import { dataPoints, GROUND } from '../src/template/types.js';
import { Corner } from '../src/solver/corner.js';
import { defaultOptimiserSettings } from '../src/optimise/optimiser.js';

describe('Claudus-only model data', () => {
  it('writes body and optimiser data in their own sections and reads them back', () => {
    const m = newModel(1);
    m.body = { type: BODY_USER, lines: [[[0, 0, 0], [100, 0, 0]]], facets: [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]] };
    m.optimiser = { parameters: [], settings: defaultOptimiserSettings(), targets: [] };
    const text = writeDat(m);
    expect(text).toContain('CLAUDUS BODY');
    expect(text).toContain('CLAUDUS OPTIMISER');
    const back = readDat(text);
    expect(back.body).toEqual(m.body);
    expect(back.optimiser).toEqual(m.optimiser);
    expect(writeDat(newModel(1))).not.toContain('CLAUDUS BODY');
  });

  it('draws internal bodies and user facet edges', () => {
    expect(bodyLines({ type: 1, lines: [], facets: [] }).length).toBeGreaterThan(3);
    expect(bodyLines({ type: 0, lines: [], facets: [] })).toEqual([]);
    expect(bodyLines({ type: BODY_USER, lines: [], facets: [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]] })[0]).toHaveLength(4);
  });

  it('reads ASCII STL', () => {
    const f = parseStl('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid');
    expect(f).toEqual([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
  });
});

describe('template edits', () => {
  it('adds a point to the body and the suspension still builds', () => {
    const t = getTemplate(1);
    const m = newModel(1);
    const r = addPointToTemplate(t, m.front!.points, { label: 'Extra', part: GROUND, pos: [10, 20, 30] });
    expect(dataPoints(r.template)).toHaveLength(dataPoints(t).length + 1);
    expect(r.points).toHaveLength(dataPoints(t).length + 1);
    expect(r.points[r.points.length - 1]).toEqual([10, 20, 30]);
    expect(() => new Corner({ ...m.front!, points: r.points }, 'front', r.template)).not.toThrow();
  });

  it('refuses a spring or damper that exists and adds one that does not', () => {
    const t = getTemplate(1);
    const nos = dataPoints(t).map((p) => p.no);
    expect(hasElement(t, 'damper1')).toBe(true);
    expect(() => addSpringDamper(t, 'damper1', nos[0], nos[1])).toThrow(/already exists/);
    expect(hasElement(t, 'spring2')).toBe(false);
    const r = addSpringDamper(t, 'spring2', nos[0], nos[1]);
    expect(hasElement(r, 'spring2')).toBe(true);
  });
});
