/**
 * Model file names. SHARK reads and writes its model data under two extensions, .dat and .shk: its Open, Save As
 * and data file editor dialogs list both as "model data", and the start-up launcher offers "Open an existing .shk
 * file". Both hold the same text format, so a .shk file goes through readDat / writeDat like a .dat file.
 * (No .shk sample ships with the Lotus package; this comes from the dialogs in shark.exe.)
 */
export const MODEL_EXTENSIONS = ['.dat', '.shk'] as const;
export type ModelExtension = (typeof MODEL_EXTENSIONS)[number];

/** The accept string for an open dialog of model files. */
export const MODEL_ACCEPT = MODEL_EXTENSIONS.join(',');

const EXT_RE = /\.(dat|shk)$/i;

/** Whether a file name is a SHARK model file (.dat or .shk, any case). */
export const isModelFileName = (name: string): boolean => EXT_RE.test(name);

/** The model extension of a file name, lower case, or null when it has neither. */
export function modelExtension(name: string): ModelExtension | null {
  const m = EXT_RE.exec(name);
  return m ? (`.${m[1].toLowerCase()}` as ModelExtension) : null;
}

/** A file name without its model extension (and without a 2D "_2d" suffix when asked). */
export function modelBaseName(name: string, strip2d = false): string {
  const base = name.replace(EXT_RE, '');
  return strip2d ? base.replace(/_2d$/i, '') : base;
}

/** The same file name with a different model extension. A name with no model extension gets one added. */
export const withModelExtension = (name: string, ext: ModelExtension): string => modelBaseName(name) + ext;

/** Split an accept string such as ".dat,.shk" into bare extensions: ["dat", "shk"]. */
export const acceptExtensions = (accept: string): string[] =>
  accept.split(',').map((s) => s.trim().replace(/^\*?\./, '')).filter((s) => s.length > 0);
