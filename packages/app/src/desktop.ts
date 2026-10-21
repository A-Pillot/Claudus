/** In the desktop (Tauri) build, use native open/save dialogs and write files directly. */
import { setFileBridge } from './files';

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function initDesktop(): Promise<void> {
  if (!isDesktop()) return;
  const dialog = await import('@tauri-apps/plugin-dialog');
  const fs = await import('@tauri-apps/plugin-fs');
  const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  setFileBridge({
    open: async (accept) => {
      const ext = accept.replace(/^\./, '');
      const path = await dialog.open({ multiple: false, filters: [{ name: `${ext.toUpperCase()} files`, extensions: [ext] }] });
      if (typeof path !== 'string') return null;
      return { name: baseName(path), text: await fs.readTextFile(path) };
    },
    save: async (suggestedName, text) => {
      const ext = suggestedName.split('.').pop() ?? 'txt';
      const path = await dialog.save({ defaultPath: suggestedName, filters: [{ name: `${ext.toUpperCase()} files`, extensions: [ext] }] });
      if (!path) return null;
      await fs.writeTextFile(path, text);
      return baseName(path);
    },
    saveBinary: async (suggestedName, data) => {
      const ext = suggestedName.split('.').pop() ?? '';
      const path = await dialog.save({ defaultPath: suggestedName, filters: [{ name: `${ext.toUpperCase()} files`, extensions: [ext] }] });
      if (!path) return null;
      await fs.writeFile(path, data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data);
      return baseName(path);
    },
  });
}
