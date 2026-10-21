import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDefaultModel, parseSim, writeSim } from '../src/sim';

const dir = join(__dirname, 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.sim')).sort();
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const norm = (t: string) => t.split(/\r?\n/).map((l) => l.trimEnd()).join('\n').trimEnd();

describe('sim fixtures', () => {
  it('finds the fixtures', () => expect(files.length).toBe(17));
  for (const f of files) {
    it(`${f}: parses and round-trips`, () => {
      const t = read(f);
      const m = parseSim(t);
      expect(m.cylinders.length).toBeGreaterThan(0);
      expect(m.tests.length).toBeGreaterThan(0);
      const out = writeSim(m);
      expect(out.includes('\r\n')).toBe(true);
      expect(norm(out)).toBe(norm(t));
    });
  }

  it('tutorial_1 decoded values', () => {
    const m = parseSim(read('tutorial_1.sim'));
    expect(m.name).toBe('tutorial_1');
    expect(m.cycle).toBe(4);
    const c = m.cylinders[0];
    expect([c.bore, c.stroke, c.conRod, c.pinOffset, c.compressionRatio]).toEqual([87, 84, 130, 0, 11]);
    expect(m.fuel.type).toBe('gasoline');
    expect(m.heatTransfer).toEqual({ kind: 'annand', a: 0.2, b: 0.8, c: 4.29e-9 });
    expect(m.ports.map((p) => [p.kind, p.diameter])).toEqual([['exhaust', 22.5], ['intake', 28]]);
    const [vi, ve] = m.valves;
    expect([vi.kind, vi.openAngle, vi.closeAngle, vi.maxLift, vi.diameter]).toEqual(['intake', 345, 600, 8.5, 28]);
    expect([ve.kind, ve.openAngle, ve.closeAngle, ve.maxLift, ve.diameter]).toEqual(['exhaust', 140, 380, 8, 22.5]);
    expect(m.tests.map((t) => t.speed)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    expect(m.tests[0].ambientTemperature).toBeCloseTo(293.15);
    expect(m.tests[0].afr).toBeCloseTo(14.47 / 1.1, 1);
    expect(m.connections[0].via.map((r) => r.kind)).toEqual(['valve', 'port']);
    expect(m.layout['cylinder:1']).toEqual({ x: 18, y: 12 });
  });

  it('tutorial_4 pipes, plenums, throttles, firing order', () => {
    const m = parseSim(read('tutorial_4.sim'));
    expect(m.cylinders.map((c) => c.firingAngle)).toEqual([360, 180, 540, 0]);
    expect(m.pipes.length).toBe(19);
    expect(m.pipes[0].length).toBe(100);
    expect(m.pipes[0].stations[0].d).toBe(39);
    expect(m.pipes[1].length).toBe(350);
    expect(m.plenums[0].volume).toBeCloseTo(2500);
    expect(m.plenums[1].wallTemperature).toBeCloseTo(373.15);
    expect(m.throttles[0].diameter).toBeCloseTo(45, 1);
    expect(m.connections.length).toBe(32);
    expect(m.layout['plenum:1']).toEqual({ x: 8, y: 3 });
    expect(m.layout['pipe:2']).toEqual({ x: 9.5, y: 9 });
  });

  it('tutorial_10 diesel decoding', () => {
    const m = parseSim(read('tutorial_10.sim'));
    expect(m.fuel.type).toBe('diesel');
    expect(m.fuel.system).toBe('direct-injection-diesel');
    expect(m.burn.kind).toBe('wiebe2');
    expect(m.tests[0].burnStart).toBe(6); // phase -6 => 6 deg ATDC
    expect(m.tests[0].burnDuration).toBe(25);
  });

  it('tutorial_5 user valve lift and port tables', () => {
    const m = parseSim(read('tutorial_5.sim'));
    const v = m.valves[0];
    expect(v.liftCurve?.angle.length).toBe(35);
    expect(v.liftCurve?.angle[0]).toBeCloseTo(v.openAngle);
    expect(Math.max(...(v.liftCurve?.lift ?? []))).toBeCloseTo(9.4245, 3);
    expect(m.pipes[0].frictionFactor).toBeCloseTo(0.005);
  });

  it('tutorial_12 two-stroke', () => {
    const m = parseSim(read('tutorial_12.sim'));
    expect(m.cycle).toBe(2);
    expect(m.pipes[1].stations.length).toBe(7);
    expect(m.tests[0].speed).toBe(2000);
  });

  it('modified model writes and re-parses to the same values', () => {
    const t = read('tutorial_4.sim');
    const m = parseSim(t);
    m.cylinders[0].bore = 90.5;
    m.cylinders[1].compressionRatio = 12;
    m.valves[0].maxLift = 9.25;
    m.valves[0].openAngle = 340;
    m.pipes[1].length = 400;
    m.pipes[1].stations = [{ x: 0, d: 40 }, { x: 200, d: 38 }, { x: 400, d: 36 }];
    m.plenums[0].volume = 3000;
    m.throttles[0].diameter = 40;
    m.tests[2].speed = 3500;
    m.tests[2].burnStart = -15;
    m.tests[2].burnDuration = 50;
    m.tests[3].ambientPressure = 0.95;
    m.tests[4].afr = 12.5;
    m.connections.push({ a: { kind: 'pipe', id: 1, end: 1 }, b: { kind: 'pipe', id: 3, end: 2 }, via: [] });
    m.layout['plenum:1'] = { x: 10, y: 4 };
    const m2 = parseSim(writeSim(m));
    expect(m2.cylinders[0].bore).toBe(90.5);
    expect(m2.cylinders[1].compressionRatio).toBe(12);
    expect(m2.valves[0].maxLift).toBe(9.25);
    expect(m2.valves[0].openAngle).toBe(340);
    expect(m2.pipes[1].length).toBe(400);
    expect(m2.pipes[1].stations).toEqual(m.pipes[1].stations);
    expect(m2.plenums[0].volume).toBeCloseTo(3000, 3);
    expect(m2.throttles[0].diameter).toBeCloseTo(40, 1);
    expect(m2.tests[2].speed).toBe(3500);
    expect(m2.tests[2].burnStart).toBeCloseTo(-15, 4);
    expect(m2.tests[2].burnDuration).toBeCloseTo(50, 4);
    expect(m2.tests[3].ambientPressure).toBeCloseTo(0.95, 4);
    expect(m2.tests[4].afr).toBeCloseTo(12.5, 3);
    expect(m2.connections.length).toBe(m.connections.length);
    expect(m2.connections[m2.connections.length - 1]).toEqual(m.connections[m.connections.length - 1]);
    expect(m2.layout['plenum:1']).toEqual({ x: 10, y: 4 });
    // untouched things stay equal, and the second write is stable
    expect(m2.cylinders[2]).toEqual(m.cylinders[2]);
    expect(m2.tests[0]).toEqual(m.tests[0]);
    expect(norm(writeSim(m2))).toBe(norm(writeSim(m)));
  });

  it('changing the cylinder count resizes per-cylinder sections', () => {
    const m = parseSim(read('tutorial_1.sim'));
    m.cylinders.push({ ...m.cylinders[0], id: 2, firingAngle: 360 });
    const m2 = parseSim(writeSim(m));
    expect(m2.cylinders.length).toBe(2);
    expect(m2.cylinders[1].firingAngle).toBe(360);
  });
});

describe('regeneration without raw text', () => {
  for (const f of files) {
    it(`${f}: generated sections re-parse to the same model`, () => {
      const m = parseSim(read(f));
      const bare = { ...m, raw: undefined, rawOrder: undefined };
      const m2 = parseSim(writeSim(bare));
      expect(m2.cylinders).toEqual(m.cylinders);
      expect(m2.ports.map((p) => [p.kind, p.diameter])).toEqual(m.ports.map((p) => [p.kind, p.diameter]));
      expect(m2.valves.map((v) => ({ ...v, extra: undefined }))).toEqual(m.valves.map((v) => ({ ...v, extra: undefined })));
      expect(m2.pipes.map((p) => [p.length, p.stations, p.frictionFactor])).toEqual(
        m.pipes.map((p) => [p.length, p.stations, p.frictionFactor]),
      );
      expect(m2.plenums.map((p) => p.volume)).toEqual(m.plenums.map((p) => p.volume));
      expect(m2.throttles.map((t) => t.diameter)).toEqual(m.throttles.map((t) => t.diameter));
      expect(m2.connections).toEqual(m.connections);
      expect(m2.tests.map((t) => [t.speed, t.ambientPressure])).toEqual(m.tests.map((t) => [t.speed, t.ambientPressure]));
      expect(m2.fuel).toEqual(m.fuel);
      expect(m2.burn).toEqual(m.burn);
      expect(m2.heatTransfer).toEqual(m.heatTransfer);
    });
  }
});

describe('default model', () => {
  for (const [n, cycle] of [[4, 4], [1, 4], [6, 4], [2, 2]] as const) {
    it(`${n} cylinders, ${cycle}-stroke round-trips`, () => {
      const m = createDefaultModel({ cylinders: n, cycle });
      expect(m.cylinders.length).toBe(n);
      expect(m.pipes.length).toBe(4 * n + 1);
      expect(m.tests.length).toBe(7);
      const text = writeSim(m);
      const m2 = parseSim(text);
      expect(m2.cylinders).toEqual(m.cylinders);
      expect(m2.ports.map((p) => p.diameter)).toEqual(m.ports.map((p) => p.diameter));
      expect(m2.valves.map((v) => [v.openAngle, v.closeAngle, v.maxLift, v.diameter])).toEqual(
        m.valves.map((v) => [v.openAngle, v.closeAngle, v.maxLift, v.diameter]),
      );
      expect(m2.pipes.length).toBe(m.pipes.length);
      expect(m2.connections).toEqual(m.connections);
      expect(m2.tests.map((t) => t.speed)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000]);
      expect(m2.tests[0].burnStart).toBeCloseTo(m.tests[0].burnStart, 6);
      expect(m2.tests[0].afr).toBeCloseTo(m.tests[0].afr, 3);
      expect(m2.layout).toEqual(m.layout);
      expect(norm(writeSim(m2))).toBe(norm(text));
    });
  }
});
