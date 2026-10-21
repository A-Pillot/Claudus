// .sim file handling through the shared file bridge (browser input/download or Tauri dialogs).
import { createDefaultModel, parseSim, writeSim, type EngineModel } from '@claudus/engine';
import { files } from '../files';
import { extractModel, type Key } from './elements';
import { autoLayout } from './layout';
import { useEngine } from './store';

/** Fresh default model with a laid-out network. */
export function makeDefaultModel(): EngineModel {
  const m = createDefaultModel({});
  m.layout = autoLayout(m);
  return m;
}

export function newFile(): void {
  useEngine.getState().setModel(makeDefaultModel(), 'untitled.sim');
  useEngine.getState().setResults(null);
}

export function loadText(name: string, text: string): string | null {
  try {
    const m = parseSim(text);
    m.layout = autoLayout(m);
    const s = useEngine.getState();
    s.setModel(m, name);
    s.setResults(null);
    s.clearOverlays();
    return null;
  } catch (e) {
    return `Could not read ${name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function openFile(): Promise<string | null> {
  const f = await files().open('.sim');
  return f ? loadText(f.name, f.text) : null;
}

export async function saveFile(asNew: boolean): Promise<void> {
  const s = useEngine.getState();
  if (!s.model) return;
  const suggested = asNew || !s.fileName ? (s.fileName ?? 'untitled.sim') : s.fileName;
  const name = await files().save(suggested, writeSim(s.model));
  if (name) s.markSaved(name);
}

/** Save the selected elements (or the whole network when nothing is selected) as a separate .sim. */
export async function extractFile(): Promise<void> {
  const s = useEngine.getState();
  if (!s.model) return;
  const keys: Key[] = s.selection;
  if (keys.length === 0) return;
  const base = (s.fileName ?? 'model.sim').replace(/\.sim$/i, '');
  await files().save(`${base}_extract.sim`, writeSim(extractModel(s.model, keys)));
}
