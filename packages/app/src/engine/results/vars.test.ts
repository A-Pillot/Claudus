import { describe, expect, it } from 'vitest';
import { aWeight, combineChannels, cycleSeconds, performanceVars, splAnalysis, traceChannels } from './vars';
import { sampleSweep, sampleTestPoint } from './sample';

describe('results vars', () => {
  it('lists per-cylinder performance variables', () => {
    const v = performanceVars(sampleSweep());
    expect(v.find((x) => x.key === 'c3.imep')).toBeTruthy();
    expect(v.find((x) => x.key === 'power')!.get(sampleSweep().points[0])).toBeGreaterThan(0);
  });
  it('lists channels and combines', () => {
    const p = sampleTestPoint(4000);
    const ch = traceChannels(p);
    const a = ch.find((c) => c.key === 'cyl:1:pressure')!;
    const b = ch.find((c) => c.key === 'plen:1:p')!;
    const d = combineChannels(a, b, '-');
    expect(d.values[10]).toBeCloseTo(a.values[10] - b.values[10], 6);
  });
  it('cycle time and SPL', () => {
    const p = sampleTestPoint(3000);
    const ch = traceChannels(p).find((c) => c.key === 'pipe:2:end:p')!;
    expect(cycleSeconds(ch.angle, 3000)).toBeCloseTo(0.04, 5);
    const s = splAnalysis(ch, 3000)!;
    expect(s.overall).toBeGreaterThan(100);
    expect(aWeight(1000)).toBeCloseTo(0, 0);
  });
});
