import { BUILTIN_TEMPLATES } from './builtin.js';
import type { Template } from './types.js';

const registry = new Map<number, Template>(BUILTIN_TEMPLATES.map((t) => [t.slot, t]));

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
