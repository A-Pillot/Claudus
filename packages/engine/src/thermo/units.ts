// Unit helpers: model units (mm, cc, bar, deg) <-> SI.
export const barToPa = (b: number): number => b * 1e5;
export const paToBar = (p: number): number => p * 1e-5;
export const mmToM = (x: number): number => x * 1e-3;
export const mToMm = (x: number): number => x * 1e3;
export const mm2ToM2 = (x: number): number => x * 1e-6;
export const m2ToMm2 = (x: number): number => x * 1e6;
export const ccToM3 = (x: number): number => x * 1e-6;
export const m3ToCc = (x: number): number => x * 1e6;
export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;
/** Crank angular speed, rad/s. */
export const rpmToRadS = (rpm: number): number => (rpm * 2 * Math.PI) / 60;
/** Wrap an angle into [0, cycle). */
export const wrapAngle = (a: number, cycle: number): number => {
  const w = a % cycle;
  return w < 0 ? w + cycle : w;
};
