import { useState } from 'react';
import { DatParseError, formatSdf, listTemplates, newModel, readDat, writeDat, type End } from '@claudus/core';
import type { AnalysisState } from '../derived';
import { useApp } from '../store';
import { files } from '../files';
import { templatesForModel } from '../templates';
import { TemplateMenu } from './TemplateMenu';
import { GraphicsMenu } from './GraphicsMenu';

export function Toolbar({ analysis }: { analysis: AnalysisState }) {
  const { model, fileName, dirty, end, setModel, setEnd, markSaved } = useApp();
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    const f = await files().open('.dat');
    if (!f) return;
    try {
      setModel(readDat(f.text), f.name);
      setError(null);
    } catch (e) {
      setError(e instanceof DatParseError ? e.message : `Could not read ${f.name}: ${(e as Error).message}`);
    }
  };
  const save = async () => {
    // Custom templates the model uses travel inside the file, so it opens on any machine.
    const name = await files().save(fileName, writeDat({ ...model, templates: templatesForModel(model) }));
    if (name) markSaved(name);
  };
  const exportSdf = async () => {
    if (!analysis.results || !analysis.model) return;
    await files().save(fileName.replace(/\.dat$/i, '') + '.sdf', formatSdf(analysis.model, analysis.results, fileName));
  };

  return (
    <header className="toolbar">
      <span className="brand">Claudus</span>
      <button onClick={() => setShowNew(true)}>New</button>
      <button onClick={open}>Open…</button>
      <button onClick={save}>Save</button>
      <button onClick={exportSdf} disabled={!analysis.results || analysis.busy}>Export SDF</button>
      <TemplateMenu onError={setError} />
      <GraphicsMenu />
      <span className="sep" />
      <div className="seg">
        {(['front', 'rear'] as End[]).map((e) => (
          <button key={e} className={end === e ? 'on' : ''} onClick={() => setEnd(e)} disabled={!model[e]}>
            {e === 'front' ? 'Front' : 'Rear'}
          </button>
        ))}
      </div>
      <span className="file">{fileName}{dirty ? ' •' : ''}</span>
      {error && <span className="error" onClick={() => setError(null)}>{error}</span>}
      {showNew && <NewDialog onClose={() => setShowNew(false)} onCreate={(slot, e) => { setModel(newModel(slot, e), `type${slot}.dat`); setShowNew(false); }} />}
    </header>
  );
}

function NewDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (slot: number, end: End) => void }) {
  const templates = listTemplates();
  const [slot, setSlot] = useState(templates[0].slot);
  const [end, setEnd] = useState<End>('front');
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>New model</h3>
        <label>Suspension type</label>
        <div className="tpllist">
          {templates.map((t) => (
            <button key={t.slot} className={slot === t.slot ? 'on' : ''} onClick={() => setSlot(t.slot)} onDoubleClick={() => onCreate(t.slot, end)}>
              <b>{t.slot}</b> {t.label}
            </button>
          ))}
        </div>
        <label>End</label>
        <div className="seg">
          {(['front', 'rear'] as End[]).map((e) => (
            <button key={e} className={end === e ? 'on' : ''} onClick={() => setEnd(e)}>{e === 'front' ? 'Front' : 'Rear'}</button>
          ))}
        </div>
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onCreate(slot, end)}>Create</button>
        </div>
      </div>
    </div>
  );
}
