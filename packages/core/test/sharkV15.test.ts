import { afterEach, describe, expect, it } from 'vitest';
import { readDat, writeDat } from '../src/io/dat.js';
import { isRebuiltTemplate, parseSharkTemplate } from '../src/io/sharkTemplate.js';
import { splitSections } from '../src/io/dat.js';
import { analyse } from '../src/results/derivatives.js';
import { getTemplate, registerTemplate, resetTemplates } from '../src/template/registry.js';
import { GenType, dataPoints } from '../src/template/types.js';
import { sample } from './helpers.js';

// A real SHARK 4.03 (VERSION 15) model saved as .shk: type 14 at both ends, each with 16 hard points and
// 6 part C of G points, the templates included as TEMP_SETTINGS, plus MODAL, FSETS, FORCED_DAMP and so on.
const FILE = 'final_config.shk';
const numbersOf = (t: string) => t.split(/\r?\n/).map((l) => l.trim().split(/\s+/).map((x) => (x !== '' && !isNaN(Number(x)) ? String(Number(x)) : x)).join(' '));

afterEach(() => resetTemplates());

describe('SHARK 4.03 file with part C of G points', () => {
  it('reads the C of G points as template points, not hard points', () => {
    const m = readDat(sample(FILE));
    expect(m.front?.points).toHaveLength(22);
    const t = m.templates?.find((x) => x.slot === 14)!;
    expect(isRebuiltTemplate(t)).toBe(true);
    const pts = dataPoints(t);
    expect(pts).toHaveLength(22);
    const cogs = pts.filter((p) => p.gen1 === GenType.PartCofG);
    expect(cogs.map((p) => p.no)).toEqual([22, 23, 24, 25, 26, 27]);
    expect(cogs.map((p) => p.part1)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cogs[0].label).toBe('Part 1 C of G');
  });

  it('solves both ends, with the same kinematics as without the C of G points', () => {
    const m = readDat(sample(FILE));
    m.templates?.forEach(registerTemplate);
    const res = analyse(m);
    expect(res).toHaveLength(2);
    const camber = res[0].bump.map((r) => r.camber);
    expect(camber.length).toBeGreaterThan(5);
    resetTemplates();
    const bare = structuredClone(m);
    bare.front!.points = bare.front!.points.slice(0, 16);
    bare.rear!.points = bare.rear!.points.slice(0, 16);
    delete bare.templates;
    const ref = analyse(bare);
    ref[0].bump.forEach((r, i) => expect(camber[i]).toBeCloseTo(r.camber, 9));
  });

  it('writes the file back with the same numbers in every section, and adds no Claudus template section', () => {
    const text = sample(FILE);
    const out = writeDat(readDat(text));
    expect(numbersOf(out)).toEqual(numbersOf(text));
    expect(out).not.toContain('USER TEMPLATES');
  });

  it('keeps sections that appear twice in their own order', () => {
    const s = splitSections(sample(FILE)).filter((x) => x.name === 'TEMP_SETTINGS');
    expect(s).toHaveLength(2);
    const t = parseSharkTemplate(s[0].lines)!;
    expect(t.slot).toBe(14);
    expect(t.parts).toHaveLength(6);
    expect(t.points).toHaveLength(22);
    expect(t.points[2]).toMatchObject({ no: 3, part1: 1, part2: 6, gen1: GenType.LowerBallJoint });
  });

  it('without TEMP_SETTINGS, takes the extra rows as one C of G per part', () => {
    const text = sample(FILE).replace(/TEMP_SETTINGS[\s\S]*?(?=EXTENDED_TYRE)/, '');
    const m = readDat(text);
    const pts = dataPoints(m.templates!.find((x) => x.slot === 14)!);
    expect(pts).toHaveLength(22);
    expect(pts.slice(16).every((p) => p.gen1 === GenType.PartCofG)).toBe(true);
  });

  it('a later file without C of G points goes back to the plain template', () => {
    const m = readDat(sample(FILE));
    m.templates?.forEach(registerTemplate);
    const plain = readDat(sample('type14.dat'));
    const t = plain.templates?.find((x) => x.slot === 14) ?? getTemplate(14);
    expect(dataPoints(t)).toHaveLength(plain.front!.points.length);
  });
});
