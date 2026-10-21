import { useEffect, useRef, useState } from 'react';
import { addEndFromModel, CoordSetError, DatParseError, readDat, type FileFormat } from '@claudus/core';
import { useApp } from '../store';
import { useModes } from '../modes';
import { files } from '../files';
import { TransferDialog, type TransferMode } from './TransferDialog';

/** File menu items for moving hard points in and out: Import/Export Hard Points and Add End from File. */
export function TransferMenu({ onError }: { onError: (msg: string | null) => void }) {
  const model = useApp((s) => s.model);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<{ mode: TransferMode; format: FileFormat } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const show = (mode: TransferMode, format: FileFormat) => () => { setOpen(false); setDialog({ mode, format }); };
  const addEnd = async () => {
    setOpen(false);
    const f = await files().open('.dat');
    if (!f) return;
    try {
      const { model: next, end } = addEndFromModel(model, readDat(f.text), useModes.getState().axleFit);
      useApp.setState((s) => ({ model: next, dirty: true, revision: s.revision + 1, end, art: { bump: 0, roll: 0, rack: 0 }, selected: null }));
      onError(null);
    } catch (e) {
      onError(e instanceof DatParseError || e instanceof CoordSetError ? e.message : `Could not read ${f.name}: ${(e as Error).message}`);
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className={open ? 'on' : ''}>Import / Export ▾</button>
      {open && (
        <div className="menulist">
          <button onClick={show('import', 'adams')}>Import from Adams subsystem…</button>
          <button onClick={show('import', 'usera')}>Import from User A format…</button>
          <hr />
          <button onClick={show('export', 'adams')}>Export to Adams subsystem…</button>
          <button onClick={show('export', 'usera')}>Export to User A format…</button>
          <hr />
          <button onClick={addEnd} disabled={!!(model.front && model.rear)}>Add other end from a .dat file…</button>
        </div>
      )}
      {dialog && <TransferDialog mode={dialog.mode} format={dialog.format} onClose={() => setDialog(null)} />}
    </div>
  );
}
