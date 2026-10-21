/** Formatted Suspension Derivative File (SDF) listing, laid out like SHARK's "List SDF" window. */
import type { Model } from '../model/types.js';
import type { EndAnalysis } from './derivatives.js';
import { dataPoints } from '../template/types.js';

const f = (v: number, d = 4, w = 12) => (Number.isFinite(v) ? v.toFixed(d) : '-').padStart(w);

function table(title: string, cols: { head: string[]; get: (r: any) => number; d?: number }[], rows: any[]): string[] {
  const out = ['', `  ${title}`, ''];
  const nHead = Math.max(...cols.map((c) => c.head.length));
  for (let i = 0; i < nHead; i++) out.push(cols.map((c) => (c.head[i] ?? '').padStart(12)).join(''));
  out.push('');
  for (const r of rows) out.push(cols.map((c) => f(c.get(r), c.d ?? 4)).join(''));
  return out;
}

export function formatSdf(m: Model, results: EndAnalysis[], name = ''): string {
  const L: string[] = [];
  L.push('CLAUDUS SUSPENSION DERIVATIVE FILE', name ? `Model: ${name}` : '', '');
  const p = m.params;
  L.push('GENERAL DATA');
  L.push(`  Wheelbase ${p.wheelbase} mm   C of G height ${p.cogHeight} mm   Braking on front ${p.brakeFrontPct} %   Drive on front ${p.driveFrontPct} %   Weight on front ${p.weightFrontPct} %`);
  for (const a of results) {
    const t = a.corner.template;
    const END = a.end.toUpperCase();
    const data = m[a.end]!;
    L.push('', '='.repeat(96), `${END} SUSPENSION    TYPE ${t.slot} ${t.label}`, '='.repeat(96), '', '  HARD POINTS (right-hand side)', '');
    L.push('   No  Label                                            X            Y            Z');
    dataPoints(t).forEach((tp, i) => {
      const q = data.points[i] ?? tp.def;
      L.push(`  ${String(tp.no).padStart(3)}  ${tp.label.padEnd(42).slice(0, 42)}${f(q[0], 2, 13)}${f(q[1], 2, 13)}${f(q[2], 2, 13)}`);
    });
    L.push(`       Rolling radius ${data.rollingRadius} mm`);
    const s = a.statics;
    L.push('', '  STATIC VALUES', '');
    const sv: [string, number][] = [
      ['Camber angle (deg)', s.camber],
      ['Toe angle, SAE (deg, +ve toe in)', s.toeSae],
      ['Toe angle, plane of wheel (deg)', s.toePlane],
      ['Castor angle (deg)', s.castor],
      ['Castor trail, hub trail (mm)', s.castorTrail],
      ['Castor offset (mm)', s.castorOffset],
      ['Kingpin angle (deg)', s.kingpin],
      ['Kingpin offset, at wheel (mm)', s.kingpinOffsetWheel],
      ['Kingpin offset, at ground (mm)', s.kingpinOffsetGround],
      ['Mechanical trail (mm)', s.mechanicalTrail],
      ['Roll centre height (mm)', s.rollCentreHeight],
    ];
    for (const [k, v] of sv) L.push(`    ${k.padEnd(40)}${f(v)}`);

    L.push(...table(`${END} SUSPENSION - BUMP TRAVEL`, [
      { head: ['BUMP', 'TRAVEL', '(mm)'], get: (r) => r.bump, d: 2 },
      { head: ['CAMBER', 'ANGLE', '(deg)'], get: (r) => r.camber },
      { head: ['TOE', 'ANGLE', '(deg)'], get: (r) => r.toeSae },
      { head: ['CASTOR', 'ANGLE', '(deg)'], get: (r) => r.castor },
      { head: ['KINGPIN', 'ANGLE', '(deg)'], get: (r) => r.kingpin },
      { head: ['DAMPER', 'RATIO'], get: (r) => r.damperRatio, d: 3 },
      { head: ['SPRING', 'RATIO'], get: (r) => r.springRatio, d: 3 },
      { head: ['ANTI', 'DIVE', '(%)'], get: (r) => r.antiDive, d: 2 },
      { head: ['ANTI', 'SQUAT', '(%)'], get: (r) => r.antiSquat, d: 2 },
    ], a.bump));
    L.push(...table(`${END} SUSPENSION - BUMP TRAVEL (continued)`, [
      { head: ['BUMP', 'TRAVEL', '(mm)'], get: (r) => r.bump, d: 2 },
      { head: ['RC HEIGHT', 'TO BODY', '(mm)'], get: (r) => r.rollCentreToBody, d: 2 },
      { head: ['RC HEIGHT', 'TO GROUND', '(mm)'], get: (r) => r.rollCentreToGround, d: 2 },
      { head: ['HALF TRACK', 'CHANGE', '(mm)'], get: (r) => r.halfTrackChange, d: 3 },
      { head: ['WHEELBASE', 'CHANGE', '(mm)'], get: (r) => r.wheelbaseChange, d: 3 },
      { head: ['DAMPER', 'TRAVEL', '(mm)'], get: (r) => r.damperTravel, d: 3 },
      { head: ['SPRING', 'TRAVEL', '(mm)'], get: (r) => r.springTravel, d: 3 },
    ], a.bump));
    L.push(...table(`${END} SUSPENSION - ROLL`, [
      { head: ['ROLL', 'ANGLE', '(deg)'], get: (r) => r.roll, d: 2 },
      { head: ['CAMBER', 'ANGLE', '(deg)'], get: (r) => r.camber },
      { head: ['TOE', 'ANGLE', '(deg)'], get: (r) => r.toeSae },
      { head: ['CASTOR', 'ANGLE', '(deg)'], get: (r) => r.castor },
      { head: ['KINGPIN', 'ANGLE', '(deg)'], get: (r) => r.kingpin },
      { head: ['DAMPER', 'RATIO'], get: (r) => r.damperRatio, d: 3 },
      { head: ['SPRING', 'RATIO'], get: (r) => r.springRatio, d: 3 },
    ], a.roll));
    L.push(...table(`${END} SUSPENSION - ROLL (continued)`, [
      { head: ['ROLL', 'ANGLE', '(deg)'], get: (r) => r.roll, d: 2 },
      { head: ['RC POS', 'X', '(mm)'], get: (r) => r.rollCentre[0], d: 2 },
      { head: ['RC POS', 'Y', '(mm)'], get: (r) => r.rollCentre[1], d: 2 },
      { head: ['RC POS', 'Z', '(mm)'], get: (r) => r.rollCentre[2], d: 2 },
      { head: ['HALF TRACK', 'CHANGE', '(mm)'], get: (r) => r.halfTrackChange, d: 3 },
      { head: ['WHEELBASE', 'CHANGE', '(mm)'], get: (r) => r.wheelbaseChange, d: 3 },
      { head: ['DAMPER', 'TRAVEL', '(mm)'], get: (r) => r.damperTravel, d: 3 },
      { head: ['SPRING', 'TRAVEL', '(mm)'], get: (r) => r.springTravel, d: 3 },
    ], a.roll));
    if (a.steer.length)
      L.push(...table(`${END} SUSPENSION - STEER`, [
        { head: ['RACK', 'TRAVEL', '(mm)'], get: (r) => r.rack, d: 2 },
        { head: ['TOE ANGLE', 'INNER', '(deg)'], get: (r) => r.toeInner },
        { head: ['TOE ANGLE', 'OUTER', '(deg)'], get: (r) => r.toeOuter },
        { head: ['CAMBER', 'INNER', '(deg)'], get: (r) => r.camberInner },
        { head: ['CAMBER', 'OUTER', '(deg)'], get: (r) => r.camberOuter },
        { head: ['ACKERMANN', '(%)'], get: (r) => r.ackermann, d: 2 },
        { head: ['TURNING', 'RADIUS', '(mm)'], get: (r) => r.turningRadius, d: 0 },
      ], a.steer));
  }
  L.push('');
  return L.join('\n');
}
