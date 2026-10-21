/** File open/save that works in the browser; the desktop build swaps in native dialogs (see desktop.ts). */
export interface FileBridge {
  open(accept: string): Promise<{ name: string; text: string } | null>;
  save(suggestedName: string, text: string): Promise<string | null>;
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
  save: async (name, text) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  },
};

let bridge: FileBridge = browserBridge;
export const files = (): FileBridge => bridge;
export const setFileBridge = (b: FileBridge) => { bridge = b; };
