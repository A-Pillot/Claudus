/**
 * Combined motion profile and extended bump list: defaults, text layout of the COMBINED and EXTENDED BUMP
 * file sections, and the bump positions a sweep runs through.
 *
 * The layout is read strictly (the sample files have neither section). A section that does not match is
 * kept as raw text and written back unchanged.
 *   COMBINED:       N, then N lines of "bump rack".
 *   EXTENDED BUMP:  "use N", then N lines of "bump label".
 */
import type { CombinedProfile, ExtendedBump, VehicleParams } from './types.js';

const num = (s: string) => Number(s.replace(/[dD]/, 'E'));
const isNum = (s: string) => s !== '' && Number.isFinite(num(s));
const words = (l: string) => l.trim().split(/\s+/).filter((w) => w !== '');
const fmt = (v: number) => String(v).padStart(16);

/** A path that sweeps the bump and steer limits: out to full bump, round the lock range, and back. */
export function defaultCombined(p: VehicleParams): CombinedProfile {
  const b = p.bumpTravel;
  const r = -p.reboundTravel;
  const s = p.steerTravel;
  const pts: [number, number][] = [[0, 0], [b, 0], [b, s], [0, s], [r, s], [r, 0], [r, -s], [0, -s], [b, -s], [b, 0], [0, 0]];
  return { steps: pts.map(([bump, rack]) => ({ bump, rack })) };
}

export function parseCombined(lines: string[] | undefined): CombinedProfile | undefined {
  if (!lines) return undefined;
  const rows = lines.filter((l) => l.trim() !== '').map(words);
  if (!rows.length || rows[0].length !== 1 || !/^[0-9]+$/.test(rows[0][0])) return undefined;
  const n = Number(rows[0][0]);
  if (rows.length !== n + 1) return undefined;
  const steps = [];
  for (const r of rows.slice(1)) {
    if (r.length !== 2 || !r.every(isNum)) return undefined;
    steps.push({ bump: num(r[0]), rack: num(r[1]) });
  }
  return { steps };
}

export const combinedLines = (c: CombinedProfile): string[] => [
  String(c.steps.length).padStart(13),
  ...c.steps.map((s) => fmt(s.bump) + fmt(s.rack)),
];

export function parseExtendedBump(lines: string[] | undefined): ExtendedBump | undefined {
  if (!lines) return undefined;
  const rows = lines.filter((l) => l.trim() !== '');
  if (!rows.length) return undefined;
  const head = words(rows[0]);
  if (head.length !== 2 || !/^[01]$/.test(head[0]) || !/^[0-9]+$/.test(head[1])) return undefined;
  const n = Number(head[1]);
  if (rows.length !== n + 1) return undefined;
  const steps = [];
  for (const r of rows.slice(1)) {
    const m = /^\s*(\S+)\s*(.*)$/.exec(r);
    if (!m || !isNum(m[1])) return undefined;
    steps.push({ bump: num(m[1]), label: m[2].trim() });
  }
  return { use: head[0] === '1', steps };
}

export const extendedBumpLines = (e: ExtendedBump): string[] => [
  String(e.use ? 1 : 0).padStart(13) + String(e.steps.length).padStart(13),
  ...e.steps.map((s) => fmt(s.bump) + (s.label ? '  ' + s.label : '')),
];

/** Even bump increments from -rebound to +bump, as the standard sweep runs. */
export function evenBumpValues(p: VehicleParams): number[] {
  const out: number[] = [];
  if (p.bumpIncrement <= 0) return [0];
  const n = Math.round((p.bumpTravel + p.reboundTravel) / p.bumpIncrement);
  for (let i = 0; i <= n; i++) out.push(Number((-p.reboundTravel + i * p.bumpIncrement).toFixed(9)));
  return out;
}

/** The bump positions a sweep runs through: the extended list when it is in use, else even increments. */
export function bumpSteps(p: VehicleParams, ext?: ExtendedBump): { values: number[]; labels: string[] } {
  if (ext?.use && ext.steps.length) return { values: ext.steps.map((s) => s.bump), labels: ext.steps.map((s) => s.label) };
  const values = evenBumpValues(p);
  return { values, labels: values.map(() => '') };
}
