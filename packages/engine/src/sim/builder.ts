// BUILDER section: network-builder canvas records. Decoded into EngineModel.layout.
//
// Layout: header line `count 20 nGroups 1 <4 view numbers>` (I12 x4 + reals), then `count` records of
// 20 integers (I12, wrapped 9 / 9 / 2 per line), then `nGroups` named groups (kept raw).
// Record fields (0-based): [0] element type, [1] x, [2] y (grid units), [6] side/orientation,
// [8] element id. Pipes also hold their end point in [9] x2, [10] y2 (start is [1],[2]).
// Types: 1 cylinder, 2 valve, 3 port, 4 inlet, 5 throttle, 6 plenum, 10 pipe, 11 exit. Others
// (17, 35 = annotations; 12..16 = two-stroke valve types) are kept untouched.
import type { EngineModel } from '../model';
import { fI, nums } from './format';

const TYPE_KIND: Record<number, string> = {
  1: 'cylinder', 2: 'valve', 3: 'port', 4: 'inlet', 5: 'throttle', 6: 'plenum', 10: 'pipe', 11: 'exit',
};
const KIND_TYPE: Record<string, number> = {};
for (const [t, k] of Object.entries(TYPE_KIND)) KIND_TYPE[k] = Number(t);

const REC_TAIL = [0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0];
const TEMPLATE_HEAD: Record<string, number[]> = {
  // [type, x, y, a3, a4, a5, side, a7, id]
  cylinder: [1, 0, 0, 1, 1, 1, 0, 4, 0],
  valve: [2, 0, 0, 1, 1, 1, 1, 4, 0],
  port: [3, 0, 0, 1, 1, 1, 1, 4, 0],
  inlet: [4, 0, 0, 4, 1, 1, 1, 4, 0],
  throttle: [5, 0, 0, 4, 1, 1, 1, 4, 0],
  plenum: [6, 0, 0, 4, 1, 1, 1, 4, 0],
  exit: [11, 0, 0, 2, 1, 1, 2, 4, 0],
};
const DEFAULT_HEADER =
  '            N          20           0           1    1.500000E-02     2.50000';

export interface BuilderData {
  header: string;
  records: number[][];
  tail: string[];
}

export function parseBuilderRaw(lines: string[]): BuilderData | undefined {
  if (!lines.length) return undefined;
  const header = lines[0];
  const count = nums(header)[0];
  if (!Number.isFinite(count) || count < 0 || lines.length < 1 + 3 * count) return undefined;
  const records: number[][] = [];
  for (let i = 0; i < count; i++) {
    const rec = [...nums(lines[1 + 3 * i]), ...nums(lines[2 + 3 * i]), ...nums(lines[3 + 3 * i])];
    if (rec.length !== 20 || rec.some((v) => !Number.isFinite(v))) return undefined;
    records.push(rec);
  }
  return { header, records, tail: lines.slice(1 + 3 * count) };
}

function recordPos(r: number[]): { x: number; y: number } {
  if (r[0] === 10) return { x: (r[1] + r[9]) / 2, y: (r[2] + r[10]) / 2 };
  return { x: r[1], y: r[2] };
}

export function builderToLayout(lines: string[]): Record<string, { x: number; y: number }> {
  const b = parseBuilderRaw(lines);
  const out: Record<string, { x: number; y: number }> = {};
  if (!b) return out;
  for (const r of b.records) {
    const kind = TYPE_KIND[r[0]];
    if (kind) out[`${kind}:${r[8]}`] = recordPos(r);
  }
  return out;
}

function elementIds(m: EngineModel): Record<string, number[]> {
  return {
    cylinder: m.cylinders.map((e) => e.id),
    valve: m.valves.map((e) => e.id),
    port: m.ports.map((e) => e.id),
    inlet: m.inlets.map((e) => e.id),
    throttle: m.throttles.map((e) => e.id),
    plenum: m.plenums.map((e) => e.id),
    pipe: m.pipes.map((e) => e.id),
    exit: m.exits.map((e) => e.id),
  };
}

/** Data used to decide whether the BUILDER section must be regenerated. */
export function builderSlice(m: EngineModel): unknown {
  return [m.layout, elementIds(m)];
}

function fmtRecord(r: number[]): string[] {
  const f = (a: number[]) => a.map((v) => fI(v, 12)).join('');
  return [f(r.slice(0, 9)), f(r.slice(9, 18)), f(r.slice(18, 20))];
}

function sideOf(m: EngineModel, kind: string, id: number): number {
  if (kind === 'valve') return m.valves.find((v) => v.id === id)?.kind === 'exhaust' ? 2 : 1;
  if (kind === 'port') return m.ports.find((v) => v.id === id)?.kind === 'exhaust' ? 2 : 1;
  return 1;
}

/** Regenerate the BUILDER section from the model layout, patching the baseline records when present. */
export function writeBuilder(m: EngineModel, baseLines?: string[]): string[] {
  const base = baseLines ? parseBuilderRaw(baseLines) : undefined;
  const ids = elementIds(m);
  const records: number[][] = [];
  const have = new Set<string>();
  const usedKinds = new Set<string>();
  for (const r0 of base?.records ?? []) {
    const r = r0.slice();
    const kind = TYPE_KIND[r[0]];
    if (kind) {
      usedKinds.add(kind);
      if (!ids[kind].includes(r[8])) continue; // element deleted
      have.add(`${kind}:${r[8]}`);
      const want = m.layout[`${kind}:${r[8]}`];
      if (want) {
        const cur = recordPos(r);
        const dx = Math.round(want.x - cur.x);
        const dy = Math.round(want.y - cur.y);
        r[1] += dx;
        r[2] += dy;
        if (r[0] === 10) {
          r[9] += dx;
          r[10] += dy;
        }
      }
    }
    records.push(r);
  }
  let auto = 0;
  for (const kind of Object.keys(TEMPLATE_HEAD).concat('pipe')) {
    if (base && !usedKinds.has(kind)) continue;
    for (const id of ids[kind]) {
      if (have.has(`${kind}:${id}`)) continue;
      const pos = m.layout[`${kind}:${id}`] ?? { x: 2 + (auto++ % 20) * 2, y: 24 };
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);
      if (kind === 'pipe') {
        records.push([10, x - 1, y, 1, 0, 0, 1, 1, id, x + 1, y, 0, 1, 0, 1, 1, 0, 0, 0, 0]);
      } else {
        const h = TEMPLATE_HEAD[kind].slice();
        h[1] = x;
        h[2] = y;
        h[6] = sideOf(m, kind, id);
        h[8] = id;
        records.push([...h, ...REC_TAIL]);
      }
    }
  }
  const hdr = base ? base.header : DEFAULT_HEADER;
  const head = hdr.replace(/^\s*\S+/, (mm) => fI(records.length, mm.length));
  const out = [head];
  for (const r of records) out.push(...fmtRecord(r));
  out.push(...(base ? base.tail : ['']));
  return out;
}
