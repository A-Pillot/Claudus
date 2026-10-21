/**
 * Text listings of SHARK's Results menu: point coordinates (for a user position, one point at all positions,
 * all points at one position) and the bush deflection, force and rotation listings over every increment of
 * each articulation type. Coordinates are global, in mm; the compliant listings add the compliant positions
 * and their difference from the kinematic ones.
 */
import { complianceAt, endCompliance } from '../compliance/apply.js';
import { bushAxes, resolveAxisRef, type JointResult } from '../compliance/solve.js';
import type { ComplianceData } from '../compliance/types.js';
import { deg, dot, mirrorY, norm, sub, type Vec3 } from '../math/vec3.js';
import type { End, Model, VehicleParams } from '../model/types.js';
import { Corner, type Articulation, type CornerState } from '../solver/corner.js';
import { NONE } from '../template/types.js';
import { sweepRange, sweepSolve } from './derivatives.js';
import { f, sdfHeader } from './sdf.js';
import { rigidRotation, relativeRotation, type M3 } from './rotation.js';

export type Motion = 'bump' | 'roll' | 'steer';
export const MOTIONS: Motion[] = ['bump', 'roll', 'steer'];
export const MOTION_LABEL: Record<Motion, string> = { bump: 'BUMP / REBOUND TRAVEL', roll: 'ROLL', steer: 'STEER (RACK) TRAVEL' };
export const MOTION_UNIT: Record<Motion, string> = { bump: 'mm', roll: 'deg', steer: 'mm' };

/** The articulation positions of the current solver settings for a motion. */
export function motionValues(p: VehicleParams, motion: Motion): number[] {
  return motion === 'bump'
    ? sweepRange(-p.reboundTravel, p.bumpTravel, p.bumpIncrement)
    : motion === 'roll'
      ? sweepRange(-p.rollAngle, p.rollAngle, p.rollIncrement)
      : sweepRange(-p.steerTravel, p.steerTravel, p.steerIncrement);
}

export const motionArt = (motion: Motion, v: number): Articulation => (motion === 'steer' ? { rack: v } : { [motion]: v });

/** A fresh kinematic corner for an end of a model. */
export function kinematicCorner(m: Model, end: End): Corner {
  const data = m[end];
  if (!data) throw new Error(`This model has no ${end} suspension.`);
  return new Corner(data, end);
}

/** Solved states for a list of positions of one motion, keyed by position. */
function solveStates(c: Corner, motion: Motion, values: number[]): Map<number, CornerState> {
  return sweepSolve(values, (v, w) => c.solve(motionArt(motion, v), w), (st) => st);
}

/* ---------- point coordinates ---------- */

export interface PointPosition {
  no: number;
  label: string;
  /** Which wheel of a corner model: right (+Y) or its mirror image, left; empty for a full axle. */
  side: '' | 'R' | 'L';
  kin: Vec3;
  /** Compliant position, present in compliant mode. */
  comp?: Vec3;
}

/** Every point of an end at one articulation. A corner model lists the right wheel and then the left. */
export function pointPositions(c: Corner, art: Articulation, comp?: ComplianceData): PointPosition[] {
  const out: PointPosition[] = [];
  const add1 = (st: CornerState, side: PointPosition['side'], mirror: boolean) => {
    const cm = comp ? complianceAt(c, st, comp).points : undefined;
    const m = (p: Vec3) => (mirror ? mirrorY(p) : p);
    c.template.points.forEach((p, i) => {
      if (p.dummy) return;
      out.push({ no: p.no, label: p.label, side, kin: m(st.points[i]), comp: cm ? m(cm[i]) : undefined });
    });
  };
  add1(c.solve(art), c.fullAxle ? '' : 'R', false);
  // The left wheel is the mirror image of the right wheel with roll and steering reversed.
  if (!c.fullAxle) add1(c.solve({ bump: art.bump ?? 0, roll: -(art.roll ?? 0), rack: -(art.rack ?? 0) }), 'L', true);
  return out;
}

function pointTable(rows: PointPosition[], withSide: boolean, indent = 2): string[] {
  const compliant = rows.some((r) => r.comp);
  const pad = ' '.repeat(indent);
  const hd = `${pad} No ${withSide ? 'Side ' : ''}Label`.padEnd(indent + 6 + (withSide ? 5 : 0) + 34);
  const L = [hd + ['X', 'Y', 'Z'].map((a) => `${a} kin`.padStart(12)).join('') + (compliant ? ['X', 'Y', 'Z'].map((a) => `${a} comp`.padStart(12)).join('') + ['X', 'Y', 'Z'].map((a) => `${a} diff`.padStart(12)).join('') : '')];
  for (const r of rows) {
    let line = `${pad}${String(r.no).padStart(3)}  ${withSide ? r.side.padEnd(4) + ' ' : ''}${r.label.padEnd(34).slice(0, 34)}${r.kin.map((v) => f(v, 3)).join('')}`;
    if (r.comp) line += r.comp.map((v) => f(v, 3)).join('') + sub(r.comp, r.kin).map((v) => f(v, 4)).join('');
    L.push(line);
  }
  return L;
}

const posText = (motion: Motion, v: number) => `${MOTION_LABEL[motion]} ${v.toFixed(2)} ${MOTION_UNIT[motion]}`;

/** Results / List All Point Coords for User Position: a bump and steer position typed in by the user. */
export function listPointsForUserPosition(m: Model, end: End, bump: number, rack: number, comp?: ComplianceData, name = ''): string {
  const c = kinematicCorner(m, end);
  const L = sdfHeader(m, `CLAUDUS POINT COORDINATES ${comp ? '(COMPLIANT)' : '(KINEMATIC)'}`, name);
  L.push('', `  ${end.toUpperCase()} SUSPENSION    Bump ${bump.toFixed(2)} mm    Steer (rack) ${rack.toFixed(2)} mm`, '');
  L.push(...pointTable(pointPositions(c, { bump, rack }, comp), !c.fullAxle), '');
  return L.join('\n');
}

/** Results / List All Point Coords at a Position: one of the positions of the current solver settings. */
export function listPointsAtPosition(m: Model, end: End, motion: Motion, position: number, comp?: ComplianceData, name = ''): string {
  const c = kinematicCorner(m, end);
  const L = sdfHeader(m, `CLAUDUS POINT COORDINATES ${comp ? '(COMPLIANT)' : '(KINEMATIC)'}`, name);
  L.push('', `  ${end.toUpperCase()} SUSPENSION    ${posText(motion, position)}`, '');
  L.push(...pointTable(pointPositions(c, motionArt(motion, position), comp), !c.fullAxle), '');
  return L.join('\n');
}

/** Results / List a Point Coords at All Positions: one point through every position of the chosen motions. */
export function listPointAtAllPositions(m: Model, end: End, pointNo: number, motions: Motion[], comp?: ComplianceData, name = ''): string {
  const c = kinematicCorner(m, end);
  const idx = c.mech.index.get(pointNo);
  const tp = c.template.points.find((p) => p.no === pointNo);
  if (idx === undefined || !tp) throw new Error(`The ${end} suspension has no point ${pointNo}.`);
  const L = sdfHeader(m, `CLAUDUS POINT COORDINATES AT ALL POSITIONS ${comp ? '(COMPLIANT)' : '(KINEMATIC)'}`, name);
  L.push('', `  ${end.toUpperCase()} SUSPENSION    Point ${pointNo} ${tp.label}`);
  for (const motion of motions) {
    const values = motionValues(m.params, motion);
    const right = solveStates(c, motion, values);
    // Left wheel: the mirror image of the right wheel with roll and steering reversed.
    const mirrored = !c.fullAxle;
    const left = mirrored && motion !== 'bump' ? solveStates(c, motion, values.map((v) => -v).sort((a, b) => a - b)) : undefined;
    L.push('', `  ${MOTION_LABEL[motion]}`, '');
    const solved = values.filter((v) => right.has(v) && (!mirrored || (left ? left.has(-v) : true)));
    const rows = solved.flatMap((v) => {
      const rs: { v: number; row: PointPosition }[] = [];
      const one = (st: CornerState, side: PointPosition['side'], mirror: boolean) => {
        const mf = (p: Vec3) => (mirror ? mirrorY(p) : p);
        const cm = comp ? complianceAt(c, st, comp).points[idx] : undefined;
        rs.push({ v, row: { no: pointNo, label: tp.label, side, kin: mf(st.points[idx]), comp: cm ? mf(cm) : undefined } });
      };
      one(right.get(v)!, c.fullAxle ? '' : 'R', false);
      // Bump is the same on both sides; roll and steer flip.
      if (mirrored) one(left ? left.get(-v)! : right.get(v)!, 'L', true);
      return rs;
    });
    const compliant = rows.some((r) => r.row.comp);
    L.push(`  ${MOTION_UNIT[motion] === 'deg' ? 'ROLL (deg)' : motion === 'bump' ? 'BUMP (mm)' : 'RACK (mm)'}`.padEnd(14) + (c.fullAxle ? '' : 'Side ') + ['X', 'Y', 'Z'].map((a) => `${a} kin`.padStart(12)).join('') + (compliant ? ['X', 'Y', 'Z'].map((a) => `${a} comp`.padStart(12)).join('') + ['X', 'Y', 'Z'].map((a) => `${a} diff`.padStart(12)).join('') : ''));
    for (const { v, row } of rows)
      L.push(`  ${v.toFixed(2).padStart(10)}  ${c.fullAxle ? '' : row.side.padEnd(4) + ' '}${row.kin.map((x) => f(x, 3)).join('')}${row.comp ? row.comp.map((x) => f(x, 3)).join('') + sub(row.comp, row.kin).map((x) => f(x, 4)).join('') : ''}`);
  }
  L.push('');
  return L.join('\n');
}

/* ---------- joint and bush results ---------- */

export interface JointRotation {
  point: number;
  /** Rotation of part 1 relative to part 2 since the static position, deg, global and in the joint's own axes. */
  global: Vec3;
  local: Vec3;
}

export interface JointIncrement {
  x: number;
  joints: JointResult[];
  rotations: JointRotation[];
}

/** Rotations of every part of a state from the static position, indexed by part number - 1. */
function partRotations(c: Corner, staticPts: Vec3[], pts: Vec3[]): M3[] {
  const t = c.template;
  return t.parts.map((_, k) => {
    const idx = t.points.map((p, i) => (p.part1 === k + 1 || p.part2 === k + 1 ? i : -1)).filter((i) => i >= 0);
    return rigidRotation(idx.map((i) => staticPts[i]), idx.map((i) => pts[i]));
  });
}

const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Kinematic rotation of each joint of a state, relative to the static position. */
export function jointRotations(c: Corner, comp: ComplianceData | undefined, staticPts: Vec3[], st: CornerState): JointRotation[] {
  const t = c.template;
  const parts = partRotations(c, staticPts, st.points);
  const bushes = new Map(endCompliance(comp, c.end).bushes.map((b) => [b.point, b]));
  const byNo = (no: number) => {
    const i = c.mech.index.get(no);
    return i === undefined ? undefined : st.points[i];
  };
  const out: JointRotation[] = [];
  t.points.forEach((p, i) => {
    if (p.dummy || p.part1 === NONE || p.part2 === NONE) return;
    const R1 = p.part1 > 0 ? parts[p.part1 - 1] : I3;
    const R2 = p.part2 > 0 ? parts[p.part2 - 1] : I3;
    const w = relativeRotation(R1, R2);
    const b = bushes.get(p.no);
    const axes = b ? bushAxes(st.points[i], resolveAxisRef(b.zAxis, st.points[i], byNo), resolveAxisRef(b.xzPlane, st.points[i], byNo)) : undefined;
    const local: Vec3 = axes ? [dot(axes[0], w), dot(axes[1], w), dot(axes[2], w)] : w;
    out.push({ point: p.no, global: w.map(deg) as Vec3, local: local.map(deg) as Vec3 });
  });
  return out;
}

/** Joint deflections, forces and rotations at every increment of one motion, for the right-hand corner. */
export function jointSeries(m: Model, end: End, motion: Motion, comp: ComplianceData): JointIncrement[] {
  const c = kinematicCorner(m, end);
  const staticPts = c.solve({}).points;
  const values = motionValues(m.params, motion);
  const states = solveStates(c, motion, values);
  return values.filter((x) => states.has(x)).map((x) => {
    const st = states.get(x)!;
    return { x, joints: complianceAt(c, st, comp).joints, rotations: jointRotations(c, comp, staticPts, st) };
  });
}

export type JointListing = 'deflection' | 'force' | 'rotation';

const TITLE: Record<JointListing, string> = {
  deflection: 'CLAUDUS BUSH DEFLECTIONS (mm)',
  force: 'CLAUDUS BUSH FORCES (N)',
  rotation: 'CLAUDUS JOINT / BUSH ROTATIONS (deg)',
};

/**
 * Results / List Bush Deflections, Joint/Bush Rotations and Bush Forces: a block per increment for each
 * articulation type. Deflections list bushed joints only; forces and rotations list every joint.
 */
export function listJointResults(m: Model, end: End, kind: JointListing, comp: ComplianceData, motions: Motion[] = MOTIONS, name = ''): string {
  const c = kinematicCorner(m, end);
  const label = (no: number) => c.template.points.find((p) => p.no === no)?.label ?? '';
  const prefix = kind === 'force' ? 'F' : kind === 'deflection' ? 'D' : 'R';
  const L = sdfHeader(m, TITLE[kind], name);
  L.push('', `  ${end.toUpperCase()} SUSPENSION (right-hand corner)    Force set: ${comp.forceSets[comp.activeSet]?.label ?? '-'}`);
  L.push(kind === 'rotation' ? '  Rotation of part 1 relative to part 2 from the static position; the rotations due to compliance are not included.' : '  Components in global axes and in each joint\'s local axes.');
  for (const motion of motions) {
    const series = jointSeries(m, end, motion, comp);
    L.push('', '='.repeat(110), `  ${MOTION_LABEL[motion]}`, '='.repeat(110));
    for (const inc of series) {
      L.push('', `  ${motion === 'bump' ? 'Bump' : motion === 'roll' ? 'Roll' : 'Rack'} ${inc.x.toFixed(2)} ${MOTION_UNIT[motion]}`);
      L.push(`   No  Label                               ${['X', 'Y', 'Z'].map((a) => `${prefix}${a} Global`.padStart(12)).join('')}${['X', 'Y', 'Z'].map((a) => `${prefix}${a} Local`.padStart(12)).join('')}`);
      const rows: { no: number; g: Vec3; l: Vec3 }[] = [];
      if (kind === 'rotation') for (const r of inc.rotations) rows.push({ no: r.point, g: r.global, l: r.local });
      else
        for (const j of inc.joints) {
          if (kind === 'deflection' && !j.bushed) continue;
          rows.push(kind === 'deflection' ? { no: j.point, g: j.deflection, l: j.deflectionLocal } : { no: j.point, g: j.force, l: j.forceLocal });
        }
      const d = kind === 'force' ? 1 : 4;
      for (const r of rows) L.push(`  ${String(r.no).padStart(3)}  ${label(r.no).padEnd(34).slice(0, 34)}${r.g.map((v) => f(v, d)).join('')}${r.l.map((v) => f(v, d)).join('')}`);
      if (!rows.length) L.push('       (no bushed joints)');
    }
  }
  L.push('');
  return L.join('\n');
}

/* ---------- ball joint rotations ---------- */

export type RotationFrame = 'global' | 'local' | 'lines';

export interface BallJointOptions {
  point: number;
  motion: Motion;
  frame: RotationFrame;
  /** For the 'lines' frame: the housing axis (two point numbers) and the ball axis (two point numbers). */
  housing?: [number, number];
  ball?: [number, number];
}

export interface BallJointSeries {
  x: number[];
  /** One value per axis (X, Y, Z) per increment, deg; for the 'lines' frame a single angle change. */
  series: { label: string; y: number[] }[];
}

/** Results / Ball Joint Rotations: the rotation of one joint over the travel of a motion. */
export function ballJointSeries(m: Model, end: End, comp: ComplianceData, o: BallJointOptions): BallJointSeries {
  const c = kinematicCorner(m, end);
  const values = motionValues(m.params, o.motion);
  if (o.frame === 'lines') {
    const states = solveStates(c, o.motion, values);
    const at = (st: CornerState, no: number) => st.points[c.mech.index.get(no) ?? -1];
    if (!o.housing || !o.ball) return { x: values, series: [] };
    const angle = (st: CornerState) => {
      const a = sub(at(st, o.housing![1]), at(st, o.housing![0]));
      const b = sub(at(st, o.ball![1]), at(st, o.ball![0]));
      return deg(Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))));
    };
    const a0 = angle(c.solve({}));
    const solved = values.filter((v) => states.has(v));
    return { x: solved, series: [{ label: 'Angle between axes change', y: solved.map((v) => angle(states.get(v)!) - a0) }] };
  }
  const inc = jointSeries(m, end, o.motion, comp);
  const pick = (i: JointIncrement) => i.rotations.find((r) => r.point === o.point);
  return {
    x: inc.map((i) => i.x),
    series: ['X', 'Y', 'Z'].map((a, k) => ({ label: `${a} rotation`, y: inc.map((i) => (pick(i)?.[o.frame === 'local' ? 'local' : 'global'] ?? [NaN, NaN, NaN])[k]) })),
  };
}
