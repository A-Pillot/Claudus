// Data checking: connectivity and sanity checks on a model, shown in the Data Checking panel.
import type { ElementRef, EngineModel } from '@claudus/engine';
import { itemMap, keyOf, refKey, type Key } from './elements';

export interface Issue {
  severity: 'error' | 'warning';
  message: string;
  /** Element to select when the issue is clicked. */
  key?: Key;
}

const endKey = (r: ElementRef) => `${r.kind}:${r.id}:${r.end ?? 0}`;

export function checkModel(model: EngineModel): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string, key?: Key) => issues.push({ severity: 'error', message, key });
  const warn = (message: string, key?: Key) => issues.push({ severity: 'warning', message, key });
  const items = itemMap(model);

  if (model.cylinders.length === 0) err('The model has no cylinders.');
  if (model.inlets.length === 0) warn('The model has no inlet boundary.');
  if (model.exits.length === 0) warn('The model has no exit boundary.');
  if (model.tests.length === 0) err('There are no test points. Add at least one in the test conditions table.');

  const used = new Map<string, number>();
  const touches = new Map<Key, number>();
  model.connections.forEach((c, i) => {
    for (const r of [c.a, c.b, ...c.via]) {
      if (!items.has(refKey(r))) err(`Connection ${i + 1} refers to missing ${r.kind} ${r.id}.`);
    }
    for (const r of [c.a, c.b]) {
      touches.set(refKey(r), (touches.get(refKey(r)) ?? 0) + 1);
      if (r.kind === 'pipe') used.set(endKey(r), (used.get(endKey(r)) ?? 0) + 1);
    }
  });

  for (const p of model.pipes) {
    const k = keyOf('pipe', p.id);
    for (const end of [1, 2] as const) {
      const n = used.get(`pipe:${p.id}:${end}`) ?? 0;
      if (n === 0) err(`${p.label}: end ${end} is not connected.`, k);
      else if (n > 1) err(`${p.label}: end ${end} is connected ${n} times. Join three or more pipes with a junction.`, k);
    }
    if (!(p.length > 0)) err(`${p.label}: length must be positive.`, k);
    if (p.stations.length < 2) err(`${p.label}: needs at least two diameter stations.`, k);
    else if (p.stations.some((s) => !(s.d > 0))) err(`${p.label}: diameters must be positive.`, k);
    if (!(p.meshLength > 0)) err(`${p.label}: mesh length must be positive.`, k);
    else if (p.meshLength > p.length) warn(`${p.label}: mesh length is longer than the pipe.`, k);
  }

  const cylTouches = new Map<number, { intake: boolean; exhaust: boolean }>();
  for (const c of model.connections) {
    for (const [r, o] of [[c.a, c.b], [c.b, c.a]] as const) {
      if (r.kind !== 'cylinder' || o.kind === 'cylinder') continue;
      const t = cylTouches.get(r.id) ?? { intake: false, exhaust: false };
      const valve = c.via.find((v) => v.kind === 'valve');
      if (!valve) warn(`Cylinder ${r.id} is connected without a valve.`, keyOf('cylinder', r.id));
      const kind = valve ? model.valves.find((v) => v.id === valve.id)?.kind : undefined;
      if (kind === 'intake') t.intake = true;
      if (kind === 'exhaust') t.exhaust = true;
      cylTouches.set(r.id, t);
    }
  }
  for (const c of model.cylinders) {
    const k = keyOf('cylinder', c.id);
    const t = cylTouches.get(c.id);
    if (!t) err(`${c.label} is not connected to the network.`, k);
    else {
      if (!t.intake) warn(`${c.label} has no intake valve connection.`, k);
      if (!t.exhaust) warn(`${c.label} has no exhaust valve connection.`, k);
    }
    if (!(c.bore > 0 && c.stroke > 0 && c.conRod > c.stroke / 2)) err(`${c.label}: bore, stroke and rod length are not sensible.`, k);
    if (!(c.compressionRatio > 1)) err(`${c.label}: compression ratio must exceed 1.`, k);
  }
  for (const b of [...model.inlets, ...model.exits]) {
    if (!touches.get(keyOf(b.kind, b.id))) err(`${b.label} is not connected.`, keyOf(b.kind, b.id));
  }
  for (const p of model.plenums) {
    const n = touches.get(keyOf('plenum', p.id)) ?? 0;
    if (n === 0) err(`${p.label} is not connected.`, keyOf('plenum', p.id));
    else if (n === 1) warn(`${p.label} has only one connection.`, keyOf('plenum', p.id));
    if (!(p.volume > 0)) err(`${p.label}: volume must be positive.`, keyOf('plenum', p.id));
  }
  for (const t of model.throttles) {
    const inUse = model.connections.some((c) => c.via.some((v) => v.kind === 'throttle' && v.id === t.id)) || touches.has(keyOf('throttle', t.id));
    if (!inUse) warn(`${t.label} is not used in any connection.`, keyOf('throttle', t.id));
  }

  const angles = model.cylinders.map((c) => ((c.firingAngle % (model.cycle * 180)) + model.cycle * 180) % (model.cycle * 180));
  if (new Set(angles.map((a) => a.toFixed(3))).size < angles.length) warn('Two cylinders have the same firing angle.');

  model.tests.forEach((t, i) => {
    const k = `test ${i + 1}`;
    if (!(t.speed > 0)) err(`Test point ${i + 1} (${t.label}): speed must be positive.`);
    if (!(t.afr > 0)) err(`Test point ${i + 1}: air/fuel ratio must be positive (${k}).`);
    if (!(t.ambientPressure > 0) || !(t.ambientTemperature > 0)) err(`Test point ${i + 1}: ambient conditions must be positive.`);
  });
  return issues;
}

/** Element keys with an error (drawn red on the canvas). */
export function errorKeys(issues: Issue[]): Set<Key> {
  return new Set(issues.filter((i) => i.severity === 'error' && i.key).map((i) => i.key!));
}
export function warnKeys(issues: Issue[]): Set<Key> {
  return new Set(issues.filter((i) => i.severity === 'warning' && i.key).map((i) => i.key!));
}
