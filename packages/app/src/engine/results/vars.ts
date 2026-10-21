// Pure helpers for the results viewers: variable lists, trace channels, derived functions, SPL.
import { fftSpectrum, interp, PERFORMANCE_COLUMNS, type Spectrum } from '@claudus/engine';
import type { SweepResult, TestPointResult } from '@claudus/engine';

export interface PerfVar { key: string; label: string; unit: string; get: (p: TestPointResult) => number }

/** All plottable cycle-averaged variables for a sweep: the global ones plus per-cylinder values. */
export function performanceVars(result: SweepResult | null): PerfVar[] {
  const vars: PerfVar[] = PERFORMANCE_COLUMNS.map((c) => ({ ...c }));
  const ids = new Set<number>();
  for (const p of result?.points ?? []) for (const c of p.cylinders) ids.add(c.id);
  for (const id of [...ids].sort((a, b) => a - b)) {
    const f = (g: (c: TestPointResult['cylinders'][number]) => number) => (p: TestPointResult) => {
      const c = p.cylinders.find((x) => x.id === id);
      return c ? g(c) : NaN;
    };
    vars.push(
      { key: `c${id}.imep`, label: `Cyl ${id} IMEP`, unit: 'bar', get: f((c) => c.imep) },
      { key: `c${id}.pmep`, label: `Cyl ${id} PMEP`, unit: 'bar', get: f((c) => c.pmep) },
      { key: `c${id}.pmax`, label: `Cyl ${id} peak pressure`, unit: 'bar', get: f((c) => c.peakPressure) },
      { key: `c${id}.ve`, label: `Cyl ${id} volumetric efficiency`, unit: '%', get: f((c) => c.volumetricEfficiency * 100) },
      { key: `c${id}.resid`, label: `Cyl ${id} residual fraction`, unit: '%', get: f((c) => c.residualFraction * 100) },
      { key: `c${id}.trap`, label: `Cyl ${id} trapped mass`, unit: 'mg', get: f((c) => c.trappedMass * 1e6) },
    );
  }
  return vars;
}

export interface Channel {
  key: string;
  group: string; // element name, e.g. "Cylinder 1"
  label: string; // variable label
  unit: string;
  angle: number[];
  values: number[];
}

/** All crank-angle channels of one test point. */
export function traceChannels(p: TestPointResult): Channel[] {
  const out: Channel[] = [];
  for (const c of p.traces.cylinders) {
    const g = `Cylinder ${c.id}`;
    const add = (k: string, label: string, unit: string, values: number[]) => out.push({ key: `cyl:${c.id}:${k}`, group: g, label, unit, angle: c.angle, values });
    add('pressure', 'Pressure', 'bar', c.pressure);
    add('temperature', 'Temperature', 'K', c.temperature);
    add('volume', 'Volume', 'cc', c.volume);
    add('mfb', 'Mass fraction burned', '', c.massFractionBurned);
    add('hr', 'Heat release rate', 'J/deg', c.heatRelease);
    add('ht', 'Heat transfer', 'W', c.heatTransfer);
    add('intakeLift', 'Intake valve lift', 'mm', c.intakeLift);
    add('exhaustLift', 'Exhaust valve lift', 'mm', c.exhaustLift);
    add('intakeFlow', 'Intake mass flow', 'kg/s', c.intakeMassFlow);
    add('exhaustFlow', 'Exhaust mass flow', 'kg/s', c.exhaustMassFlow);
  }
  for (const q of p.traces.pipes) {
    for (const loc of ['start', 'mid', 'end'] as const) {
      const g = `Pipe ${q.id} ${loc}`;
      out.push({ key: `pipe:${q.id}:${loc}:p`, group: g, label: 'Pressure', unit: 'bar', angle: q.angle, values: q.pressure[loc] });
      out.push({ key: `pipe:${q.id}:${loc}:u`, group: g, label: 'Velocity', unit: 'm/s', angle: q.angle, values: q.velocity[loc] });
      out.push({ key: `pipe:${q.id}:${loc}:T`, group: g, label: 'Temperature', unit: 'K', angle: q.angle, values: q.temperature[loc] });
    }
  }
  for (const q of p.traces.plenums) {
    const g = `Plenum ${q.id}`;
    out.push({ key: `plen:${q.id}:p`, group: g, label: 'Pressure', unit: 'bar', angle: q.angle, values: q.pressure });
    out.push({ key: `plen:${q.id}:T`, group: g, label: 'Temperature', unit: 'K', angle: q.angle, values: q.temperature });
  }
  return out;
}

export type Op = '+' | '-' | '*' | '/';

/** User-defined function of two traces: a op b, b resampled onto a's angles. */
export function combineChannels(a: Channel, b: Channel, op: Op): Channel {
  const values = a.angle.map((ang, i) => {
    const x = a.values[i], y = interp(b.angle, b.values, ang);
    return op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : y === 0 ? NaN : x / y;
  });
  return { key: `fn:${a.key}${op}${b.key}`, group: 'Function', label: `${a.group} ${a.label} ${op} ${b.group} ${b.label}`, unit: op === '-' || op === '+' ? a.unit : `${a.unit}${op}${b.unit}`, angle: a.angle, values };
}

/** Time for the traced cycle in seconds (angle span plus one step). */
export function cycleSeconds(angle: number[], rpm: number): number {
  if (angle.length < 2 || rpm <= 0) return NaN;
  const step = (angle[angle.length - 1] - angle[0]) / (angle.length - 1);
  return ((angle[angle.length - 1] - angle[0] + step) / 360) * (60 / rpm);
}

/** A-weighting in dB at frequency f (Hz). */
export function aWeight(f: number): number {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(Math.max(ra, 1e-12)) + 2.0;
}

export interface SplResult extends Spectrum { order: number[]; overall: number }

/** Sound pressure level spectrum from a pressure channel in bar over one cycle. */
export function splAnalysis(ch: Channel, rpm: number, weighted = false): SplResult | null {
  const T = cycleSeconds(ch.angle, rpm);
  if (!Number.isFinite(T)) return null;
  const pa = ch.values.map((v) => v * 1e5);
  const sp = fftSpectrum(pa, pa.length / T);
  const spl = weighted ? sp.spl.map((s, i) => s + aWeight(sp.frequency[i])) : sp.spl;
  const rev = rpm / 60;
  const power = spl.reduce((s, d) => s + 10 ** (d / 10), 0);
  return { ...sp, spl, order: sp.frequency.map((f) => f / rev), overall: 10 * Math.log10(power || 1e-12) };
}

/** Result point nearest in speed. */
export function nearestPoint(r: SweepResult, rpm: number): TestPointResult | null {
  let best: TestPointResult | null = null;
  for (const p of r.points) if (!best || Math.abs(p.speed - rpm) < Math.abs(best.speed - rpm)) best = p;
  return best;
}

export function download(name: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
