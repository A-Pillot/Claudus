// Small fake SweepResult generator for development and tests, until the solver exists.
import type { CylinderTrace, PipeTrace, PlenumTrace, SweepResult, TestPointResult } from '@claudus/engine';

const rad = (d: number) => (d * Math.PI) / 180;

export function sampleTestPoint(speed: number, cylinders = 4, step = 2): TestPointResult {
  const angle: number[] = [];
  for (let a = 0; a < 720; a += step) angle.push(a);
  const load = 1 - Math.pow((speed - 5500) / 5000, 2) * 0.5;
  const cyls: CylinderTrace[] = [];
  const summaries = [];
  for (let c = 1; c <= cylinders; c++) {
    const shift = ((c - 1) * 720) / cylinders;
    const a = angle.map((x) => (x + shift) % 720);
    const lift = (open: number, close: number) => a.map((x) => (x > open && x < close ? 9 * Math.sin((Math.PI * (x - open)) / (close - open)) ** 2 : 0));
    const pressure = a.map((x) => {
      const comp = 1 + 14 * Math.exp(-(((x - 360) / 70) ** 2)) * 0.9;
      const burn = 45 * load * Math.exp(-(((x - 375) / 18) ** 2));
      return (x > 180 && x < 540 ? comp + burn : 1.2 + 0.3 * Math.sin(rad(x * 2))) ;
    });
    const mfb = a.map((x) => (x < 355 ? 0 : x > 410 ? 1 : 1 - Math.exp(-5 * ((x - 355) / 55) ** 3)));
    cyls.push({
      id: c, angle: a,
      pressure,
      temperature: pressure.map((p) => 300 + 90 * p),
      volume: a.map((x) => 50 + 250 * (0.5 - 0.5 * Math.cos(rad(x - 360)))),
      massFractionBurned: mfb,
      heatRelease: mfb.map((m, i) => (i ? (m - mfb[i - 1]) * 700 / step : 0)),
      heatTransfer: pressure.map((p) => 20 * p),
      intakeMassFlow: lift(0, 240).map((l) => l * 0.004),
      exhaustMassFlow: lift(480, 720).map((l) => l * 0.003),
      intakeLift: lift(0, 240), exhaustLift: lift(480, 720),
    });
    summaries.push({ id: c, imep: 12 * load, pmep: -0.3, peakPressure: Math.max(...pressure), peakPressureAngle: 15, trappedMass: 4e-4, volumetricEfficiency: 0.85 * load, residualFraction: 0.05, fuelMass: 2.7e-5 });
  }
  const wave = (ph: number, amp: number, base: number) => angle.map((x) => base + amp * Math.sin(rad(x * 2 * (speed / 6000) + ph)) + 0.3 * amp * Math.sin(rad(x * 6 + ph)));
  const pipes: PipeTrace[] = [1, 2].map((id) => ({
    id, angle,
    pressure: { start: wave(0, 0.15, 1), mid: wave(30, 0.12, 1), end: wave(60, 0.1, 1) },
    velocity: { start: wave(10, 40, 0), mid: wave(40, 30, 0), end: wave(70, 25, 0) },
    temperature: { start: wave(0, 20, 320), mid: wave(30, 15, 320), end: wave(60, 10, 320) },
  }));
  const plenums: PlenumTrace[] = [{ id: 1, angle, pressure: wave(0, 0.03, 0.98), temperature: wave(0, 2, 300) }];
  const bmep = 11 * load, power = (bmep * speed * 1.6 * 1e-1) / 1200;
  return {
    speed, cycles: 8, converged: true,
    imep: 12.4 * load, fmep: 1.2 + speed / 10000, bmep, power, torque: (power * 9549) / speed,
    bsfc: 250 + Math.pow((speed - 4500) / 2000, 2) * 40, volumetricEfficiency: 0.85 * load, airMassFlow: speed * 2e-5 * load,
    fuelMassFlow: speed * 1.4e-6 * load, thermalEfficiency: 0.32 * load, cylinders: summaries,
    traces: { cylinders: cyls, pipes, plenums }, warnings: [],
  };
}

export function sampleSweep(modelName = 'Sample', speeds = [2000, 3000, 4000, 5000, 6000, 7000], scale = 1): SweepResult {
  const points = speeds.map((s) => {
    const p = sampleTestPoint(s);
    p.power *= scale; p.torque *= scale; p.bmep *= scale;
    return p;
  });
  return { modelName, points };
}
