import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSim, writeSim } from '../src/sim/index';
import { simulatePoint } from '../src/solver/simulate';
import { crankVolume, discOpenFraction, pistonPortOpening, scavengeOutBurnt, stepReed, twoStrokeArea } from '../src/solver/twostroke';

const load = (n: string) => parseSim(readFileSync(new URL(`./fixtures/${n}.sim`, import.meta.url), 'utf8'));

describe('two-stroke decoding', () => {
  it('decodes piston port, disc, reed and the crankcase', () => {
    const a = load('tutorial_12');
    expect(a.valves.map((v) => v.type)).toEqual(['piston-port', 'piston-port', 'disc']);
    expect(a.valves[0].piston).toMatchObject({ width: 49, height: 16, openAngle: 113, cd: 0.9 });
    expect(a.valves[2].disc).toMatchObject({ discDiameter: 120, portDiameter: 38, cd: 0.95 });
    expect(a.plenums[0].varying).toMatchObject({ bore: 54, compressionRatio: 1.6, tdcAngle: 180 });
    expect(a.tests[0].fmep).toBeCloseTo(0.872);
    const b = load('tutorial_12b');
    expect(b.valves[2].type).toBe('reed');
    expect(b.valves[2].reed).toMatchObject({ petals: 4, maxLift: 5, stiffness: 0.25 });
  });
  it('round-trips', () => {
    for (const n of ['tutorial_12', 'tutorial_12b']) {
      const m = load(n);
      expect(parseSim(writeSim(m)).valves).toEqual(m.valves);
    }
  });
});

describe('two-stroke components', () => {
  const m = load('tutorial_12');
  it('piston port opens around BDC and is symmetric', () => {
    const v = m.valves[1];
    expect(pistonPortOpening(v, 40)).toBe(0);
    expect(pistonPortOpening(v, 180)).toBeGreaterThan(0.95 * v.piston!.height);
    expect(pistonPortOpening(v, 90)).toBeCloseTo(pistonPortOpening(v, 270), 6);
    expect(twoStrokeArea(v, 180)).toBeGreaterThan(5e-4);
  });
  it('disc valve opens through TDC window', () => {
    const d = m.valves[2];
    expect(discOpenFraction(d, 330)).toBeCloseTo(1, 3);
    expect(discOpenFraction(d, 120)).toBe(0);
  });
  it('crankcase volume is minimal at its TDC angle', () => {
    const p = m.plenums[0];
    expect(crankVolume(p, 180)).toBeLessThan(crankVolume(p, 0));
    expect(crankVolume(p, 0) / crankVolume(p, 180)).toBeCloseTo(1.6, 1);
  });
  it('reed petal opens under positive dp and closes when it reverses', () => {
    const q = load('tutorial_12b').valves[2].reed!;
    const s = { x: 0, v: 0 };
    for (let i = 0; i < 20000; i++) stepReed(q, s, 2e4, 1e-6);
    expect(s.x).toBeCloseTo(q.maxLift, 3);
    for (let i = 0; i < 20000; i++) stepReed(q, s, -2e4, 1e-6);
    expect(s.x).toBe(0);
  });
  it('scavenge models order the burnt content of the outflow', () => {
    const pm = scavengeOutBurnt({ kind: 'perfect-mixing', a: 0, b: 0, c: 0 }, 0.3, 0.1);
    const pd = scavengeOutBurnt({ kind: 'perfect-displacement', a: 0, b: 0, c: 0 }, 0.3, 0.1);
    expect(pd).toBeGreaterThan(pm);
    expect(scavengeOutBurnt({ kind: 'benson-brandham', a: 0.5, b: 0, c: 0 }, 0.3, 0.9)).toBe(0.3);
  });
});

describe('two-stroke simulation', () => {
  for (const name of ['tutorial_12', 'tutorial_12b']) {
    it(`${name} gives positive IMEP, a sensible delivery ratio and an oscillating crankcase`, () => {
      const m = load(name);
      for (const t of [m.tests[0], m.tests[3]]) {
        const r = simulatePoint(m, t);
        expect(r.imep).toBeGreaterThan(3);
        expect(r.imep).toBeLessThan(11);
        const sc = r.scavenging!;
        expect(sc.deliveryRatio).toBeGreaterThan(0.4);
        expect(sc.deliveryRatio).toBeLessThan(1.5);
        expect(sc.trappingEfficiency).toBeGreaterThan(0.2);
        expect(sc.trappingEfficiency).toBeLessThan(1);
        const pc = r.traces.plenums[0].pressure;
        const mean = pc.reduce((a, b) => a + b, 0) / pc.length;
        expect(Math.min(...pc)).toBeLessThan(1.01);
        expect(Math.max(...pc)).toBeGreaterThan(1.2);
        expect(mean).toBeGreaterThan(0.85);
        expect(mean).toBeLessThan(1.4);
      }
    }, 60000);
  }
});
