import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addEndFromModel, applyExport, applyImport, createGroup, CoordSetError, defaultPointLabel, defaultTransfer, deleteCoordSet, deleteGroup,
  editGroup, evalMathString, findRows, getTemplate, GroupError, groupsOfEnd, labelsFor, moveGroup, newModel, planExport, planImport,
  pointsInBox, recallCoordSet, saveCoordSet, toFileCoords, toModelCoords, type Vec3,
} from '../src/index.js';
import { sampleModel } from './helpers.js';

const fixture = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const sub = fixture('double_wishbone.sub');

describe('row finding', () => {
  it('reads only the HARDPOINT block of an Adams file, with sides', () => {
    const rows = findRows(sub, 'adams');
    expect(rows).toHaveLength(14);
    expect(rows.find((r) => r.name === 'not_a_hardpoint')).toBeUndefined();
    expect(rows[1]).toMatchObject({ name: 'lca_front', side: 'right', value: [3800, 313, 225.6] });
  });
  it('understands hpl_ / hpr_ names and files without a symmetry column', () => {
    const rows = findRows('[HARDPOINT]\nhpl_a 1 2 3\nhpr_a 1 -2 3\nhps_b 0 0 1\n', 'adams');
    expect(rows.map((r) => [r.bare, r.side])).toEqual([['a', 'left'], ['a', 'right'], ['b', 'single']]);
  });
  it('reads the User A format: comments, = and commas, quotes and exponents', () => {
    const rows = findRows(fixture('user_a.txt'), 'usera');
    expect(rows.map((r) => r.name)).toEqual(['lca_front', 'lca_rear', 'uca front', 'wheel_center']);
    expect(rows[0].value).toEqual([100, 200, 300]);
    expect(rows[3].value).toEqual([0.5, -0.25, 100]);
  });
});

describe('label strings', () => {
  it('give the built-in double wishbone sensible Adams names', () => {
    const t = getTemplate(1);
    const l = labelsFor(t).point;
    expect(l).toEqual([
      'lca_front', 'lca_rear', 'lca_outer', 'uca_front', 'uca_rear', 'uca_outer', 'strut_lower', 'strut_upper',
      'tierod_outer', 'tierod_inner', 'strut_upper', 'strut_lower', 'DERIVED', 'wheel_center',
    ]);
  });
  it('cover the strut template and fall back to Not Defined', () => {
    expect(labelsFor(getTemplate(3)).point).toContain('strut_upper');
    expect(defaultPointLabel('Panhard rod body end')).toBe('Not Defined');
  });
  it('let overrides win', () => {
    expect(labelsFor(getTemplate(1), { point: ['my_point'] }).point[0]).toBe('my_point');
  });
});

describe('maths strings', () => {
  const pts: Vec3[] = [[0, 0, 0], [10, 20, 30], [4, 4, 4]];
  const p = (n: number) => pts[n - 1];
  it('averages points', () => expect(evalMathString('[(P1+P2)/2.0]', p)).toEqual([5, 10, 15]));
  it('does Fortran functions and powers', () => {
    expect(evalMathString('[P2 + SQRT(16.0)*P3 - 2**3]', p)).toEqual([18, 28, 38]);
    expect(evalMathString('[P2*COSD(60.0)*2]', p)[0]).toBeCloseTo(10);
    expect(evalMathString('[-P3]', p)).toEqual([-4, -4, -4]);
  });
  it('rejects nonsense', () => {
    expect(() => evalMathString('[P9]', p)).toThrow();
    expect(() => evalMathString('[FOO(1)]', p)).toThrow();
    expect(() => evalMathString('[1+2]', p)).toThrow(/not a point/);
    expect(() => evalMathString('[P1 $ P2]', p)).toThrow();
  });
});

describe('shift, scale and switch', () => {
  it('apply in the order shift, scale, switch and reverse on export', () => {
    const s = { ...defaultTransfer(), shift: [10, 0, 5] as Vec3, scale: [2, 1, 1] as Vec3, switch: [1, 0, 2] as [number, number, number] };
    expect(toModelCoords([1, 2, 3], s)).toEqual([2, 22, 8]); // shift (11,2,8) -> scale (22,2,8) -> switch (2,22,8)
    expect(toFileCoords([2, 22, 8], s)).toEqual([1, 2, 3]);
  });
  it('refuses an axis switch that repeats an axis', () => {
    expect(() => toModelCoords([1, 2, 3], { ...defaultTransfer(), switch: [0, 0, 2] })).toThrow();
  });
});

describe('Adams import', () => {
  it('previews and applies the right-hand rows to a type 1 model', () => {
    const m = newModel(1);
    const plan = planImport(m, 'front', sub, 'adams');
    const byLabel = (l: string) => plan.rows.find((r) => r.label === l)!;
    expect(byLabel('lca_front')).toMatchObject({ status: 'found', next: [3800, 313, 225.6], changes: true });
    expect(byLabel('DERIVED').status).toBe('derived');
    expect(plan.rows.filter((r) => r.status === 'missing')).toHaveLength(0);
    const after = applyImport(m, plan);
    expect(after.front!.points[0]).toEqual([3800, 313, 225.6]);
    expect(after.front!.points[13]).toEqual([3950, 740, 225]); // wheel centre
    expect(after.front!.points[12]).toEqual(m.front!.points[12]); // DERIVED point untouched
    expect(m.front!.points[0]).not.toEqual([3800, 313, 225.6]); // original model not mutated
  });
  it('reads the left rows when the corner is on the left', () => {
    const plan = planImport(newModel(1), 'front', sub, 'adams', { ...defaultTransfer(), side: 'left' });
    expect(plan.rows[0].next).toEqual([3800, -313, 225.6]);
    expect(plan.rows[1].next).toEqual([4100, -300, 230]);
  });
  it('shifts on import', () => {
    const plan = planImport(newModel(1), 'front', sub, 'adams', { ...defaultTransfer(), shift: [-3800, 0, 0] });
    expect(plan.rows[0].next).toEqual([0, 313, 225.6]);
  });
  it('reports missing labels and evaluates maths strings in order', () => {
    const m = newModel(1);
    const plan = planImport(m, 'front', sub, 'adams', defaultTransfer(), {
      point: ['lca_front', 'nonexistent', '[(P1+P1)/2]', ...Array(11).fill('Not Defined')],
    });
    expect(plan.rows[1].status).toBe('missing');
    expect(plan.rows[2]).toMatchObject({ status: 'maths', next: [3800, 313, 225.6] });
    expect(plan.rows[3].status).toBe('undefined');
    const bad = planImport(m, 'front', sub, 'adams', defaultTransfer(), { point: ['[P99]', ...Array(13).fill('Not Defined')] });
    expect(bad.rows[0].status).toBe('error');
    expect(applyImport(m, bad).front!.points).toEqual(m.front!.points);
  });
  it('imports a User A file', () => {
    const plan = planImport(newModel(1), 'front', fixture('user_a.txt'), 'usera', defaultTransfer(), {
      point: ['lca_front', 'lca_rear', 'uca front', ...Array(10).fill('Not Defined'), 'wheel_center'],
    });
    expect(plan.changed).toBe(4);
    expect(applyImport(newModel(1), plan).front!.points[13]).toEqual([0.5, -0.25, 100]);
  });
});

describe('Adams export', () => {
  it('rewrites only the matched numbers and keeps everything else', () => {
    const m = newModel(1);
    const plan = planExport(m, 'front', sub, 'adams');
    // strut_lower and strut_upper are each the default label of two template points: only the first gets the row.
    expect(plan.rows.filter((r) => r.status === 'found')).toHaveLength(11);
    expect(plan.rows.filter((r) => r.status === 'error').map((r) => r.label).sort()).toEqual(['strut_lower', 'strut_upper']);
    expect(plan.notes).toHaveLength(2);
    const out = applyExport(m, plan, sub);
    const a = sub.split('\n');
    const b = out.split('\n');
    expect(b).toHaveLength(a.length);
    const differing = b.map((l, i) => (l !== a[i] ? i : -1)).filter((i) => i >= 0);
    // only right-hand rows change, never the left ones, the single row, other blocks or the header
    for (const i of differing) expect(a[i]).toMatch(/^'right'/);
    expect(b.filter((l) => l.startsWith("'left'"))).toEqual(a.filter((l) => l.startsWith("'left'")));
    expect(out).toContain("'single'   'steering_rack'  3750.0         0.0       300.0");
    // and the file now reads back as the model
    const again = planImport(m, 'front', out, 'adams');
    expect(again.rows.filter((r) => r.changes)).toEqual([]);
    // every rewritten number is a well-formed coordinate
    for (const i of differing) expect(b[i]).toMatch(/^'right'\s+'\w+'(\s+-?\d+\.\d+){3}\s*\r?$/);
  });
  it('round-trips with shift, scale and switch', () => {
    const s = { ...defaultTransfer(), shift: [100, -50, 0] as Vec3, scale: [1, 0.5, 1] as Vec3, switch: [0, 2, 1] as [number, number, number] };
    const m = newModel(1);
    const out = applyExport(m, planExport(m, 'front', sub, 'adams', s), sub, s);
    const back = applyImport(newModel(14), planImport(m, 'front', out, 'adams', s));
    for (const [i, tp] of getTemplate(1).points.filter((p) => !p.dummy).entries()) {
      const label = labelsFor(getTemplate(1)).point[i];
      if (label === 'DERIVED' || label.startsWith('strut_')) continue; // strut rows are shared by two points
      back.front!.points[i].forEach((v, k) => expect(v).toBeCloseTo(m.front!.points[i][k], 4));
      void tp;
    }
  });
  it('writes user A files in place too', () => {
    const labels = { point: ['lca_front', ...Array(12).fill('Not Defined'), 'wheel_center'] };
    const m = newModel(1);
    const txt = fixture('user_a.txt');
    const out = applyExport(m, planExport(m, 'front', txt, 'usera', defaultTransfer(), labels), txt, defaultTransfer(), labels);
    const lines = out.split('\n');
    expect(lines[0]).toBe('# A made-up export from another tool: label then x y z');
    expect(lines[1]).toBe('lca_front   = 3819.0, 313.0, 225.6');
    expect(lines[2]).toBe('lca_rear      110 210 310');
    expect(lines[3]).toBe('"uca front" 5 6 7');
  });
});

describe('groups', () => {
  const base = () => newModel(1);
  it('create, edit, delete with validation', () => {
    let m = createGroup(base(), 'Lower arm', 'front', [2, 0, 1, 1]);
    expect(m.groups[0].members).toEqual([{ point: 1, end: 1 }, { point: 2, end: 1 }, { point: 3, end: 1 }]);
    expect(() => createGroup(m, 'Lower arm', 'front', [0])).toThrow(GroupError);
    expect(() => createGroup(m, 'x', 'front', [99])).toThrow(/does not exist/);
    expect(() => createGroup(m, 'x', 'rear', [0])).toThrow(/no rear/);
    expect(() => createGroup(m, '  ', 'front', [0])).toThrow();
    m = editGroup(m, 'Lower arm', { label: 'LCA', indexes: [0, 1] });
    expect(m.groups[0]).toEqual({ label: 'LCA', members: [{ point: 1, end: 1 }, { point: 2, end: 1 }] });
    m = deleteGroup(m, 'LCA');
    expect(m.groups).toEqual([]);
    expect(() => deleteGroup(m, 'LCA')).toThrow();
  });
  it('joggles a group by a delta and leaves other points alone', () => {
    const m0 = createGroup(base(), 'Upright', 'front', [2, 5, 13]);
    const m1 = moveGroup(m0, 'Upright', [0, 10, -5]);
    for (const i of [2, 5, 13]) expect(m1.front!.points[i]).toEqual([m0.front!.points[i][0], m0.front!.points[i][1] + 10, m0.front!.points[i][2] - 5]);
    expect(m1.front!.points[0]).toEqual(m0.front!.points[0]);
  });
  it('works on groups read from a SHARK file and writes them back', async () => {
    const { writeDat, readDat } = await import('../src/index.js');
    const m = sampleModel('Tutorial3.dat');
    expect(groupsOfEnd(m, 'front').length).toBeGreaterThan(0);
    const g = m.groups[0];
    const moved = moveGroup(m, g.label, [1, 2, 3]);
    expect(readDat(writeDat(moved)).front!.points).toEqual(moved.front!.points);
  });
  it('picks points in a box', () => {
    const m = base();
    const p = m.front!.points[0];
    expect(pointsInBox(m, 'front', [p[0] - 1, p[1] - 1, p[2] - 1], [p[0] + 1, p[1] + 1, p[2] + 1])).toContain(0);
  });
});

describe('saved coordinate sets and Add End', () => {
  it('saves, recalls and deletes', () => {
    const m = newModel(1);
    const store = saveCoordSet([], 'start', m);
    const moved = moveGroup(createGroup(m, 'g', 'front', [0]), 'g', [5, 5, 5]);
    expect(moved.front!.points[0]).not.toEqual(m.front!.points[0]);
    expect(recallCoordSet(store, 'start', moved).front!.points[0]).toEqual(m.front!.points[0]);
    expect(() => recallCoordSet(store, 'nope', m)).toThrow(CoordSetError);
    expect(() => recallCoordSet(store, 'start', newModel(14))).toThrow(/different suspension/);
    expect(deleteCoordSet(store, 'start')).toEqual([]);
  });
  it('adds the missing end from another file', () => {
    const { model, end } = addEndFromModel(newModel(1, 'front'), newModel(14, 'rear'));
    expect(end).toBe('rear');
    expect(model.rear!.templateSlot).toBe(14);
    expect(model.sectionOrder).toContain('REAR SUSPENSION');
    expect(() => addEndFromModel(model, newModel(1))).toThrow(/both ends/);
  });
});
