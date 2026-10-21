import { useState } from 'react';
import { DatParseError, formatSdf, isTwoDText, listTemplates, newModel, readDat, readTwoD, TwoDParseError, writeDat, writeTwoD, type End, type TwoDType } from '@claudus/core';
import type { AnalysisState } from '../derived';
import { useApp } from '../store';
import { files } from '../files';
import { templatesForModel } from '../templates';
import { TemplateMenu } from './TemplateMenu';
import { useTwoD } from '../twod/store2d';
import { GraphicsMenu } from './GraphicsMenu';
import { TransferMenu } from './TransferMenu';
import { ComplianceMenus } from './ComplianceMenu';
import { GraphsMenu } from './GraphsMenu';
import { RideHeightMenu } from './RideHeightMenu';
import { ViewMenu } from './ViewMenu';
import { DataMenu, SolveMenu } from './AnalysisMenu';

export function Toolbar({ analysis }: { analysis: AnalysisState }) {
  const { model, fileName, dirty, end, setModel, setEnd, markSaved } = useApp();
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const two = useTwoD((s) => s.active);
  const two2 = useTwoD();

  const open = async () => {
    const f = await files().open('.dat');
    if (!f) return;
    try {
      // A 2D file switches to the 2D module, a 3D file back to the 3D module.
      if (isTwoDText(f.text)) {
        two2.load(readTwoD(f.text), f.name);
      } else {
        setModel(readDat(f.text), f.name);
        two2.deactivate();
      }
      setError(null);
    } catch (e) {
      setError(e instanceof DatParseError || e instanceof TwoDParseError ? e.message : `Could not read ${f.name}: ${(e as Error).message}`);
    }
  };
  const save = async () => {
    if (two) {
      const name = await files().save(two2.fileName, writeTwoD(two2.model));
      if (name) two2.markSaved(name);
      return;
    }
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
      {!two && <button onClick={exportSdf} disabled={!analysis.results || analysis.busy}>Export SDF</button>}
      {!two && <ViewMenu />}
      {!two && <TemplateMenu onError={setError} />}
      {!two && <GraphicsMenu />}
      {!two && <GraphsMenu results={analysis.results} busy={analysis.busy} />}
      {!two && <TransferMenu onError={setError} />}
      {!two && <ComplianceMenus />}
      {!two && <DataMenu />}
      {!two && <SolveMenu />}
      {!two && <RideHeightMenu onError={setError} />}
      <span className="sep" />
      {/* SHARK keeps separate 2D and 3D data; this switches between the two. */}
      <div className="seg" title="Module">
        <button className={!two ? 'on' : ''} onClick={() => two2.deactivate()} data-testid="module-3d">3D</button>
        <button className={two ? 'on' : ''} onClick={() => two2.activate()} data-testid="module-2d">2D</button>
      </div>
      {!two && (
        <div className="seg">
          {(['front', 'rear'] as End[]).map((e) => (
            <button key={e} className={end === e ? 'on' : ''} onClick={() => setEnd(e)} disabled={!model[e]}>
              {e === 'front' ? 'Front' : 'Rear'}
            </button>
          ))}
        </div>
      )}
      <span className="file">{two ? two2.fileName : fileName}{(two ? two2.dirty : dirty) ? ' •' : ''}</span>
      {error && <span className="error" onClick={() => setError(null)}>{error}</span>}
      {showNew && <NewDialog onClose={() => setShowNew(false)} onCreate={(slot, e) => { setModel(newModel(slot, e), `type${slot}.dat`); two2.deactivate(); setShowNew(false); }} onCreate2D={(t) => { two2.create(t); setShowNew(false); }} />}
    </header>
  );
}

function NewDialog({ onClose, onCreate, onCreate2D }: { onClose: () => void; onCreate: (slot: number, end: End) => void; onCreate2D: (type: TwoDType) => void }) {
  const templates = listTemplates();
  const [slot, setSlot] = useState(templates[0].slot);
  const [end, setEnd] = useState<End>('front');
  // 2D models are a different module; they are picked from the same list.
  const [kind2D, setKind2D] = useState<TwoDType | null>(null);
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>New model</h3>
        <label>Suspension type</label>
        <div className="tpllist">
          {([[1, '2D Double Wishbone'], [2, '2D Macpherson Strut']] as [TwoDType, string][]).map(([t, label]) => (
            <button key={'2d' + t} className={kind2D === t ? 'on' : ''} onClick={() => setKind2D(t)} onDoubleClick={() => onCreate2D(t)} data-testid={`new-2d-${t}`}>
              <b>2D</b> {label}
            </button>
          ))}
          {templates.map((t) => (
            <button key={t.slot} className={kind2D === null && slot === t.slot ? 'on' : ''} onClick={() => { setKind2D(null); setSlot(t.slot); }} onDoubleClick={() => onCreate(t.slot, end)}>
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
          <button className="primary" onClick={() => (kind2D ? onCreate2D(kind2D) : onCreate(slot, end))}>Create</button>
        </div>
      </div>
    </div>
  );
}
