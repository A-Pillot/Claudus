import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readDat, writeDat } from '../src/io/dat.js';
import { SAMPLES, sample } from './helpers.js';

// The 2D samples have their own reader and tests (twod.test.ts).
const files = readdirSync(SAMPLES).filter((f) => f.endsWith('.dat') && !f.endsWith('_2d.dat'));

describe('SHARK .dat files', () => {
  it.each(files)('%s round-trips through write and read', (f) => {
    const m = readDat(sample(f));
    const again = readDat(writeDat(m));
    expect(again).toEqual(m);
  });

  it('reads the parameters and points of type1.dat', () => {
    const m = readDat(sample('type1.dat'));
    expect(m.version).toEqual([3, 3]);
    expect(m.params.bumpTravel).toBe(60);
    expect(m.params.wheelbase).toBe(2240);
    expect(m.params.weightFrontPct).toBe(40);
    expect(m.front?.templateSlot).toBe(1);
    expect(m.front?.points).toHaveLength(14);
    expect(m.front?.points[0]).toEqual([3819, 313, 225.600006104]);
    expect(m.front?.rollingRadius).toBe(225);
    expect(m.rear).toBeUndefined();
    expect(m.groups[0].label).toBe('Points 1,2 and 3 (front)');
    expect(m.groups[0].members).toHaveLength(3);
  });

  it('keeps sections it does not interpret', () => {
    const m = readDat(sample('Tutorial3.dat'));
    expect(m.raw.map((r) => r.name)).toEqual(['COMPLIANCE', 'FORCES', 'FSETS', 'RAVEN_DEFAULTS']);
    const out = writeDat(m);
    for (const r of m.raw) for (const line of r.lines) expect(out).toContain(line);
    expect(m.versionExtra.map((s) => s.trim())).toEqual(['1']);
  });

  it('reads files with both ends', () => {
    const m = readDat(sample('Tutorial 2b.dat'));
    expect(m.front?.templateSlot).toBe(1);
    expect(m.rear?.templateSlot).toBe(1);
  });
});

describe('new models', () => {
  it('builds a model from template defaults that writes and reads back', async () => {
    const { newModel } = await import('../src/model/new.js');
    const m = newModel(14);
    expect(m.front?.points).toHaveLength(16);
    expect(m.rear).toBeUndefined();
    expect(readDat(writeDat(m))).toEqual(m);
  });
});

describe('long numbers', () => {
  it('never run into each other', () => {
    const m = readDat(sample('type1.dat'));
    m.params = { ...m.params, bumpTravel: 60.00000000000001, reboundTravel: 60.00000000000001, bumpIncrement: 0.1 + 0.2 };
    const back = readDat(writeDat(m));
    expect(back.params.bumpTravel).toBe(60.00000000000001);
    expect(back.params.bumpIncrement).toBe(0.1 + 0.2);
  });
});
