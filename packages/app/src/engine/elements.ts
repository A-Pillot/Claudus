// Pure helpers over EngineModel elements: lookup, add, delete, copy/paste.
import type { Connection, ElementKind, ElementRef, EngineModel } from '@claudus/engine';

export type Key = string;
export const keyOf = (kind: ElementKind, id: number): Key => `${kind}:${id}`;
export const parseKey = (k: Key): { kind: ElementKind; id: number } => {
  const i = k.indexOf(':');
  return { kind: k.slice(0, i) as ElementKind, id: Number(k.slice(i + 1)) };
};
export const refKey = (r: ElementRef): Key => keyOf(r.kind, r.id);

type ArrayName = 'cylinders' | 'pipes' | 'plenums' | 'throttles' | 'inlets' | 'exits' | 'valves' | 'ports' | 'compressors' | 'turbines';
const ARRAY: Partial<Record<ElementKind, ArrayName>> = {
  cylinder: 'cylinders', pipe: 'pipes', plenum: 'plenums', throttle: 'throttles', inlet: 'inlets', exit: 'exits',
  valve: 'valves', port: 'ports', compressor: 'compressors', turbine: 'turbines',
};

export const KIND_NAMES: Record<ElementKind, string> = {
  cylinder: 'Cylinder', pipe: 'Pipe', plenum: 'Plenum', inlet: 'Inlet', exit: 'Exit', throttle: 'Throttle', valve: 'Valve',
  port: 'Port', junction: 'Junction', compressor: 'Compressor', turbine: 'Turbine', cooler: 'Cooler',
};

export interface Item { key: Key; kind: ElementKind; id: number; label: string }

type Labelled = { id: number; label?: string };
export function listOf(model: EngineModel, kind: ElementKind): Labelled[] {
  const a = ARRAY[kind];
  return a ? (model[a] as Labelled[]) : [];
}

/** Junctions and coolers have no array in the model: they exist through layout entries and connections. */
export function virtualItems(model: EngineModel): Item[] {
  const seen = new Map<Key, Item>();
  const add = (kind: ElementKind, id: number) => {
    if (kind !== 'junction' && kind !== 'cooler') return;
    const key = keyOf(kind, id);
    if (!seen.has(key)) seen.set(key, { key, kind, id, label: `${KIND_NAMES[kind]} ${id}` });
  };
  for (const c of model.connections) {
    add(c.a.kind, c.a.id);
    add(c.b.kind, c.b.id);
    for (const v of c.via) add(v.kind, v.id);
  }
  for (const k of Object.keys(model.layout)) {
    const p = parseKey(k);
    add(p.kind, p.id);
  }
  return [...seen.values()];
}

export function allItems(model: EngineModel): Item[] {
  const out: Item[] = [];
  (Object.keys(ARRAY) as ElementKind[]).forEach((kind) => {
    for (const e of listOf(model, kind)) out.push({ key: keyOf(kind, e.id), kind, id: e.id, label: e.label || `${KIND_NAMES[kind]} ${e.id}` });
  });
  return out.concat(virtualItems(model));
}

export function itemMap(model: EngineModel): Map<Key, Item> {
  return new Map(allItems(model).map((i) => [i.key, i]));
}

export function getElement(model: EngineModel, key: Key): Record<string, unknown> | undefined {
  const { kind, id } = parseKey(key);
  return listOf(model, kind).find((e) => e.id === id) as unknown as Record<string, unknown> | undefined;
}

export function nextId(model: EngineModel, kind: ElementKind): number {
  let m = 0;
  for (const e of listOf(model, kind)) m = Math.max(m, e.id);
  for (const i of virtualItems(model)) if (i.kind === kind) m = Math.max(m, i.id);
  return m + 1;
}

/** Create a default element of a kind in the model (mutates). Returns its key. */
export function addElement(model: EngineModel, kind: ElementKind, pos?: { x: number; y: number }, opts: { valveKind?: 'intake' | 'exhaust' } = {}): Key {
  const id = nextId(model, kind);
  const label = `${KIND_NAMES[kind]} ${id}`;
  const vk = opts.valveKind ?? 'intake';
  switch (kind) {
    case 'cylinder': {
      const ref = model.cylinders[model.cylinders.length - 1];
      const n = model.cylinders.length;
      model.cylinders.push({ id, label, bore: ref?.bore ?? 86, stroke: ref?.stroke ?? 86, conRod: ref?.conRod ?? 143, pinOffset: 0, compressionRatio: ref?.compressionRatio ?? 10, firingAngle: (n * model.cycle * 180) / (n + 1) });
      break;
    }
    case 'pipe':
      model.pipes.push({ id, label, length: 300, stations: [{ x: 0, d: 40 }, { x: 300, d: 40 }], meshLength: 25, wallTemperature: 400, frictionFactor: 0.01 });
      break;
    case 'plenum': model.plenums.push({ id, label, volume: 2000 }); break;
    case 'throttle': model.throttles.push({ id, label, diameter: 40, kind: 'butterfly', position: 90, cd: 0.8 }); break;
    case 'inlet': model.inlets.push({ id, label, kind: 'inlet', pressure: 1.013, temperature: 293 }); break;
    case 'exit': model.exits.push({ id, label, kind: 'exit', pressure: 1.013, temperature: 293 }); break;
    case 'valve': model.valves.push({ id, label, kind: vk, openAngle: vk === 'intake' ? 340 : 140, closeAngle: vk === 'intake' ? 580 : 380, maxLift: 9, diameter: 32 }); break;
    case 'port': model.ports.push({ id, label, kind: vk, diameter: 32 }); break;
    case 'compressor': model.compressors.push({ id, label }); break;
    case 'turbine': model.turbines.push({ id, label }); break;
    default: break; // junction, cooler: layout only
  }
  const key = keyOf(kind, id);
  model.layout[key] = pos ? { ...pos } : { x: 100, y: 100 };
  return key;
}

const sameRef = (a: ElementRef, k: Key) => refKey(a) === k;

/** Delete elements by key together with every connection that touches them (mutates). */
export function deleteElements(model: EngineModel, keys: Key[]): void {
  const set = new Set(keys);
  for (const k of keys) {
    const { kind, id } = parseKey(k);
    const a = ARRAY[kind];
    if (a) (model[a] as Labelled[]) = (model[a] as Labelled[]).filter((e) => e.id !== id) as never;
    delete model.layout[k];
  }
  model.connections = model.connections.filter((c) => ![c.a, c.b].some((r) => set.has(refKey(r))));
  for (const c of model.connections) c.via = c.via.filter((v) => !set.has(refKey(v)));
}

export function deleteConnection(model: EngineModel, index: number): void {
  model.connections.splice(index, 1);
}

export interface Clip { model: Partial<EngineModel>; keys: Key[]; connections: Connection[]; layout: Record<Key, { x: number; y: number }> }

/** Copy the given elements and the connections wholly between them. */
export function copyElements(model: EngineModel, selected: Key[]): Clip {
  // Flow restrictions (valves, ports, throttles) on a link between two selected elements travel with it.
  const sel = new Set(selected);
  const keys = [...selected];
  for (const c of model.connections) {
    if (!sel.has(refKey(c.a)) || !sel.has(refKey(c.b))) continue;
    for (const v of c.via) if (!keys.includes(refKey(v))) keys.push(refKey(v));
  }
  const set = new Set(keys);
  const items: Clip['model'] = {};
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const layout: Clip['layout'] = {};
  for (const k of keys) {
    const e = getElement(model, k);
    const { kind } = parseKey(k);
    const a = ARRAY[kind];
    if (a && e) ((items[a] as unknown[]) ??= []).push(clone(e));
    if (model.layout[k]) layout[k] = { ...model.layout[k] };
  }
  const connections = model.connections
    .filter((c) => set.has(refKey(c.a)) && set.has(refKey(c.b)) && c.via.every((v) => set.has(refKey(v))))
    .map((c) => clone(c));
  return { model: items, keys: [...keys], connections, layout };
}

/** Paste a clip with fresh ids, offset in the layout (mutates). Returns the new keys. */
export function pasteElements(model: EngineModel, clip: Clip, offset = { x: 30, y: 30 }): Key[] {
  const map = new Map<Key, Key>();
  const newKeys: Key[] = [];
  for (const k of clip.keys) {
    const { kind, id } = parseKey(k);
    const nid = nextId(model, kind);
    const nk = keyOf(kind, nid);
    map.set(k, nk);
    newKeys.push(nk);
    const a = ARRAY[kind];
    if (a) {
      const src = listOf(clip.model as EngineModel, kind).find((e) => e.id === id);
      if (src) (model[a] as Labelled[]).push({ ...JSON.parse(JSON.stringify(src)), id: nid, label: `${src.label ?? KIND_NAMES[kind]} copy` });
    }
    const p = clip.layout[k] ?? { x: 100, y: 100 };
    model.layout[nk] = { x: p.x + offset.x, y: p.y + offset.y };
  }
  const remap = (r: ElementRef): ElementRef => {
    const nk = map.get(refKey(r));
    return nk ? { ...r, id: parseKey(nk).id } : r;
  };
  for (const c of clip.connections) model.connections.push({ a: remap(c.a), b: remap(c.b), via: c.via.map(remap) });
  return newKeys;
}

export function addConnection(model: EngineModel, a: ElementRef, b: ElementRef, via: ElementRef[] = []): boolean {
  const dup = model.connections.some((c) => (sameRef(a, refKey(c.a)) && sameRef(b, refKey(c.b)) && (a.end ?? 0) === (c.a.end ?? 0) && (b.end ?? 0) === (c.b.end ?? 0)));
  if (dup) return false;
  model.connections.push({ a, b, via });
  return true;
}

/** Sub-model holding only the given elements (for Extract model). */
export function extractModel(model: EngineModel, keys: Key[]): EngineModel {
  const clip = copyElements(model, keys);
  const out: EngineModel = JSON.parse(JSON.stringify(model));
  out.cylinders = []; out.pipes = []; out.plenums = []; out.throttles = []; out.inlets = []; out.exits = [];
  out.valves = []; out.ports = []; out.compressors = []; out.turbines = []; out.connections = []; out.layout = {};
  const c = clip.model;
  for (const a of Object.keys(ARRAY) as ElementKind[]) {
    const n = ARRAY[a]!;
    (out[n] as unknown[]) = (c[n] as unknown[]) ?? [];
  }
  out.connections = clip.connections;
  out.layout = clip.layout;
  return out;
}
