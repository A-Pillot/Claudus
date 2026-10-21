// Simple snapshot undo/redo history. Pure: callers keep the History value in state.
export interface History<T> {
  past: T[];
  future: T[];
  /** Key of the last recorded edit; an edit with the same key coalesces (typing in one field). */
  key?: string;
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

/** Call with the state as it was BEFORE an edit. */
export function record<T>(h: History<T>, before: T, key?: string, limit = 100): History<T> {
  if (key !== undefined && key === h.key && h.past.length > 0) return { ...h, future: [] };
  const past = [...h.past, before];
  if (past.length > limit) past.shift();
  return { past, future: [], key };
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (h.past.length === 0) return null;
  const value = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), future: [...h.future, current], key: undefined }, value };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (h.future.length === 0) return null;
  const value = h.future[h.future.length - 1];
  return { history: { past: [...h.past, current], future: h.future.slice(0, -1), key: undefined }, value };
}
