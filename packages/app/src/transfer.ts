/**
 * State for hard point import/export that is not part of the model: the label strings (which SHARK keeps with
 * the template; here they are kept per template number in the browser), the shift/scale/switch settings, and
 * the temporary store of saved coordinate sets (Data / Coordinates), which like SHARK's lasts for the session.
 */
import { create } from 'zustand';
import { defaultTransfer, getTemplate, labelsFor, type CoordSet, type LabelSet, type TransferSettings } from '@claudus/core';

const KEY = 'claudus.labelStrings';

function load(): Record<number, Partial<LabelSet>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

function save(v: Record<number, Partial<LabelSet>>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Storage can be unavailable; the strings still work for this session.
  }
}

export type LabelColumn = keyof LabelSet;

interface TransferState {
  /** Edited label strings by template number. */
  labels: Record<number, Partial<LabelSet>>;
  settings: TransferSettings;
  coordSets: CoordSet[];
  setLabel: (slot: number, column: LabelColumn, index: number, value: string) => void;
  resetLabels: (slot: number) => void;
  setSettings: (s: Partial<TransferSettings>) => void;
  setCoordSets: (c: CoordSet[]) => void;
}

export const useTransfer = create<TransferState>((set) => ({
  labels: load(),
  settings: defaultTransfer(),
  coordSets: [],
  setLabel: (slot, column, index, value) =>
    set((s) => {
      // Start from the full current set so one edit does not lose the defaults of the others.
      const cur = labelsFor(getTemplate(slot), s.labels[slot]);
      const col = [...cur[column]];
      col[index] = value;
      const labels = { ...s.labels, [slot]: { ...cur, [column]: col } };
      save(labels);
      return { labels };
    }),
  resetLabels: (slot) =>
    set((s) => {
      const labels = { ...s.labels };
      delete labels[slot];
      save(labels);
      return { labels };
    }),
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setCoordSets: (coordSets) => set({ coordSets }),
}));
