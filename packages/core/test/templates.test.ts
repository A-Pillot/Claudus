import { describe, expect, it } from 'vitest';
import { listTemplates } from '../src/template/registry.js';
import { GROUND } from '../src/template/types.js';
import { sampleModel } from './helpers.js';

describe('built-in templates', () => {
  it.each(listTemplates().map((t) => [t.slot, t] as const))('type %i defaults match the SHARK sample file', (slot, t) => {
    const m = sampleModel(`type${slot}.dat`);
    const s = m.front ?? m.rear!;
    expect(s.templateSlot).toBe(slot);
    expect(s.points).toHaveLength(t.points.length);
    t.points.forEach((p, i) => p.def.forEach((v, k) => expect(s.points[i][k]).toBeCloseTo(v, 2)));
  });

  it.each(listTemplates().map((t) => [t.slot, t] as const))('type %i has a moving upright tied to ground', (_slot, t) => {
    expect(t.points.some((p) => p.part2 === GROUND)).toBe(true);
    expect(t.parts.length).toBeGreaterThan(0);
  });
});
