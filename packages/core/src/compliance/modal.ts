/**
 * Modal analysis and forced-damped response of a compliant corner, as in SHARK's compliant mode.
 *
 * Units: K in N/mm (N.mm/rad for rotations), masses in kg, inertias in kg.mm², dampers in N.s/mm. With
 * motions in mm and rad the dynamic stiffness is K - ω²M/1000 + iωC + iK_loss.
 */
import { add, cross, dist, scale, sub, type Vec3 } from '../math/vec3.js';
import { solveLinear } from '../math/linalg.js';
import { generalizedEigen, solveComplex } from '../math/eigen.js';
import type { Corner, CornerState } from '../solver/corner.js';
import { GROUND, NONE } from '../template/types.js';
import { forcesFor, endCompliance } from './apply.js';
import { buildCompliance, bushAxes, pointMotion, type ComplianceModel } from './solve.js';
import type { AxisRef, ComplianceData, EndCompliance, PartMass } from './types.js';

/** A part's mass properties with the defaults filled in, in global terms. */
export interface ResolvedMass {
  part: number;
  mass: number;
  cog: Vec3;
  /** Inertia tensor about the C of G in global axes, kg.mm². */
  J: [Vec3, Vec3, Vec3];
  /** True when the part had no mass data and got the default. */
  isDefault: boolean;
}

export const DEFAULT_PART_MASS = 1; // kg, SHARK's default

function resolveRef(ref: AxisRef, origin: Vec3, byNo: (no: number) => Vec3 | undefined): Vec3 | undefined {
  if (ref.kind === 'point') return byNo(ref.point);
  if (ref.kind === 'rel') return add(origin, ref.v);
  if (ref.kind === 'abs') return ref.v;
  return undefined;
}

/** Every part's mass, C of G and global inertia at a kinematic state. */
export function resolveMasses(c: Corner, st: CornerState, data: EndCompliance, centroid: Vec3[]): ResolvedMass[] {
  const t = c.template;
  const byNo = (no: number) => {
    const i = c.mech.index.get(no);
    return i === undefined ? undefined : st.points[i];
  };
  const given = new Map((data.masses ?? []).map((m) => [m.part, m]));
  return t.parts.map((_, b) => {
    const part = b + 1;
    const m: PartMass | undefined = given.get(part);
    if (m) {
      const cog = resolveRef(m.cog, centroid[b], byNo) ?? centroid[b];
      const R = bushAxes(cog, resolveRef(m.zAxis, cog, byNo), resolveRef(m.xzPlane, cog, byNo));
      const [ixx, iyy, izz, ixy, ixz, iyz] = m.inertia;
      const Jl: [Vec3, Vec3, Vec3] = [[ixx, ixy, ixz], [ixy, iyy, iyz], [ixz, iyz, izz]];
      // J = Rᵀ Jl R
      const J = [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
        let s = 0;
        for (let a = 0; a < 3; a++) for (let k = 0; k < 3; k++) s += R[a][i] * Jl[a][k] * R[k][j];
        return s;
      })) as [Vec3, Vec3, Vec3];
      return { part, mass: m.mass, cog, J, isDefault: false };
    }
    // Default: 1 kg at the centroid, inertia of a ball the size of the part (at least 25 mm radius of gyration).
    const pts = t.points.map((p, i) => (p.part1 === part || p.part2 === part ? st.points[i] : undefined)).filter((p): p is Vec3 => !!p);
    const size = Math.max(0, ...pts.map((p) => dist(p, centroid[b])));
    const rg = Math.max(25, size / 2);
    const I = DEFAULT_PART_MASS * rg * rg;
    return { part, mass: DEFAULT_PART_MASS, cog: centroid[b], J: [[I, 0, 0], [0, I, 0], [0, 0, I]], isDefault: true };
  });
}

/** Mass matrix in the compliance model's coordinates (body motions about each centroid). */
export function massMatrix(model: ComplianceModel, masses: ResolvedMass[]): number[][] {
  const M = Array.from({ length: model.n }, () => new Array(model.n).fill(0));
  masses.forEach((m, b) => {
    const G = model.G(b, m.cog);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        let v = 0;
        for (let a = 0; a < 3; a++) v += m.mass * G[a][i] * G[a][j];
        if (i >= 3 && j >= 3) v += m.J[i - 3][j - 3];
        M[6 * b + i][6 * b + j] += v;
      }
  });
  return M;
}

export interface Mode {
  /** Natural frequency, Hz. */
  frequency: number;
  /** Mass-normalised mode shape in body motions. */
  shape: number[];
}

export interface ModalResult {
  modes: Mode[];
  model: ComplianceModel;
  masses: ResolvedMass[];
}

const settingsOf = (data: ComplianceData) => data.settings;

/** Natural frequencies and mode shapes at a kinematic state, lowest first. */
export function modalAnalysis(c: Corner, st: CornerState, data: ComplianceData): ModalResult {
  const end = endCompliance(data, c.end);
  const model = buildCompliance(c, st, end, { settings: settingsOf(data), includeSpring: false });
  const masses = resolveMasses(c, st, end, model.centroid);
  const M = massMatrix(model, masses);
  const { values, vectors } = generalizedEigen(model.K, M);
  const modes = values.map((lam, i) => ({ frequency: Math.sqrt(Math.max(0, 1000 * lam)) / (2 * Math.PI), shape: vectors[i] }));
  return { modes, model, masses };
}

/** Template point positions displaced by a motion vector times a scale. */
export function displacedPoints(c: Corner, st: CornerState, model: ComplianceModel, q: number[], scaleBy = 1): Vec3[] {
  return c.template.points.map((p, i) => {
    const b = model.body(p.part1 === GROUND || p.part1 === NONE ? p.part2 : p.part1);
    return add(st.points[i], scale(pointMotion(model, q, b, st.points[i]), scaleBy));
  });
}

export interface PartResponse {
  part: number;
  /** Amplitude of the C of G translation in x, y, z (mm) and rotation about x, y, z (deg). */
  amplitude: [number, number, number, number, number, number];
  /** Phase of each component, deg. */
  phase: [number, number, number, number, number, number];
}

export interface ForcedResponse {
  frequency: number;
  /** Complex body motions. */
  re: number[];
  im: number[];
  parts: PartResponse[];
}

export interface ForcedSetup {
  model: ComplianceModel;
  M: number[][];
  masses: ResolvedMass[];
}

/** Build what a forced-damped sweep needs once, for the active force set (and spring force when set). */
export function forcedSetup(c: Corner, st: CornerState, data: ComplianceData, set = data.activeSet): ForcedSetup {
  const end = endCompliance(data, c.end);
  const model = buildCompliance(c, st, end, { settings: data.settings, forces: forcesFor(data, c.end, set) });
  const masses = resolveMasses(c, st, end, model.centroid);
  return { model, M: massMatrix(model, masses), masses };
}

/** Steady-state response at one frequency (Hz) to the set's forces applied harmonically. */
export function forcedResponseAt(s: ForcedSetup, frequency: number): ForcedResponse {
  const { model, M, masses } = s;
  const w = 2 * Math.PI * frequency;
  const n = model.n;
  const A = model.K.map((row, i) => row.map((k, j) => k - (w * w * M[i][j]) / 1000));
  const B = model.C.map((row, i) => row.map((cv, j) => w * cv + model.Kloss[i][j]));
  const x = solveComplex(A, B, model.F, new Array(n).fill(0), solveLinear) ?? { re: new Array(n).fill(0), im: new Array(n).fill(0) };
  const parts = masses.map((m, b): PartResponse => {
    // C of G motion: translation plus rotation × offset, for the real and imaginary parts.
    const at = (q: number[]) => {
      const o = 6 * b;
      const r = sub(m.cog, model.centroid[b]);
      const tr = add([q[o], q[o + 1], q[o + 2]], cross([q[o + 3], q[o + 4], q[o + 5]], r));
      return [...tr, q[o + 3], q[o + 4], q[o + 5]];
    };
    const re = at(x.re);
    const im = at(x.im);
    const toDeg = (k: number) => (k >= 3 ? 180 / Math.PI : 1);
    return {
      part: m.part,
      amplitude: re.map((r, k) => Math.hypot(r, im[k]) * toDeg(k)) as PartResponse['amplitude'],
      phase: re.map((r, k) => (Math.atan2(im[k], r) * 180) / Math.PI) as PartResponse['phase'],
    };
  });
  return { frequency, re: x.re, im: x.im, parts };
}

/** Forced-damped response over a frequency range (SHARK's speed sweep display). */
export function forcedSweep(c: Corner, st: CornerState, data: ComplianceData, frequencies: number[], set = data.activeSet): ForcedResponse[] {
  const s = forcedSetup(c, st, data, set);
  return frequencies.map((f) => forcedResponseAt(s, f));
}

/** The response's displacement at a phase angle (deg), for animating it. */
export const responseAtPhase = (r: ForcedResponse, phaseDeg: number): number[] => {
  const p = (phaseDeg * Math.PI) / 180;
  return r.re.map((x, i) => x * Math.cos(p) - r.im[i] * Math.sin(p));
};
