import { describe, expect, it } from 'vitest';
import { readDat, writeDat } from '../src/io/dat.js';
import { BODY_USER, bodyLines, formatPolys, parsePolys, parseStl } from '../src/model/extras.js';
import { newModel } from '../src/model/new.js';
import { addPointToTemplate, addSpringDamper, hasElement } from '../src/template/edit.js';
import { getTemplate } from '../src/template/registry.js';
import { dataPoints, GROUND } from '../src/template/types.js';
import { Corner } from '../src/solver/corner.js';
import { defaultOptimiserSettings } from '../src/optimise/optimiser.js';
import { autoscaleBars, barSum, coefficientBars, limitsToCurrent, unityBars } from '../src/compliance/analysis.js';
import { defaultCompliance } from '../src/compliance/types.js';

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

  it('edits polylines as text', () => {
    const l = [[[0, 0, 0], [1.5, 2, 3]], [[1, 1, 1], [2, 2, 2], [3, 3, 3]]] as [number, number, number][][];
    expect(parsePolys(formatPolys(l))).toEqual(l);
    expect(() => parsePolys('1 2')).toThrow(/Line 1/);
    expect(() => parsePolys('1 2 3', 3)).toThrow(/at least 3/);
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

describe('compliance coefficient bars', () => {
  it('saves bar limits, scales and weights in the Claudus section', () => {
    const m = newModel(1);
    m.compliance = defaultCompliance();
    m.compliance.bars = [[{ key: 'toe', limit: 0.1, weight: 2 }, { key: 'camber', scale: 0.5, weight: 1 }], undefined as never, []];
    const back = readDat(writeDat(m));
    expect(back.compliance?.bars?.[0]).toEqual(m.compliance.bars[0]);
    expect(back.compliance?.bars?.[2]).toEqual([]);
    expect(back.compliance?.bars?.[1]).toBeUndefined();
  });

  it('defaults to every variable and does the bulk edits', () => {
    const bars = coefficientBars(defaultCompliance(), 0);
    expect(bars).toHaveLength(9);
    const v = { toe: 0.2, camber: -0.4, castor: 0, kingpin: 0, wcX: 0, wcY: 0, wcZ: 0, tcpX: 0, tcpY: 0 };
    expect(limitsToCurrent(bars, v)[1].limit).toBe(-0.4);
    expect(autoscaleBars(bars, v, 1)[1].scale).toBeCloseTo(0.4);
    expect(autoscaleBars(bars, v)[2].scale).toBe(1);
    expect(unityBars(bars).every((b) => b.scale === 1)).toBe(true);
    expect(barSum(v, [{ key: 'toe', weight: 2 }, { key: 'camber', weight: 1 }])).toBeCloseTo(0.8);
  });
});
