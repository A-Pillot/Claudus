/** File open/save that works in the browser; the desktop build swaps in native dialogs (see desktop.ts). */
export interface FileFilter { name: string; extensions: string[] }

export interface SaveOptions {
  /** Always ask for a name and place (Save As), even in the browser where Save just downloads. */
  ask?: boolean;
  /** File types offered by the dialog, first one preselected. Default: the extension of the suggested name. */
  filters?: FileFilter[];
}

/** SHARK lists both model extensions under "model data". The one of the current name comes first. */
export function modelFilters(name: string): FileFilter[] {
  const shkFirst = /\.shk$/i.test(name);
  const dat = { name: 'Model data (*.dat)', extensions: ['dat'] };
  const shk = { name: 'Model data (*.shk)', extensions: ['shk'] };
  return shkFirst ? [shk, dat] : [dat, shk];
}

export interface FileBridge {
  /** accept: comma-separated extensions, as for an <input type="file">, e.g. ".dat,.shk". */
  open(accept: string): Promise<{ name: string; text: string } | null>;
  save(suggestedName: string, text: string, options?: SaveOptions): Promise<string | null>;
  /** Save binary data (a video); the extension of the name picks the file type filter. */
  saveBinary(suggestedName: string, data: Uint8Array | Blob, mime: string): Promise<string | null>;
}

const browserBridge: FileBridge = {
  open: (accept) =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? { name: f.name, text: await f.text() } : null);
      };
      input.click();
    }),
  save: async (name, text, options) => {
    if (options?.ask) {
      const picked = await askName(name, options.filters);
      if (picked === null) return null;
      if (typeof picked !== 'string') {
        const w = await picked.createWritable();
        await w.write(text);
        await w.close();
        return picked.name;
      }
      name = picked;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  },
  saveBinary: async (name, data, mime) => {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return name;
  },
};

type SaveHandle = { name: string; createWritable: () => Promise<{ write: (t: string) => Promise<void>; close: () => Promise<void> }> };
type SavePicker = (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

/** Save As in the browser: the browser's save picker where there is one (Chrome, Edge), otherwise a name prompt. */
async function askName(name: string, filters?: FileFilter[]): Promise<SaveHandle | string | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      return await picker({
        suggestedName: name,
        types: filters?.map((f) => ({ description: f.name, accept: { 'text/plain': f.extensions.map((e) => '.' + e) } })),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      // Picker refused (e.g. inside a sandboxed frame): fall back to a prompt.
    }
  }
  const typed = window.prompt('Save as (file name):', name)?.trim();
  if (!typed) return null;
  // A name typed without one of the offered extensions gets the first one.
  const exts = filters?.flatMap((f) => f.extensions) ?? [];
  return exts.length && !exts.some((e) => typed.toLowerCase().endsWith('.' + e.toLowerCase())) ? `${typed}.${exts[0]}` : typed;
}

let bridge: FileBridge = browserBridge;
export const files = (): FileBridge => bridge;
export const setFileBridge = (b: FileBridge) => { bridge = b; };
