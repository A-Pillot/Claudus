import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSim } from '../src/sim/index';
import { simulatePoint } from '../src/solver/simulate';

const load = (n: string) => parseSim(readFileSync(new URL(`./fixtures/${n}.sim`, import.meta.url), 'utf8'));

describe('tutorial models', () => {
  it('tutorial_1 (no pipes) gives sensible performance across speed', () => {
    const m = load('tutorial_1');
    for (const t of m.tests) {
      const r = simulatePoint(m, t);
      console.log(t.speed, r.imep.toFixed(2), r.bmep.toFixed(2), r.power.toFixed(2), r.volumetricEfficiency.toFixed(3), r.bsfc.toFixed(0), r.cylinders[0].peakPressure.toFixed(1), r.warnings.join('|'));
      expect(r.imep).toBeGreaterThan(5);
      expect(r.imep).toBeLessThan(16);
    }
  });
});
