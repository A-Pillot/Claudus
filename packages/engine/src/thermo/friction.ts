import type { FrictionModel } from '../model';

/** Chen-Flynn FMEP in bar: a + b*pmax(bar) + c*Sp + d*Sp^2 (Sp m/s). */
export function chenFlynnFmep(f: FrictionModel, pmaxBar: number, meanPistonSpeed: number): number {
  return f.a + f.b * pmaxBar + f.c * meanPistonSpeed + f.d * meanPistonSpeed * meanPistonSpeed;
}

export function defaultFriction(): FrictionModel {
  return { a: 0.4, b: 0.005, c: 0.09, d: 0.0009 };
}
