/**
 * Compliance data in model files.
 *
 * SHARK stores bushes, spring 1, damper 1 and the roll bar rate in a COMPLIANCE section. Only one sample
 * file has one, so its layout is read as follows (per end, front then rear):
 *
 *   <number of bushes>
 *   <spring rate N/mm> <free length> <fitted length>
 *   <damper rate N.s/m>
 *   <roll bar rate N.mm/deg>
 *   then per bush:
 *   <data point index> <z-axis mode> <z-axis point index> <x-z plane mode>
 *   <kx> <ky> <kz> <krx> <kry> <krz>
 *   <x-z plane point, relative>
 *   <z-axis point, relative>
 *
 * z-axis mode 1 points at another hard point (the relative vector is then just a cached copy); otherwise a
 * non-zero relative vector is used, and a zero one means the global axes.
 *
 * Everything SHARK keeps elsewhere or Claudus adds (tyre rates, spring and damper 2, general settings, force
 * sets) goes in a CLAUDUS COMPLIANCE section. SHARK's own FORCES and FSETS sections are kept unchanged.
 */
import { sub, type Vec3 } from '../math/vec3.js';
import type { End } from '../model/types.js';
import {
  defaultCompliance, defaultEndCompliance, type AxisRef, type BushData, type ComplianceData, type EndCompliance, type ExternalForce,
} from './types.js';

export const COMPLIANCE_SECTION = 'COMPLIANCE';
export const CLAUDUS_COMPLIANCE_SECTION = 'CLAUDUS COMPLIANCE';

const nums = (line: string | undefined): number[] =>
  (line ?? '').trim() === '' ? [] : (line as string).trim().split(/\s+/).map((s) => Number(s.replace(/[dD]/, 'E')));

/** Point numbers in data-file order for each end, used to turn SHARK's indexes into point numbers. */
export interface PointOrder {
  front?: number[];
  rear?: number[];
}

/** Read SHARK's COMPLIANCE section. */
export function parseCompliance(lines: string[], order: PointOrder, into: ComplianceData = defaultCompliance()): ComplianceData {
  const rows = lines.map(nums).filter((r) => r.length);
  let i = 0;
  const next = () => {
    if (i >= rows.length) throw new Error('COMPLIANCE section ends early');
    return rows[i++];
  };
  for (const end of ['front', 'rear'] as End[]) {
    if (i >= rows.length) break;
    const no = (idx: number) => order[end]?.[idx - 1] ?? idx;
    const [count] = next();
    const e: EndCompliance = { ...defaultEndCompliance(), ...into[end] };
    const [rate, free, fitted] = next();
    e.springs = [{ rate, freeLength: free, fittedLength: fitted }, e.springs[1]];
    e.dampers = [next()[0] / 1000, e.dampers[1]];
    e.rollBarRate = next()[0];
    e.bushes = [];
    for (let k = 0; k < count; k++) {
      const [idx, zMode, zRef, xzMode] = next();
      const st = next();
      const a = next() as Vec3;
      const b = next() as Vec3;
      const zero = (v: Vec3) => v.every((x) => x === 0);
      const zAxis: AxisRef = zMode === 1 ? { kind: 'point', point: no(zRef) } : zMode === 3 ? { kind: 'abs', v: b } : zero(b) ? { kind: 'none' } : { kind: 'rel', v: b };
      const xzPlane: AxisRef = xzMode === 3 ? { kind: 'abs', v: a } : zero(a) ? { kind: 'none' } : { kind: 'rel', v: a };
      e.bushes.push({ point: no(idx), stiffness: [st[0], st[1], st[2], st[3] ?? 0, st[4] ?? 0, st[5] ?? 0], zAxis, xzPlane });
    }
    into[end] = e;
  }
  return into;
}

const f = (v: number) => {
  if (v === 0) return '0.000000E+00'.padStart(16);
  const a = Math.abs(v);
  const s = a >= 0.1 && a < 1e6 ? v.toPrecision(6) : v.toExponential(6).toUpperCase().replace(/E([+-])(\d)$/, 'E$10$2');
  return s.padStart(16);
};
const int = (v: number) => String(Math.round(v)).padStart(12);

/** Write SHARK's COMPLIANCE section body. `positions` gives each end's current points by number. */
export function complianceLines(data: ComplianceData, order: PointOrder, positions: { front?: Map<number, Vec3>; rear?: Map<number, Vec3> }): string[] {
  const out: string[] = [];
  for (const end of ['front', 'rear'] as End[]) {
    const e = data[end] ?? defaultEndCompliance();
    const idx = (no: number) => (order[end]?.indexOf(no) ?? -1) + 1 || no;
    const pos = positions[end];
    const bushes = e.bushes.filter((b) => order[end]?.includes(b.point) ?? true);
    out.push(int(bushes.length));
    const s = e.springs[0];
    out.push([s.rate, s.freeLength, s.fittedLength].map(f).join(''), f(e.dampers[0] * 1000), f(e.rollBarRate));
    for (const b of bushes) {
      const here = pos?.get(b.point) ?? [0, 0, 0];
      let zMode = 2;
      let zRef = 0;
      let zv: Vec3 = [0, 0, 0];
      if (b.zAxis.kind === 'point') {
        zMode = 1;
        zRef = idx(b.zAxis.point);
        const ref = pos?.get(b.zAxis.point);
        if (ref) zv = sub(here, ref);
      } else if (b.zAxis.kind === 'rel') zv = b.zAxis.v;
      else if (b.zAxis.kind === 'abs') {
        zMode = 3;
        zv = b.zAxis.v;
      }
      const xzMode = b.xzPlane.kind === 'abs' ? 3 : 1;
      const xv: Vec3 = b.xzPlane.kind === 'rel' || b.xzPlane.kind === 'abs' ? b.xzPlane.v : b.xzPlane.kind === 'point' ? sub(pos?.get(b.xzPlane.point) ?? here, here) : [0, 0, 0];
      out.push([idx(b.point), zMode, zRef, xzMode].map(int).join(''), b.stiffness.map(f).join(''), xv.map(f).join(''), zv.map(f).join(''));
    }
  }
  return out;
}

const KIND = ['none', 'point', 'rel', 'abs'] as const;
const refNums = (r: AxisRef): number[] =>
  r.kind === 'none' ? [0, 0, 0, 0] : r.kind === 'point' ? [1, r.point, 0, 0] : [KIND.indexOf(r.kind), ...r.v];
const numsRef = (n: number[]): AxisRef => {
  const k = KIND[n[0]] ?? 'none';
  if (k === 'point') return { kind: 'point', point: n[1] };
  if (k === 'rel' || k === 'abs') return { kind: k, v: [n[1], n[2], n[3]] };
  return { kind: 'none' };
};

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const unquote = (s: string) => s.trim().replace(/^'|'$/g, '').replace(/''/g, "'");
const num = (v: number) => ` ${String(v)}`;

/** The Claudus-only compliance data. */
export function claudusComplianceLines(data: ComplianceData): string[] {
  const s = data.settings;
  const out = [`SETTINGS${[s.singularity, s.rigid, s.rigidRotation, s.lossAngle, s.includeSpring ? 1 : 0, data.activeSet].map(num).join('')}`];
  for (const end of ['front', 'rear'] as End[]) {
    const e = data[end];
    if (!e) continue;
    const sp = e.springs[1];
    out.push(`END ${end}${[e.tyreRate, sp.rate, sp.freeLength, sp.fittedLength, e.dampers[1]].map(num).join('')}`);
    for (const b of e.bushes) {
      if (b.lossAngle !== undefined) out.push(`LOSS ${end}${num(b.point)}${num(b.lossAngle)}`);
      if (b.xzPlane.kind === 'point') out.push(`XZPOINT ${end}${num(b.point)}${num(b.xzPlane.point)}`);
    }
    for (const m of e.masses ?? [])
      out.push(`MASS ${end}${[m.part, m.mass, ...m.inertia, ...refNums(m.cog), ...refNums(m.zAxis), ...refNums(m.xzPlane)].map(num).join('')}`);
  }
  for (const fs of data.forceSets) {
    out.push(`SET ${fs.on ? 1 : 0} ${quote(fs.label)}`);
    for (const fc of fs.forces)
      out.push(`FORCE ${fc.end} ${fc.on ? 1 : 0}${[fc.part, fc.at, fc.magnitude, ...fc.head, ...fc.tail].map(num).join('')} ${quote(fc.label)}`);
  }
  data.bars?.forEach((bars, set) => {
    if (!bars) return;
    out.push(`BARSET ${set}`);
    for (const b of bars) out.push(`BAR ${set} ${b.key} ${b.limit === undefined ? '-' : b.limit} ${b.scale === undefined ? '-' : b.scale} ${b.weight}`);
  });
  return out;
}

/** Read the Claudus-only compliance data on top of what the COMPLIANCE section gave. */
export function parseClaudusCompliance(lines: string[], into: ComplianceData = defaultCompliance()): ComplianceData {
  const sets: ComplianceData['forceSets'] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const [word, ...rest] = line.split(/\s+/);
    const q = line.indexOf("'");
    const label = q >= 0 ? unquote(line.slice(q)) : '';
    const v = (q >= 0 ? line.slice(0, q) : line).trim().split(/\s+/).slice(1);
    if (word === 'SETTINGS') {
      const n = v.map(Number);
      into.settings = { singularity: n[0], rigid: n[1], rigidRotation: n[2], lossAngle: n[3], includeSpring: n[4] !== 0 };
      into.activeSet = n[5] ?? 0;
    } else if (word === 'END') {
      const end = rest[0] as End;
      const n = v.slice(1).map(Number);
      const e = (into[end] ??= defaultEndCompliance());
      e.tyreRate = n[0];
      e.springs = [e.springs[0], { rate: n[1], freeLength: n[2], fittedLength: n[3] }];
      e.dampers = [e.dampers[0], n[4]];
    } else if (word === 'LOSS' || word === 'XZPOINT') {
      const end = rest[0] as End;
      const [point, value] = v.slice(1).map(Number);
      const b = into[end]?.bushes.find((x: BushData) => x.point === point);
      if (b && word === 'LOSS') b.lossAngle = value;
      if (b && word === 'XZPOINT') b.xzPlane = { kind: 'point', point: value };
    } else if (word === 'MASS') {
      const end = rest[0] as End;
      const n = v.slice(1).map(Number);
      const e = (into[end] ??= defaultEndCompliance());
      (e.masses ??= []).push({
        part: n[0], mass: n[1], inertia: [n[2], n[3], n[4], n[5], n[6], n[7]],
        cog: numsRef(n.slice(8, 12)), zAxis: numsRef(n.slice(12, 16)), xzPlane: numsRef(n.slice(16, 20)),
      });
    } else if (word === 'BARSET') {
      (into.bars ??= [])[Number(rest[0])] = [];
    } else if (word === 'BAR') {
      const [set, key, limit, scale, weight] = rest;
      const list = ((into.bars ??= [])[Number(set)] ??= []);
      list.push({ key, ...(limit !== '-' ? { limit: Number(limit) } : {}), ...(scale !== '-' ? { scale: Number(scale) } : {}), weight: Number(weight) });
    } else if (word === 'SET') {
      sets.push({ on: v[0] !== '0', label, forces: [] });
    } else if (word === 'FORCE' && sets.length) {
      const n = v.slice(2).map(Number);
      const fc: ExternalForce = {
        end: v[0] as End, on: v[1] !== '0', part: n[0], at: n[1], magnitude: n[2],
        head: [n[3], n[4], n[5]], tail: [n[6], n[7], n[8]], label,
      };
      sets[sets.length - 1].forces.push(fc);
    }
  }
  if (sets.length) into.forceSets = sets;
  return into;
}
