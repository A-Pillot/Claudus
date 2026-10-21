import type { UserLine, UserLineSet } from '@claudus/core';

const KEY = 'claudus.userLineSets';

const isLine = (l: unknown): l is UserLine => {
  const x = l as UserLine;
  return !!x && ['bump', 'roll', 'steer'].includes(x.sweep) && typeof x.variable === 'string' && (x.end === 'front' || x.end === 'rear')
    && Array.isArray(x.points) && x.points.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
};

/** Check a parsed JSON value as a list of user line sets; bad entries are dropped. */
export function sanitiseSets(v: unknown): UserLineSet[] {
  const list = Array.isArray(v) ? v : (v as { sets?: unknown })?.sets;
  if (!Array.isArray(list)) throw new Error('Not a user line set file.');
  return list
    .filter((s): s is UserLineSet => !!s && typeof s.label === 'string' && Array.isArray(s.lines))
    .map((s) => ({ label: s.label, lines: s.lines.filter(isLine).map((l) => ({ sweep: l.sweep, variable: l.variable, end: l.end, points: l.points.map((p) => [p[0], p[1]] as [number, number]) })) }));
}

export function loadSets(): UserLineSet[] {
  try {
    return sanitiseSets(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function storeSets(sets: UserLineSet[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sets));
  } catch {
    /* storage unavailable: the sets still work for this session through the dialog's state */
  }
}

export const exportSets = (sets: UserLineSet[]) => JSON.stringify({ format: 'claudus-user-lines', version: 1, sets }, null, 2);
export const importSets = (text: string): UserLineSet[] => sanitiseSets(JSON.parse(text));
