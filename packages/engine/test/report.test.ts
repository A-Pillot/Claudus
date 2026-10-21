import { describe, expect, it } from 'vitest';
import type { EngineModel } from '../src/model';
import { formatReport, fftSpectrum, interp, resultsToCsv, tracesToCsv } from '../src/report';
import { sampleSweep } from '../../app/src/engine/results/sample';

const model = { name: 'T', title: ['Test engine'], cycle: 4, cylinders: [{ id: 1, bore: 80, stroke: 80, compressionRatio: 10 }], fuel: { type: 'gasoline', lowerHeatingValue: 43e6 } } as unknown as EngineModel;

describe('report', () => {
  const sweep = sampleSweep();
  it('formats a text report', () => {
    const t = formatReport(model, sweep);
    expect(t).toContain('Peak power');
    expect(t).toContain('TEST POINT 3000 rpm');
  });
  it('writes performance csv', () => {
    const lines = resultsToCsv(sweep).trim().split('\n');
    expect(lines).toHaveLength(sweep.points.length + 1);
    expect(lines[0]).toContain('Brake power (kW)');
  });
  it('writes trace csv', () => {
    const lines = tracesToCsv(sweep.points[0]).trim().split('\n');
    expect(lines.length).toBe(361);
    expect(lines[0].split(',').length).toBe(lines[1].split(',').length);
  });
  it('interpolates', () => {
    expect(interp([0, 10], [0, 100], 2.5)).toBeCloseTo(25);
    expect(interp([0, 10], [0, 100], 50)).toBe(100);
  });
  it('finds a sine in the spectrum', () => {
    const n = 256, fs = 1024;
    const s = Array.from({ length: n }, (_, i) => 3 * Math.sin((2 * Math.PI * 64 * i) / fs) + 5);
    const sp = fftSpectrum(s, fs);
    const k = sp.amplitude.indexOf(Math.max(...sp.amplitude));
    expect(sp.frequency[k]).toBeCloseTo(64, 0);
    expect(sp.amplitude[k]).toBeCloseTo(3, 1);
  });
});
