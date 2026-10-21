import { describe, expect, it, afterEach } from 'vitest';
import { formatTemplates, parseTemplates, TemplateParseError } from '../src/template/file.js';
import { checkTemplate, normaliseTemplate, remapPoints } from '../src/template/check.js';
import { listTemplates, getTemplate, registerTemplate, resetTemplates, isCustomTemplate, nextFreeSlot, hasTemplate } from '../src/template/registry.js';
import { convertToAxle } from '../src/template/axle.js';
import { GROUND, GenType, NONE, dataPoints, type Template } from '../src/template/types.js';
import { newModel } from '../src/model/new.js';
import { readDat, writeDat } from '../src/io/dat.js';
import { Corner } from '../src/solver/corner.js';
import { sample } from './helpers.js';

const strip = (t: Template) => {
  const { source: _s, ...rest } = t;
  return JSON.parse(JSON.stringify(rest));
};

describe('template files', () => {
  afterEach(() => resetTemplates());

  it('writes and reads back every built-in template exactly', () => {
    const all = listTemplates();
    const back = parseTemplates(formatTemplates(all));
    expect(back).toHaveLength(all.length);
    back.forEach((t, i) => expect(strip(t)).toEqual(strip(all[i])));
    expect(back[0].source).toBe('user');
  });

  it('keeps quotes in labels', () => {
    const t = { ...getTemplate(1), slot: 40, label: "Driver's 'special'", parts: ["Lower 'A' arm", 'Upper wishbone', 'Track rod', 'Upright'] };
    const [back] = parseTemplates(formatTemplates([t]));
    expect(back.label).toBe(t.label);
    expect(back.parts[0]).toBe("Lower 'A' arm");
  });

  it('rejects broken text with a clear message', () => {
    expect(() => parseTemplates('VERSION\n 8 3')).toThrow(TemplateParseError);
    expect(() => parseTemplates('USER TEMPLATES\n 1\n 40 0 0 1 1 0\n')).toThrow(/ends early/);
  });

  it('saves templates inside a model file and reads them back', () => {
    const custom = { ...convertToAxle(getTemplate(1), { slot: 41 }), source: 'custom' as const };
    const m = { ...newModel(1), templates: [custom] };
    const text = writeDat(m);
    expect(text).toContain('USER TEMPLATES');
    const back = readDat(text);
    expect(back.templates).toHaveLength(1);
    expect(strip(back.templates![0])).toEqual(strip(custom));
    expect(writeDat(back)).toBe(text);
  });

  it('leaves files without templates unchanged', () => {
    const m = readDat(sample('type1.dat'));
    expect(m.templates).toBeUndefined();
    expect(writeDat(m)).not.toContain('USER TEMPLATES');
  });
});

describe('template checks', () => {
  afterEach(() => resetTemplates());

  it.each(listTemplates().map((t) => t.slot))('passes built-in type %i', (slot) => {
    const r = checkTemplate(getTemplate(slot));
    expect(r.errors).toEqual([]);
    expect(r.freedom!.free).toBe(r.wheels);
  });

  it('finds a part that can spin free', () => {
    // Type 1 with the track rod removed: the upright can steer by itself.
    const t1 = getTemplate(1);
    const t: Template = {
      ...t1,
      parts: t1.parts.filter((p) => p !== 'Track rod'),
      points: t1.points.filter((p) => p.no !== 11 && p.no !== 12).map((p) => ({ ...p, part1: p.part1 === 4 ? 3 : p.part1, part2: p.part2 === 4 ? 3 : p.part2 })),
    };
    const r = checkTemplate(t);
    expect(r.errors.join(' ')).toMatch(/extra free motion/);
  });

  it('finds a locked suspension', () => {
    // Tie the upright's track rod point to the body as well: nothing can move.
    const t1 = getTemplate(1);
    const t: Template = { ...t1, points: t1.points.map((p) => (p.no === 19 ? { ...p, part2: GROUND } : p)) };
    expect(checkTemplate(t).errors.join(' ')).toMatch(/locked/);
  });

  it('reports structural mistakes without solving', () => {
    const t1 = getTemplate(1);
    const t: Template = {
      ...t1,
      points: t1.points.map((p) => (p.no === 19 ? { ...p, gen1: GenType.None } : p.no === 5 ? { ...p, no: 6 } : p)),
    };
    const r = checkTemplate(t);
    expect(r.errors.join(' ')).toMatch(/wheel centre/);
    expect(r.errors.join(' ')).toMatch(/used twice/);
    expect(r.freedom).toBeUndefined();
  });

  it('numbers bushes and puts the body second when tidying', () => {
    const t1 = getTemplate(1);
    const messy: Template = { ...t1, points: t1.points.map((p) => ({ ...p, bush: 0, ...(p.part2 === GROUND ? { part1: GROUND, part2: p.part1 } : {}) })) };
    const tidy = normaliseTemplate(messy);
    expect(tidy.points.map((p) => [p.part1, p.part2, p.bush])).toEqual(t1.points.map((p) => [p.part1, p.part2, p.bush]));
    expect(tidy.fullAxle).toBeUndefined();
    expect(normaliseTemplate(convertToAxle(t1)).fullAxle).toBe(true);
  });

  it('carries points across a template change by number', () => {
    const t1 = getTemplate(1);
    const t2: Template = {
      ...t1,
      points: [...t1.points.filter((p) => p.no !== 8), { no: 30, label: 'New point', def: [1, 2, 3], part1: 1, part2: NONE, gen1: 0, gen2: 0 }],
    };
    const pts = dataPoints(t1).map((_, i) => [i, i, i] as [number, number, number]);
    const out = remapPoints(t1, t2, pts);
    expect(out).toHaveLength(dataPoints(t2).length);
    expect(out[0]).toEqual([0, 0, 0]);
    expect(out[6]).toEqual(pts[7]); // point 9 moved up one place
    expect(out[out.length - 1]).toEqual([1, 2, 3]);
  });
});

describe('template registry', () => {
  afterEach(() => resetTemplates());

  it('adds, replaces and restores templates', () => {
    expect(isCustomTemplate(1)).toBe(false);
    const slot = nextFreeSlot();
    expect(slot).toBe(30);
    registerTemplate({ ...getTemplate(1), slot, label: 'Mine' });
    expect(nextFreeSlot()).toBe(31);
    expect(isCustomTemplate(slot)).toBe(true);
    registerTemplate({ ...getTemplate(1), label: 'Edited type 1' });
    expect(isCustomTemplate(1)).toBe(true);
    // A model on a user template solves like any other.
    const c = new Corner({ templateSlot: slot, points: dataPoints(getTemplate(slot)).map((p) => p.def), rollingRadius: 225 }, 'front');
    expect(c.solve({ bump: 20 }).converged).toBe(true);
    resetTemplates();
    expect(hasTemplate(slot)).toBe(false);
    expect(getTemplate(1).label).not.toBe('Edited type 1');
  });
});
