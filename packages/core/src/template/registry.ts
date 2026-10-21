import { BUILTIN_TEMPLATES } from './builtin.js';
import type { Template } from './types.js';

const builtin = new Map<number, Template>(BUILTIN_TEMPLATES.map((t) => [t.slot, t]));
const registry = new Map<number, Template>(builtin);

export function getTemplate(slot: number): Template {
  const t = registry.get(slot);
  if (!t) throw new Error(`Template type ${slot} is not available yet`);
  return t;
}

export const hasTemplate = (slot: number): boolean => registry.has(slot);

/** Register (or replace) a template, e.g. one loaded from a SHARK custom template file. */
export function registerTemplate(t: Template): void {
  registry.set(t.slot, t);
}

export const listTemplates = (): Template[] => [...registry.values()].sort((a, b) => a.slot - b.slot);

/** Remove a user template, putting back the built-in one if it had replaced it. */
export function unregisterTemplate(slot: number): void {
  const b = builtin.get(slot);
  if (b) registry.set(slot, b);
  else registry.delete(slot);
}

/** Back to the built-in templates only (SHARK's File / Re-Read Default Templates (skip user)). */
export function resetTemplates(): void {
  registry.clear();
  for (const [k, t] of builtin) registry.set(k, t);
}

/** The built-in template for a slot, even when a user template has replaced it. */
export const builtinTemplate = (slot: number): Template | undefined => builtin.get(slot);

/** True when the slot holds a template that is not the built-in one (edited, loaded or new). */
export const isCustomTemplate = (slot: number): boolean => registry.has(slot) && registry.get(slot) !== builtin.get(slot);

/** The first unused template number at or above `from` (user templates start after SHARK's 29). */
export function nextFreeSlot(from = 30): number {
  let s = from;
  while (registry.has(s)) s++;
  return s;
}
