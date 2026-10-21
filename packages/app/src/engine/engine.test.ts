import { describe, expect, it } from 'vitest';
import type { EngineModel } from '@claudus/engine';
import { checkModel } from './check';
import { addConnection, addElement, copyElements, deleteElements, pasteElements } from './elements';
import { emptyHistory, record, redo, undo } from './history';
import { autoLayout } from './layout';
import { evenFiring, firingOrder, speedSweep, defaultTestPoint } from './testpoints';

function blank(): EngineModel {
  return {
    title: [], name: 't', cycle: 4, cylinders: [], fuel: { type: 'gasoline', lowerHeatingValue: 43e6, hcRatio: 1.87, ocRatio: 0, density: 745, system: 'spark-ignition' },
    burn: { kind: 'wiebe', a: 5, m: 2 }, heatTransfer: { kind: 'woschni', scale: 1 }, temperatures: { head: 500, piston: 550, liner: 420 },
    friction: { a: 0, b: 0, c: 0, d: 0 }, valves: [], ports: [], pipes: [], plenums: [], throttles: [], inlets: [], exits: [], compressors: [], turbines: [],
    connections: [], tests: [defaultTestPoint()], layout: {},
  };
}

/** inlet -> intake pipe -> cylinder -> exhaust pipe -> exit */
function network(): EngineModel {
  const m = blank();
  const inlet = addElement(m, 'inlet');
  const ip = addElement(m, 'pipe');
  const cyl = addElement(m, 'cylinder');
  const ep = addElement(m, 'pipe');
  const ex = addElement(m, 'exit');
  void inlet; void cyl; void ip; void ep; void ex;
  m.valves.push({ id: 1, label: 'iv', kind: 'intake', openAngle: 0, closeAngle: 200, maxLift: 9, diameter: 30 });
  m.valves.push({ id: 2, label: 'ev', kind: 'exhaust', openAngle: 0, closeAngle: 200, maxLift: 9, diameter: 30 });
  addConnection(m, { kind: 'inlet', id: 1 }, { kind: 'pipe', id: 1, end: 1 });
  addConnection(m, { kind: 'pipe', id: 1, end: 2 }, { kind: 'cylinder', id: 1 }, [{ kind: 'valve', id: 1 }]);
  addConnection(m, { kind: 'cylinder', id: 1 }, { kind: 'pipe', id: 2, end: 1 }, [{ kind: 'valve', id: 2 }]);
  addConnection(m, { kind: 'pipe', id: 2, end: 2 }, { kind: 'exit', id: 1 });
  return m;
}

describe('history', () => {
  it('undoes and redoes', () => {
    let h = emptyHistory<number>();
    h = record(h, 1);
    h = record(h, 2);
    const u = undo(h, 3)!;
    expect(u.value).toBe(2);
    const r = redo(u.history, 2)!;
    expect(r.value).toBe(3);
    expect(undo(emptyHistory<number>(), 0)).toBeNull();
  });
  it('coalesces edits with the same key and clears redo on new edits', () => {
    let h = emptyHistory<number>();
    h = record(h, 1, 'f');
    h = record(h, 2, 'f');
    expect(h.past).toEqual([1]);
    const u = undo(h, 3)!;
    expect(record(u.history, 1).future).toEqual([]);
  });
});

describe('auto layout', () => {
  it('puts intake left, cylinder centre, exhaust right', () => {
    const m = network();
    const l = autoLayout(m, true);
    expect(l['inlet:1'].x).toBeLessThan(l['pipe:1'].x);
    expect(l['pipe:1'].x).toBeLessThan(l['cylinder:1'].x);
    expect(l['cylinder:1'].x).toBeLessThan(l['pipe:2'].x);
    expect(l['pipe:2'].x).toBeLessThan(l['exit:1'].x);
  });
  it('keeps existing positions', () => {
    const m = network();
    m.layout['cylinder:1'] = { x: 5, y: 6 };
    expect(autoLayout(m)['cylinder:1']).toEqual({ x: 5, y: 6 });
  });
  it('uses element kinds when there are no connections', () => {
    const m = blank();
    addElement(m, 'exit'); addElement(m, 'inlet'); addElement(m, 'cylinder');
    m.layout = {};
    const l = autoLayout(m);
    expect(l['inlet:1'].x).toBeLessThan(l['cylinder:1'].x);
    expect(l['cylinder:1'].x).toBeLessThan(l['exit:1'].x);
  });
});

describe('connectivity check', () => {
  it('accepts a complete network', () => {
    expect(checkModel(network()).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('flags unconnected pipe ends and missing connections', () => {
    const m = network();
    m.connections = m.connections.filter((c) => !(c.b.kind === 'exit'));
    const errs = checkModel(m).filter((i) => i.severity === 'error');
    expect(errs.some((e) => /end 2 is not connected/.test(e.message) && e.key === 'pipe:2')).toBe(true);
    expect(errs.some((e) => e.key === 'exit:1')).toBe(true);
  });
  it('allows several connections on one pipe end (junction as in .sim files)', () => {
    const m = network();
    addConnection(m, { kind: 'pipe', id: 1, end: 1 }, { kind: 'pipe', id: 2, end: 2 });
    expect(checkModel(m).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('element editing', () => {
  it('deletes elements with their connections', () => {
    const m = network();
    deleteElements(m, ['pipe:1']);
    expect(m.pipes.length).toBe(1);
    expect(m.connections.length).toBe(2);
  });
  it('copy and paste remaps ids and connections', () => {
    const m = network();
    const clip = copyElements(m, ['pipe:1', 'cylinder:1']);
    expect(clip.connections.length).toBe(1);
    const keys = pasteElements(m, clip);
    expect(keys).toEqual(['pipe:3', 'cylinder:2', 'valve:3']);
    const added = m.connections[m.connections.length - 1];
    expect(added.a).toMatchObject({ kind: 'pipe', id: 3 });
    expect(added.b).toMatchObject({ kind: 'cylinder', id: 2 });
  });
});

describe('test points', () => {
  it('generates a speed sweep', () => {
    const pts = speedSweep(defaultTestPoint(), 1000, 3000, 500);
    expect(pts.map((p) => p.speed)).toEqual([1000, 1500, 2000, 2500, 3000]);
    expect(speedSweep(defaultTestPoint(), 3000, 1000, 500)).toEqual([]);
  });
  it('computes firing order and intervals', () => {
    const m = blank();
    for (let i = 1; i <= 4; i++) addElement(m, 'cylinder');
    m.cylinders.forEach((c) => (c.firingAngle = 0));
    evenFiring(m, [1, 3, 4, 2]);
    const f = firingOrder(m);
    expect(f.map((e) => e.id)).toEqual([1, 3, 4, 2]);
    expect(f.every((e) => e.interval === 180)).toBe(true);
  });
});
