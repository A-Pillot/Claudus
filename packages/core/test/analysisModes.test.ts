import { describe, expect, it } from 'vitest';
import { readDat, writeDat } from '../src/io/dat.js';
import { analyse } from '../src/results/derivatives.js';
import { combinedSweep } from '../src/results/combined.js';
import { Corner } from '../src/solver/corner.js';
import { bumpSteps, combinedLines, defaultCombined, parseCombined, parseExtendedBump } from '../src/model/combined.js';
import { setStaticAngles, staticAngles } from '../src/model/staticAngles.js';
import type { Model } from '../src/model/types.js';
import { sample, sampleModel } from './helpers.js';

const withSections = (name: string, extra: string[]) => {
  const text = sample(name).replace(/\r/g, '').trimEnd().split('\n');
  return [...text, ...extra].join('\r\n') + '\r\n';
};

/** The lines of one section of a data file, header first, up to the next section. */
const block = (text: string, name: string) => {
  const lines = text.replace(/\r/g, '').split('\n');
  const at = lines.indexOf(name);
  const end = lines.findIndex((l, i) => i > at && /^[A-Z][A-Z_ ]+$/.test(l));
  return lines.slice(at, end < 0 ? undefined : end).filter((l, i, a) => l !== '' || i < a.length - 1);
};

describe('COMBINED and EXTENDED BUMP sections', () => {
  const comb = ['COMBINED', '            2', '          10.0           5.0', '         -20.0          -5.0'];
  const ext = ['EXTENDED BUMP', '            1            3', '          -10.0  low', '            0.0', '           25.5  near the bump stop'];

  it('reads both sections', () => {
    const m = readDat(withSections('type1.dat', [...comb, ...ext]));
    expect(m.combined?.steps).toEqual([{ bump: 10, rack: 5 }, { bump: -20, rack: -5 }]);
    expect(m.extendedBump?.use).toBe(true);
    expect(m.extendedBump?.steps).toEqual([{ bump: -10, label: 'low' }, { bump: 0, label: '' }, { bump: 25.5, label: 'near the bump stop' }]);
  });

  it('writes an unedited file back byte for byte', () => {
    const text = withSections('type1.dat', [...comb, ...ext]);
    const out = writeDat(readDat(text));
    expect(block(out, 'COMBINED')).toEqual(comb);
    expect(block(out, 'EXTENDED BUMP')).toEqual(ext);
  });

  it('writes an edited profile and reads it back', () => {
    const m = readDat(withSections('type1.dat', [...comb, ...ext]));
    const edited: Model = { ...m, combined: { steps: [...m.combined!.steps, { bump: 1, rack: 2 }] }, extendedBump: { use: false, steps: [{ bump: 3, label: 'x y' }] } };
    const back = readDat(writeDat(edited));
    expect(back.combined).toEqual(edited.combined);
    expect(back.extendedBump).toEqual(edited.extendedBump);
  });

  it('adds the sections to a file that has none', () => {
    const m = sampleModel('type1.dat');
    const back = readDat(writeDat({ ...m, combined: defaultCombined(m.params), extendedBump: { use: true, steps: [{ bump: 5, label: '' }] } }));
    expect(back.combined?.steps).toHaveLength(11);
    expect(back.extendedBump?.use).toBe(true);
  });

  it('leaves a layout it does not understand as raw text', () => {
    expect(parseCombined(['3', '1 2 3'])).toBeUndefined();
    expect(parseExtendedBump(['1', '5'])).toBeUndefined();
    const text = withSections('type1.dat', ['COMBINED', '  7 7 7 7']);
    const m = readDat(text);
    expect(m.combined).toBeUndefined();
    expect(block(writeDat(m), 'COMBINED')).toEqual(['COMBINED', '  7 7 7 7']);
  });

  it('round-trips combinedLines', () => {
    const c = defaultCombined(sampleModel('type1.dat').params);
    expect(parseCombined(combinedLines(c))).toEqual(c);
  });
});

describe('extended bump travel', () => {
  it('runs the bump sweep through the listed positions when in use', () => {
    const m = sampleModel('type1.dat');
    const ext = { use: true, steps: [{ bump: -30, label: 'a' }, { bump: 0, label: '' }, { bump: 40, label: 'b' }] };
    expect(bumpSteps(m.params, ext).values).toEqual([-30, 0, 40]);
    const [a] = analyse({ ...m, extendedBump: ext });
    expect(a.bump.map((r) => r.bump)).toEqual([-30, 0, 40]);
    expect(a.bumpLabels).toEqual(['a', '', 'b']);
    // Not in use: even increments again.
    const [b] = analyse({ ...m, extendedBump: { ...ext, use: false } });
    expect(b.bump.length).toBeGreaterThan(10);
  });
});

describe('combined motion', () => {
  it('solves bump and steer together along the path', () => {
    const m = sampleModel('type1.dat');
    const c = new Corner(m.front!, 'front');
    const rows = combinedSweep(c, { steps: [{ bump: 0, rack: 0 }, { bump: 30, rack: 0 }, { bump: 30, rack: 20 }, { bump: 0, rack: 20 }] });
    expect(rows.every((r) => r.converged)).toBe(true);
    // Steering alone moves the toe; bump alone moves the camber.
    expect(Math.abs(rows[0].toeChange)).toBeLessThan(1e-6);
    expect(Math.abs(rows[1].camber - rows[0].camber)).toBeGreaterThan(0.1);
    expect(Math.abs(rows[3].toeChange)).toBeGreaterThan(0.5);
    // Matches the separate sweeps at the same bump and rack.
    const bump = c.solve({ bump: 30, rack: 20 });
    expect(rows[2].tcp[2]).toBeCloseTo(c.tcp(bump.points)[2], 6);
  });

  it('is part of the analysis when the model has a profile', () => {
    const m = sampleModel('type1.dat');
    expect(analyse(m)[0].combined).toEqual([]);
    expect(analyse({ ...m, combined: defaultCombined(m.params) })[0].combined).toHaveLength(11);
  });
});

describe('static angles', () => {
  it('sets camber and toe, leaving the wheel centre where it is', () => {
    const m = sampleModel('type1.dat');
    const before = staticAngles(m, 'front')[0];
    const next = setStaticAngles(m, 'front', [{ camber: -2.5, toe: 0.3 }]);
    const after = staticAngles(next, 'front')[0];
    expect(after.camber).toBeCloseTo(-2.5, 9);
    expect(after.toe).toBeCloseTo(0.3, 9);
    expect(before.camber).not.toBeCloseTo(-2.5, 3);
    const t = new Corner(next.front!, 'front');
    const wc = t.mech.staticPoints[t.sides[0].wc];
    const wc0 = new Corner(m.front!, 'front').mech.staticPoints[t.sides[0].wc];
    expect(wc).toEqual(wc0);
    // The solved static geometry agrees.
    expect(analyse(next)[0].statics.camber).toBeCloseTo(-2.5, 4);
  });
});
