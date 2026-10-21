/**
 * Display units in the app (SHARK's View / Change Units). The settings live in this store, are kept per user in
 * localStorage (SHARK keeps them in its ini file) and are mirrored into the core module so the helpers below can
 * convert. Components that show values call useUnitSettings() so they redraw when the units change.
 */
import { create } from 'zustand';
import { defaultUnits, normalizeUnits, setUnits, toDisplayUnit, unitDecimalsFor, unitText, type UnitSettings } from '@claudus/core';

const KEY = 'claudus.units';

function load(): UnitSettings {
  try {
    return normalizeUnits(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return defaultUnits();
  }
}

function save(s: UnitSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the units just do not persist */
  }
}

interface UnitsStore {
  settings: UnitSettings;
  setSettings: (s: UnitSettings) => void;
}

const initial = load();
setUnits(initial);

export const useUnits = create<UnitsStore>((set) => ({
  settings: initial,
  setSettings: (s) => {
    const n = normalizeUnits(s);
    setUnits(n);
    save(n);
    set({ settings: n });
  },
}));

/** Subscribe to the unit settings; returns them. */
export const useUnitSettings = (): UnitSettings => useUnits((s) => s.settings);

/** A value in a default unit string ('mm', 'deg/mm', ...) as text in the display units. */
export function fmtUnit(unit: string, v: number | undefined, base: number): string {
  return v === undefined || !Number.isFinite(v) ? '–' : toDisplayUnit(unit, v).toFixed(unitDecimalsFor(unit, base));
}

export { unitText };

/**
 * Split a label that ends in a unit in brackets, e.g. 'Rate (N/mm)', into its unit and the label with the display
 * unit in place. The unit uses '.' for products ('N.mm/deg'); the label keeps its own spelling when nothing changes.
 */
export function labelUnit(label: string): { unit?: string; label: string } {
  const m = /^(.*)\(([^()]*)\)$/.exec(label);
  if (!m) return { label };
  const unit = m[2].replace(/\./g, '·');
  const shown = unitText(unit);
  return { unit, label: shown === unit ? label : `${m[1]}(${shown})` };
}
