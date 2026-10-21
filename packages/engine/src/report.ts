// Text report (.MRS-like), CSV export and spectrum helpers for engine results. Pure, no DOM.
import type { EngineModel } from './model';
import type { SweepResult, TestPointResult } from './results';

const f = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const pad = (s: string, n: number): string => s.padStart(n);

/** Performance table columns shared by the text report, CSV and the graph viewer. */
export const PERFORMANCE_COLUMNS: { key: string; label: string; unit: string; get: (p: TestPointResult) => number }[] = [
  { key: 'speed', label: 'Speed', unit: 'rpm', get: (p) => p.speed },
  { key: 'power', label: 'Brake power', unit: 'kW', get: (p) => p.power },
  { key: 'torque', label: 'Brake torque', unit: 'Nm', get: (p) => p.torque },
  { key: 'bmep', label: 'BMEP', unit: 'bar', get: (p) => p.bmep },
  { key: 'imep', label: 'IMEP (net)', unit: 'bar', get: (p) => p.imep },
  { key: 'fmep', label: 'FMEP', unit: 'bar', get: (p) => p.fmep },
  { key: 'pmep', label: 'PMEP', unit: 'bar', get: (p) => mean(p.cylinders.map((c) => c.pmep)) },
  { key: 'bsfc', label: 'BSFC', unit: 'g/kWh', get: (p) => p.bsfc },
  { key: 've', label: 'Volumetric efficiency', unit: '%', get: (p) => p.volumetricEfficiency * 100 },
  { key: 'air', label: 'Air mass flow', unit: 'g/s', get: (p) => p.airMassFlow * 1000 },
  { key: 'fuel', label: 'Fuel mass flow', unit: 'g/s', get: (p) => p.fuelMassFlow * 1000 },
  { key: 'eta', label: 'Brake thermal efficiency', unit: '%', get: (p) => p.thermalEfficiency * 100 },
  { key: 'peak', label: 'Peak cylinder pressure', unit: 'bar', get: (p) => Math.max(...p.cylinders.map((c) => c.peakPressure), 0) },
];

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
}

/** .MRS-like text summary of a sweep. */
export function formatReport(model: EngineModel, result: SweepResult): string {
  const L: string[] = [];
  const bar = '='.repeat(78);
  L.push(bar, ' ENGINE SIMULATION RESULTS SUMMARY', bar);
  L.push(` Model: ${result.modelName || model.name}`);
  for (const t of model.title) if (t.trim()) L.push(` ${t.trim()}`);
  const cyl = model.cylinders;
  const c0 = cyl[0];
  const swept = c0 ? cyl.reduce((s, c) => s + (Math.PI / 4) * c.bore * c.bore * c.stroke, 0) / 1000 : 0;
  L.push('', ` Cycle: ${model.cycle}-stroke   Cylinders: ${cyl.length}   Swept volume: ${f(swept, 1)} cc`);
  if (c0) L.push(` Bore x stroke: ${f(c0.bore, 1)} x ${f(c0.stroke, 1)} mm   Compression ratio: ${f(c0.compressionRatio, 2)}`);
  L.push(` Fuel: ${model.fuel.type}   LHV: ${f(model.fuel.lowerHeatingValue / 1e6, 1)} MJ/kg`);
  L.push('', ' PERFORMANCE VS SPEED', ' ' + '-'.repeat(76));
  const cols = PERFORMANCE_COLUMNS.filter((c) => ['speed', 'power', 'torque', 'bmep', 'imep', 'fmep', 'pmep', 'bsfc', 've', 'eta'].includes(c.key));
  L.push(' ' + cols.map((c) => pad(c.label.length > 9 ? c.key.toUpperCase() : c.label, 9)).join(' '));
  L.push(' ' + cols.map((c) => pad(`(${c.unit})`, 9)).join(' '));
  for (const p of result.points) L.push(' ' + cols.map((c) => pad(f(c.get(p), c.key === 'speed' ? 0 : 2), 9)).join(' '));
  const best = (get: (p: TestPointResult) => number) => result.points.reduce<TestPointResult | null>((b, p) => (!b || get(p) > get(b) ? p : b), null);
  const bp = best((p) => p.power);
  const bt = best((p) => p.torque);
  const bs = result.points.reduce<TestPointResult | null>((b, p) => (p.bsfc > 0 && (!b || p.bsfc < b.bsfc) ? p : b), null);
  L.push('', ' SUMMARY', ' ' + '-'.repeat(76));
  if (bp) L.push(` Peak power:  ${f(bp.power)} kW at ${f(bp.speed, 0)} rpm`);
  if (bt) L.push(` Peak torque: ${f(bt.torque)} Nm at ${f(bt.speed, 0)} rpm`);
  if (bs) L.push(` Best BSFC:   ${f(bs.bsfc, 1)} g/kWh at ${f(bs.speed, 0)} rpm`);
  for (const p of result.points) {
    L.push('', ` TEST POINT ${f(p.speed, 0)} rpm   cycles: ${p.cycles}   ${p.converged ? 'converged' : 'NOT CONVERGED'}`);
    L.push(' ' + ['Cyl', 'IMEP', 'PMEP', 'Pmax', 'Pmax@', 'Trap(mg)', 'VE%', 'Resid%', 'Fuel(mg)'].map((h) => pad(h, 9)).join(' '));
    for (const c of p.cylinders)
      L.push(' ' + [String(c.id), f(c.imep), f(c.pmep), f(c.peakPressure, 1), f(c.peakPressureAngle, 1), f(c.trappedMass * 1e6, 1), f(c.volumetricEfficiency * 100, 1), f(c.residualFraction * 100, 1), f(c.fuelMass * 1e6, 2)].map((s) => pad(s, 9)).join(' '));
    L.push(` Air flow: ${f(p.airMassFlow * 1000, 2)} g/s   Fuel flow: ${f(p.fuelMassFlow * 1000, 3)} g/s`);
    for (const w of p.warnings) L.push(` WARNING: ${w}`);
  }
  L.push('', bar);
  return L.join('\n');
}

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Performance table as CSV: one row per speed point, header with units. */
export function resultsToCsv(result: SweepResult): string {
  const rows: string[] = [PERFORMANCE_COLUMNS.map((c) => csvCell(`${c.label} (${c.unit})`)).join(',')];
  for (const p of result.points) rows.push(PERFORMANCE_COLUMNS.map((c) => String(c.get(p))).join(','));
  return rows.join('\n') + '\n';
}

/** All crank-angle traces of one test point as CSV on a common angle column (first available angle vector). */
export function tracesToCsv(point: TestPointResult): string {
  const cols: { name: string; angle: number[]; v: number[] }[] = [];
  const t = point.traces;
  for (const c of t.cylinders) {
    const a = c.angle;
    cols.push({ name: `Cyl${c.id} pressure (bar)`, angle: a, v: c.pressure }, { name: `Cyl${c.id} temperature (K)`, angle: a, v: c.temperature },
      { name: `Cyl${c.id} volume (cc)`, angle: a, v: c.volume }, { name: `Cyl${c.id} MFB`, angle: a, v: c.massFractionBurned },
      { name: `Cyl${c.id} heat release (J/deg)`, angle: a, v: c.heatRelease }, { name: `Cyl${c.id} heat transfer (W)`, angle: a, v: c.heatTransfer },
      { name: `Cyl${c.id} intake flow (kg/s)`, angle: a, v: c.intakeMassFlow }, { name: `Cyl${c.id} exhaust flow (kg/s)`, angle: a, v: c.exhaustMassFlow },
      { name: `Cyl${c.id} intake lift (mm)`, angle: a, v: c.intakeLift }, { name: `Cyl${c.id} exhaust lift (mm)`, angle: a, v: c.exhaustLift });
  }
  for (const p of t.pipes)
    for (const loc of ['start', 'mid', 'end'] as const)
      cols.push({ name: `Pipe${p.id} ${loc} pressure (bar)`, angle: p.angle, v: p.pressure[loc] }, { name: `Pipe${p.id} ${loc} velocity (m/s)`, angle: p.angle, v: p.velocity[loc] },
        { name: `Pipe${p.id} ${loc} temperature (K)`, angle: p.angle, v: p.temperature[loc] });
  for (const p of t.plenums) cols.push({ name: `Plenum${p.id} pressure (bar)`, angle: p.angle, v: p.pressure }, { name: `Plenum${p.id} temperature (K)`, angle: p.angle, v: p.temperature });
  // Row grid: the longest angle vector; other columns are linearly resampled onto it.
  const grid = cols.reduce<number[]>((g, c) => (c.angle.length > g.length ? c.angle : g), []);
  const rows = [['Angle (deg)', ...cols.map((c) => c.name)].map(csvCell).join(',')];
  for (const a of grid) rows.push([String(a), ...cols.map((c) => String(interp(c.angle, c.v, a)))].join(','));
  return rows.join('\n') + '\n';
}

/** Linear interpolation of y(x) at xq; x ascending. Outside the range returns the end value. */
export function interp(x: number[], y: number[], xq: number): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return NaN;
  if (xq <= x[0]) return y[0];
  if (xq >= x[n - 1]) return y[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (x[m] <= xq) lo = m; else hi = m;
  }
  const t = (xq - x[lo]) / (x[hi] - x[lo] || 1);
  return y[lo] + t * (y[hi] - y[lo]);
}

export interface Spectrum {
  frequency: number[]; // Hz
  amplitude: number[]; // peak amplitude of each harmonic, signal units
  /** 20 log10(rms / 20e-6), only meaningful when the signal is in Pa. */
  spl: number[];
}

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/**
 * One-sided amplitude spectrum of a (periodic, one-cycle) signal. The signal is resampled to the next
 * power of two, mean removed, and not windowed (the trace is one whole cycle, so it is periodic).
 * Signal in Pa gives SPL re 20 uPa.
 */
export function fftSpectrum(signal: number[], sampleRateHz: number): Spectrum {
  const n0 = signal.length;
  if (n0 < 2) return { frequency: [], amplitude: [], spl: [] };
  let n = 1;
  while (n < n0) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const m = mean(signal);
  const rate = sampleRateHz * (n / n0); // resampled over the same duration
  for (let i = 0; i < n; i++) {
    const pos = (i * (n0 - 1)) / (n - 1 || 1);
    const i0 = Math.min(Math.floor(pos), n0 - 2);
    const t = pos - i0;
    re[i] = signal[i0] + t * (signal[i0 + 1] - signal[i0]) - m;
  }
  fftInPlace(re, im);
  const frequency: number[] = [], amplitude: number[] = [], spl: number[] = [];
  for (let k = 1; k <= n / 2; k++) {
    const a = (Math.hypot(re[k], im[k]) * (k === n / 2 ? 1 : 2)) / n;
    frequency.push((k * rate) / n);
    amplitude.push(a);
    spl.push(20 * Math.log10(Math.max(a / Math.SQRT2, 1e-12) / 20e-6));
  }
  return { frequency, amplitude, spl };
}
