import { describe, expect, it } from 'vitest';
import { listTemplates } from '../src/template/registry.js';
import { GROUND, dataPoints } from '../src/template/types.js';
import { hasSample, sampleModel } from './helpers.js';

describe('built-in templates', () => {
  const withSamples = listTemplates().filter((t) => hasSample(`type${t.slot}.dat`));

  it.each(withSamples.map((t) => [t.slot, t] as const))('type %i defaults match the SHARK sample file', (slot, t) => {
    const m = sampleModel(`type${slot}.dat`);
    const s = m.front ?? m.rear!;
    const pts = dataPoints(t);
    expect(s.templateSlot).toBe(slot);
    // Older files can stop short of the points later SHARK versions added (type 12 has 15 of 17).
    if (slot === 12) expect(s.points).toHaveLength(15);
    else expect(s.points).toHaveLength(pts.length);
    s.points.forEach((q, i) => pts[i].def.forEach((v, k) => expect(q[k]).toBeCloseTo(v, 2)));
  });

  it.each(listTemplates().map((t) => [t.slot, t] as const))('type %i has a moving upright tied to ground', (_slot, t) => {
    expect(t.points.some((p) => p.part2 === GROUND)).toBe(true);
    expect(t.parts.length).toBeGreaterThan(0);
  });
});
