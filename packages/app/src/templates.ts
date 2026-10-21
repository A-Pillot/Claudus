/**
 * The user's template library: templates they made or loaded, kept between sessions like SHARK's
 * `_User_Templates.Dat`, which it reads on start-up. Stored in the browser (or the desktop app's webview).
 */
import {
  formatTemplates, getTemplate, isCustomTemplate, listTemplates, parseTemplates, registerTemplate, resetTemplates,
  type Model, type Template,
} from '@claudus/core';

const KEY = 'claudus.userTemplates';

function read(): Template[] {
  try {
    const text = localStorage.getItem(KEY);
    return text ? parseTemplates(text, 'user') : [];
  } catch {
    return [];
  }
}

function write(list: Template[]): void {
  try {
    if (list.length) localStorage.setItem(KEY, formatTemplates(list));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage can be unavailable (private windows); the templates still work for this session.
  }
}

/** Register the saved library. Called once at start-up. */
export function loadLibrary(): number {
  const list = read();
  list.forEach(registerTemplate);
  return list.length;
}

/** Register templates and keep them in the library, replacing any with the same number. */
export function addToLibrary(templates: Template[]): void {
  const list = read().filter((t) => !templates.some((n) => n.slot === t.slot));
  for (const t of templates) registerTemplate(t);
  write([...list, ...templates].sort((a, b) => a.slot - b.slot));
}

/** Forget every user template and go back to the built-in set. */
export function clearLibrary(): void {
  write([]);
  resetTemplates();
}

/** Every template that is not a plain built-in one: what "Save templates" writes. */
export const customTemplates = (): Template[] => listTemplates().filter((t) => isCustomTemplate(t.slot));

/** The custom templates a model uses, which are saved inside its file so it opens anywhere. */
export function templatesForModel(m: Model): Template[] | undefined {
  const slots = [m.front?.templateSlot, m.rear?.templateSlot].filter((s): s is number => s !== undefined && isCustomTemplate(s));
  const list = [...new Set(slots)].map(getTemplate);
  return list.length ? list : undefined;
}
