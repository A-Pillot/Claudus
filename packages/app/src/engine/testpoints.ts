// Test point helpers: default points, speed-sweep wizard, firing order.
import type { EngineModel, TestPoint } from '@claudus/engine';

export function defaultTestPoint(speed = 3000): TestPoint {
  return { label: `${speed} rpm`, speed, afr: 13, burnStart: -20, burnDuration: 50, ambientPressure: 1.013, ambientTemperature: 293, maxCycles: 10, tolerance: 0.01 };
}

/** Test points from `from` to `to` rpm in steps of `step`, copying the other settings from `base`. */
export function speedSweep(base: TestPoint, from: number, to: number, step: number): TestPoint[] {
  if (!(step > 0) || !(from > 0) || to < from) return [];
  const out: TestPoint[] = [];
  for (let s = from, n = 0; s <= to + 1e-9 && n < 200; s += step, n++) {
    out.push({ ...base, throttle: base.throttle ? { ...base.throttle } : undefined, label: `${Math.round(s)} rpm`, speed: Math.round(s) });
  }
  return out;
}

export interface FiringEntry { order: number; id: number; label: string; angle: number; interval: number }

/** Cylinders in firing order with the angle since the previous firing (wraps over the cycle). */
export function firingOrder(model: EngineModel): FiringEntry[] {
  const period = model.cycle * 180;
  const norm = (a: number) => ((a % period) + period) % period;
  const sorted = [...model.cylinders].map((c) => ({ c, a: norm(c.firingAngle) })).sort((x, y) => x.a - y.a);
  return sorted.map((s, i) => {
    const prev = sorted[(i + sorted.length - 1) % sorted.length].a;
    return { order: i + 1, id: s.c.id, label: s.c.label, angle: s.a, interval: sorted.length === 1 ? period : norm(s.a - prev) || (sorted.length === 1 ? period : 0) };
  });
}

/** Even firing angles for n cylinders in the stated order (cylinder ids listed in firing sequence). */
export function evenFiring(model: EngineModel, order: number[]): void {
  const period = model.cycle * 180;
  order.forEach((id, i) => {
    const c = model.cylinders.find((x) => x.id === id);
    if (c) c.firingAngle = (i * period) / order.length;
  });
}

/** Set every pipe's mesh length from a target (mm), but not longer than half the pipe. */
export function autoMesh(model: EngineModel, target: number): void {
  for (const p of model.pipes) p.meshLength = Math.max(1, Math.min(target, Math.round((p.length / 2) * 10) / 10));
}
