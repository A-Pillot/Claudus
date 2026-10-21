/**
 * Display units (SHARK's View / Change Units). A viewing option only: model data and files stay in the default
 * units (deg, mm, kg, N). A display value is the default value times the scale.
 */
export type UnitKind = 'angle' | 'length' | 'mass' | 'force';

export interface UnitSetting {
  /** Preset id, or 'user' for a user-defined scale and label. */
  preset: string;
  /** Display value = default value * scale. */
  scale: number;
  label: string;
  /** Decimal places to add (or remove, if negative) compared with the default unit. */
  extra: number;
}

export type UnitSettings = Record<UnitKind, UnitSetting>;

export interface UnitPreset { id: string; name: string; scale: number; label: string; extra: number }

export const UNIT_KINDS: UnitKind[] = ['angle', 'length', 'mass', 'force'];
export const UNIT_KIND_NAMES: Record<UnitKind, string> = { angle: 'Angle', length: 'Length', mass: 'Mass', force: 'Force' };

export const UNIT_PRESETS: Record<UnitKind, UnitPreset[]> = {
  angle: [
    { id: 'rad', name: 'Radian', scale: Math.PI / 180, label: 'rad', extra: 3 },
    { id: 'mrad', name: 'MilliRadian', scale: (Math.PI / 180) * 1000, label: 'mrad', extra: 1 },
    { id: 'deg', name: 'Degree', scale: 1, label: 'deg', extra: 0 },
    { id: 'min', name: 'Minutes', scale: 60, label: 'min', extra: 0 },
  ],
  length: [
    { id: 'm', name: 'Meter', scale: 0.001, label: 'm', extra: 3 },
    { id: 'mm', name: 'milliMeter', scale: 1, label: 'mm', extra: 0 },
  ],
  mass: [{ id: 'kg', name: 'Kilogram', scale: 1, label: 'kg', extra: 0 }],
  force: [
    { id: 'N', name: 'Newton', scale: 1, label: 'N', extra: 0 },
    { id: 'daN', name: 'decaNewton', scale: 0.1, label: 'daN', extra: 1 },
  ],
};

const DEFAULT_PRESET: Record<UnitKind, string> = { angle: 'deg', length: 'mm', mass: 'kg', force: 'N' };

export function presetSetting(kind: UnitKind, id: string): UnitSetting {
  const p = UNIT_PRESETS[kind].find((x) => x.id === id) ?? UNIT_PRESETS[kind].find((x) => x.id === DEFAULT_PRESET[kind])!;
  return { preset: p.id, scale: p.scale, label: p.label, extra: p.extra };
}

export function defaultUnits(): UnitSettings {
  return { angle: presetSetting('angle', 'deg'), length: presetSetting('length', 'mm'), mass: presetSetting('mass', 'kg'), force: presetSetting('force', 'N') };
}

/** Make settings from untrusted data (a saved ini): bad parts fall back to the default unit. */
export function normalizeUnits(raw: unknown): UnitSettings {
  const out = defaultUnits();
  if (!raw || typeof raw !== 'object') return out;
  for (const k of UNIT_KINDS) {
    const r = (raw as Record<string, any>)[k];
    if (!r || typeof r !== 'object') continue;
    if (r.preset === 'user') {
      const scale = Number(r.scale);
      const extra = Math.round(Number(r.extra));
      if (Number.isFinite(scale) && scale > 0 && typeof r.label === 'string')
        out[k] = { preset: 'user', scale, label: r.label.trim().slice(0, 12), extra: Number.isFinite(extra) ? Math.max(-6, Math.min(6, extra)) : 0 };
    } else if (typeof r.preset === 'string' && UNIT_PRESETS[k].some((p) => p.id === r.preset)) {
      out[k] = presetSetting(k, r.preset);
    }
  }
  return out;
}

let current: UnitSettings = defaultUnits();
export const getUnits = (): UnitSettings => current;
export const setUnits = (s: UnitSettings): void => { current = s; };

export const toDisplay = (kind: UnitKind, v: number, s: UnitSettings = current): number => v * s[kind].scale;
export const fromDisplay = (kind: UnitKind, v: number, s: UnitSettings = current): number => v / s[kind].scale;
export const unitLabel = (kind: UnitKind, s: UnitSettings = current): string => s[kind].label;
/** Decimal places for a value that has `base` places in the default unit. */
export const unitDecimals = (kind: UnitKind, base: number, s: UnitSettings = current): number =>
  Math.max(0, Math.min(10, base + s[kind].extra));

const TOKEN_KIND: Record<string, UnitKind> = { deg: 'angle', '°': 'angle', mm: 'length', kg: 'mass', N: 'force' };

interface Parsed { num: string[]; den: string[] }

/** Split a unit string such as 'N/mm' or 'N·mm/deg' into numerator and denominator tokens. */
function parseUnit(unit: string): Parsed {
  const [n, ...d] = unit.split('/');
  const split = (t: string) => t.split(/[·*]/).map((x) => x.trim()).filter(Boolean);
  return { num: split(n), den: d.flatMap(split) };
}

const hasKnown = (p: Parsed) => [...p.num, ...p.den].some((t) => t in TOKEN_KIND);

/** Factor from the default unit string to the display unit (1 for units that are not converted, like %, Hz, s). */
export function unitFactor(unit: string, s: UnitSettings = current): number {
  const p = parseUnit(unit);
  let f = 1;
  for (const t of p.num) if (t in TOKEN_KIND) f *= s[TOKEN_KIND[t]].scale;
  for (const t of p.den) if (t in TOKEN_KIND) f /= s[TOKEN_KIND[t]].scale;
  return f;
}

/** The unit string shown for a default unit string, with the display labels in place. */
export function unitText(unit: string, s: UnitSettings = current): string {
  const p = parseUnit(unit);
  if (!hasKnown(p)) return unit;
  const lab = (t: string) => {
    const k = TOKEN_KIND[t];
    if (!k) return t;
    return t === '°' && s[k].label === 'deg' ? '°' : s[k].label;
  };
  const join = (a: string[]) => a.map(lab).join('·');
  return p.den.length ? `${join(p.num)}/${join(p.den)}` : join(p.num);
}

/** Extra decimals for a unit string: numerator extras less denominator extras. */
export function unitExtra(unit: string, s: UnitSettings = current): number {
  const p = parseUnit(unit);
  let e = 0;
  for (const t of p.num) if (t in TOKEN_KIND) e += s[TOKEN_KIND[t]].extra;
  for (const t of p.den) if (t in TOKEN_KIND) e -= s[TOKEN_KIND[t]].extra;
  return e;
}

export const toDisplayUnit = (unit: string, v: number, s: UnitSettings = current): number => v * unitFactor(unit, s);
export const fromDisplayUnit = (unit: string, v: number, s: UnitSettings = current): number => v / unitFactor(unit, s);
export const unitDecimalsFor = (unit: string, base: number, s: UnitSettings = current): number =>
  Math.max(0, Math.min(10, base + unitExtra(unit, s)));
