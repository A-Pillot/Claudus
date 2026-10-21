// Network canvas geometry and auto-layout: intake left, cylinders centre, exhaust right.
import type { ElementKind, ElementRef, EngineModel } from '@claudus/engine';
import { allItems, keyOf, refKey, type Key } from './elements';

export interface Pt { x: number; y: number }

/** Half sizes used for drawing, hit-testing and connection anchors. */
export const HALF: Record<ElementKind, { w: number; h: number }> = {
  cylinder: { w: 30, h: 38 }, pipe: { w: 42, h: 8 }, plenum: { w: 30, h: 24 }, inlet: { w: 20, h: 20 }, exit: { w: 20, h: 20 },
  throttle: { w: 8, h: 16 }, valve: { w: 8, h: 8 }, port: { w: 8, h: 8 }, junction: { w: 8, h: 8 }, compressor: { w: 24, h: 24 },
  turbine: { w: 24, h: 24 }, cooler: { w: 16, h: 24 },
};

const COL = 150;
const ROW = 90;

/** Default column (relative to the cylinders, which sit at 0) when connectivity gives no hint. */
const KIND_COL: Partial<Record<ElementKind, number>> = { inlet: -4, throttle: -3, plenum: -2, pipe: -1, compressor: -2, turbine: 2, exit: 4, cylinder: 0 };

/** Which side of the cylinders an element sits: -1 intake, +1 exhaust, via BFS from cylinder connections. */
export function sideDepths(model: EngineModel): Map<Key, number> {
  const col = new Map<Key, number>();
  const adj = new Map<Key, Key[]>();
  const link = (a: Key, b: Key) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  const queue: Key[] = [];
  for (const c of model.connections) {
    const ka = refKey(c.a);
    const kb = refKey(c.b);
    link(ka, kb);
    const isCylA = c.a.kind === 'cylinder';
    const isCylB = c.b.kind === 'cylinder';
    if (isCylA !== isCylB) {
      const other = isCylA ? kb : ka;
      const cyl = isCylA ? ka : kb;
      const exhaust = c.via.some((v) => (v.kind === 'valve' || v.kind === 'port') && isExhaustRef(model, v));
      col.set(cyl, 0);
      if (!col.has(other)) { col.set(other, exhaust ? 1 : -1); queue.push(other); }
    }
  }
  while (queue.length) {
    const k = queue.shift()!;
    const d = col.get(k)!;
    const dir = d < 0 ? -1 : 1;
    for (const n of adj.get(k) ?? []) {
      if (col.has(n)) continue;
      col.set(n, d + dir);
      queue.push(n);
    }
  }
  return col;
}

function isExhaustRef(model: EngineModel, r: ElementRef): boolean {
  const list = r.kind === 'valve' ? model.valves : r.kind === 'port' ? model.ports : [];
  return list.find((e) => e.id === r.id)?.kind === 'exhaust';
}

/** Positions for every element; keeps existing layout entries unless `force`. */
export function autoLayout(model: EngineModel, force = false): Record<Key, Pt> {
  const out: Record<Key, Pt> = {};
  const items = allItems(model).filter((i) => !isViaOnly(model, i.kind, i.id));
  const depth = sideDepths(model);
  const cols = new Map<number, Key[]>();
  for (const it of items) {
    let c = depth.get(it.key);
    if (c === undefined) c = KIND_COL[it.kind] ?? 0;
    // Boundaries sit at the outer edge of their side.
    if (it.kind === 'inlet') c = Math.min(c, -1);
    if (it.kind === 'exit') c = Math.max(c, 1);
    const arr = cols.get(c) ?? [];
    arr.push(it.key);
    cols.set(c, arr);
  }
  const x0 = 160 + 3 * COL;
  for (const [c, keys] of cols) {
    keys.sort((a, b) => {
      const pa = parseInt(a.split(':')[1], 10);
      const pb = parseInt(b.split(':')[1], 10);
      return pa - pb;
    });
    const total = (keys.length - 1) * ROW;
    keys.forEach((k, i) => {
      const existing = model.layout[k];
      out[k] = !force && existing ? existing : { x: x0 + c * COL, y: 200 + i * ROW - total / 2 + (c === 0 ? 0 : 0) };
    });
  }
  return out;
}

/** True when a valve/port/throttle only appears as a flow restriction in connections (drawn on the line). */
export function isViaOnly(model: EngineModel, kind: ElementKind, id: number): boolean {
  if (kind !== 'valve' && kind !== 'port' && kind !== 'throttle') return false;
  const k = keyOf(kind, id);
  if (model.layout[k] && !model.connections.some((c) => c.via.some((v) => refKey(v) === k))) return false;
  return model.connections.some((c) => c.via.some((v) => refKey(v) === k));
}

/** Fill in any missing layout positions (returns a new layout object). */
export function ensureLayout(model: EngineModel): Record<Key, Pt> {
  const auto = autoLayout(model);
  const out: Record<Key, Pt> = { ...model.layout };
  const missing = Object.keys(auto).filter((k) => !model.layout[k]);
  if (missing.length === Object.keys(auto).length || missing.length === 0) {
    for (const k of missing) out[k] = auto[k];
    return out;
  }
  // Partly laid out: place only the newcomers, stacked below what exists.
  let maxY = 0;
  for (const p of Object.values(model.layout)) maxY = Math.max(maxY, p.y);
  missing.forEach((k, i) => { out[k] = { x: auto[k].x, y: maxY + ROW + i * 20 }; });
  return out;
}

/** Anchor of a connection end on its element: pipe ends are left/right, others face the other element. */
export function anchor(kind: ElementKind, end: 1 | 2 | undefined, p: Pt, towards: Pt): Pt {
  const h = HALF[kind];
  if (kind === 'pipe') return { x: p.x + (end === 2 ? h.w : -h.w), y: p.y };
  if (kind === 'junction') return p;
  return { x: p.x + (towards.x >= p.x ? h.w : -h.w), y: p.y };
}

/** Orthogonal polyline between two anchors with a vertical jog in the middle. */
export function route(a: Pt, b: Pt): Pt[] {
  const mx = (a.x + b.x) / 2;
  if (Math.abs(a.y - b.y) < 0.5) return [a, b];
  return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
}
