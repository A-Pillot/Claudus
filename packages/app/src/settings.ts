/**
 * User preferences kept between sessions in localStorage (SHARK keeps them in its ini file): graph colours,
 * marker and text sizes, decimals, the scope symbol, body visibility, and the last five files opened.
 * The desktop build uses the same storage (its webview has localStorage).
 */
import { create } from 'zustand';
import { defaultStyle, type LineKind, type LineStyle, type Marker } from './components/GraphOptions';

const KEY = 'claudus.settings';
const RECENT_KEY = 'claudus.recent';
export const RECENT_MAX = 5;
/** Files bigger than this are listed by name only (the list lives in localStorage). */
const RECENT_TEXT_MAX = 300_000;

export interface Settings {
  /** Graph marker radius in px. */
  markerSize: number;
  /** Graph label and slope text size in px. */
  textSize: number;
  /** Decimal places for graph values (deviation, slope). */
  decimals: number;
  /** Marker drawn at the current (static) position on each data line. */
  scopeSymbol: Marker;
  style: Record<LineKind, LineStyle>;
  showBody: boolean;
}

export const defaultSettings = (): Settings => ({ markerSize: 3, textSize: 10, decimals: 3, scopeSymbol: 'none', style: defaultStyle(), showBody: true });

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** Check a parsed value as settings; anything wrong falls back to the default. */
export function sanitiseSettings(v: unknown): Settings {
  const d = defaultSettings();
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Settings>;
  const style = defaultStyle();
  for (const k of Object.keys(style) as LineKind[]) {
    const s = o.style?.[k];
    if (s && /^#[0-9a-f]{6}$/i.test(s.colour)) style[k] = { colour: s.colour, marker: typeof s.marker === 'string' ? s.marker : style[k].marker };
  }
  return {
    markerSize: clamp(o.markerSize, 1, 12, d.markerSize),
    textSize: clamp(o.textSize, 6, 24, d.textSize),
    decimals: Math.round(clamp(o.decimals, 0, 8, d.decimals)),
    scopeSymbol: typeof o.scopeSymbol === 'string' ? o.scopeSymbol : d.scopeSymbol,
    style,
    showBody: typeof o.showBody === 'boolean' ? o.showBody : d.showBody,
  };
}

function load(): Settings {
  try {
    return sanitiseSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return defaultSettings();
  }
}

export interface RecentFile { name: string; text?: string }

export function loadRecent(): RecentFile[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((r) => r && typeof r.name === 'string').slice(0, RECENT_MAX).map((r) => ({ name: r.name, ...(typeof r.text === 'string' ? { text: r.text } : {}) })) : [];
  } catch {
    return [];
  }
}

/** The list with a file moved (or added) to the front, no more than five long. */
export const pushRecent = (list: RecentFile[], f: RecentFile): RecentFile[] =>
  [{ name: f.name, ...(f.text !== undefined && f.text.length <= RECENT_TEXT_MAX ? { text: f.text } : {}) }, ...list.filter((r) => r.name !== f.name)].slice(0, RECENT_MAX);

interface SettingsStore {
  settings: Settings;
  set: (s: Partial<Settings>) => void;
  setStyle: (style: Record<LineKind, LineStyle>) => void;
  reset: () => void;
  recent: RecentFile[];
  addRecent: (f: RecentFile) => void;
  clearRecent: () => void;
}

const save = (key: string, v: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    /* storage unavailable or full: the choice lasts for this session only */
    return false;
  }
};

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: load(),
  set: (s) => {
    const settings = sanitiseSettings({ ...get().settings, ...s });
    save(KEY, settings);
    set({ settings });
  },
  setStyle: (style) => get().set({ style }),
  reset: () => {
    const settings = defaultSettings();
    save(KEY, settings);
    set({ settings });
  },
  recent: loadRecent(),
  addRecent: (f) => {
    let recent = pushRecent(get().recent, f);
    // Over the storage limit: keep the names, drop the text.
    if (!save(RECENT_KEY, recent)) {
      recent = recent.map((r) => ({ name: r.name }));
      save(RECENT_KEY, recent);
    }
    set({ recent });
  },
  clearRecent: () => {
    save(RECENT_KEY, []);
    set({ recent: [] });
  },
}));
