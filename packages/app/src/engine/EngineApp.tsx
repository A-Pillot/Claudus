// The Engine module screen: menus, network canvas, data panels, test points and run control.
import { useEffect, useMemo, useState } from 'react';
import type { ElementKind } from '@claudus/engine';
import { useTwoD } from '../twod/store2d';
import { Canvas, type Tool } from './Canvas';
import { checkModel } from './check';
import { CheckPanel } from './CheckPanel';
import { copyElements, deleteElements, KIND_NAMES, pasteElements } from './elements';
import { extractFile, loadText, newFile, openFile, saveFile } from './fileio';
import { GeneralPanel } from './GeneralPanel';
import { Menu } from './Menu';
import { Properties } from './Properties';
import { cancelRun, evaluateModel, onRunError, startRun, lastError } from './run';
import { EngineResults, type ResultsView } from './results';
import { useEngine } from './store';
import { TestTable } from './TestTable';
import { EngineToolsDialog, type EngineTool } from './tools';
import './engine.css';

type Panel = 'props' | 'general' | 'check';
type Center = 'network' | ResultsView;

const PALETTE: ElementKind[] = ['cylinder', 'pipe', 'plenum', 'junction', 'inlet', 'exit', 'throttle', 'compressor', 'turbine'];

export function EngineApp() {
  const model = useEngine((s) => s.model);
  const fileName = useEngine((s) => s.fileName);
  const dirty = useEngine((s) => s.dirty);
  const running = useEngine((s) => s.running);
  const progress = useEngine((s) => s.progress);
  const message = useEngine((s) => s.progressMessage);
  const results = useEngine((s) => s.results);
  const selection = useEngine((s) => s.selection);
  const selectedTests = useEngine((s) => s.selectedTests);
  const canUndo = useEngine((s) => s.history.past.length > 0);
  const canRedo = useEngine((s) => s.history.future.length > 0);
  const [panel, setPanel] = useState<Panel>('props');
  const [center, setCenter] = useState<Center>('network');
  const [tool, setTool] = useState<Tool>('select');
  const [palette, setPalette] = useState<ElementKind | null>(null);
  const [dialogTool, setDialogTool] = useState<EngineTool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTests, setShowTests] = useState(true);

  useEffect(() => { if (!useEngine.getState().model) newFile(); }, []);
  useEffect(() => onRunError(() => setError(lastError)), []);
  useEffect(() => { if (results && !running) setCenter((c) => (c === 'network' ? 'performance' : c)); }, [results, running]);

  const issues = useMemo(() => (model ? checkModel(model) : []), [model]);
  const errors = issues.filter((i) => i.severity === 'error').length;

  const st = useEngine.getState;
  const doCopy = () => {
    const s = st();
    if (s.model && s.selection.length) s.setClipboard(copyElements(s.model, s.selection));
  };
  const doPaste = () => {
    const s = st();
    if (!s.clipboard) return;
    let keys: string[] = [];
    s.edit((m) => { keys = pasteElements(m, s.clipboard!); });
    s.setSelection(keys);
  };
  const doDelete = () => {
    const s = st();
    if (s.selection.length) { s.edit((m) => deleteElements(m, s.selection)); s.setSelection([]); }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); void saveFile(false); }
      else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) st().redo(); else st().undo(); }
      else if (mod && k === 'y') { e.preventDefault(); st().redo(); }
      else if (mod && k === 'c') doCopy();
      else if (mod && k === 'v') doPaste();
      else if (k === 'delete' || k === 'backspace') doDelete();
      else if (k === 'escape') { setPalette(null); setTool('select'); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const guard = async (f: () => Promise<string | null | void>) => { const r = await f(); if (typeof r === 'string') setError(r); };
  const run = (points?: number[]) => {
    if (errors > 0) { setPanel('check'); setError(`Fix ${errors} data error(s) before running.`); return; }
    setError(null);
    startRun(points);
  };
  const leave = () => { useEngine.getState().setActive(false); if (location.hash === '#engine') history.replaceState(null, '', location.pathname + location.search); };
  const results3 = (v: ResultsView) => () => setCenter(v);

  return (
    <div className="engine-app">
      <header className="toolbar">
        <span className="brand">Claudus</span>
        <Menu title="File" items={[
          { label: 'New', onClick: newFile },
          { label: 'Open .sim…', onClick: () => void guard(openFile) },
          { label: 'Save', hint: 'Ctrl+S', onClick: () => void saveFile(false), disabled: !model },
          { label: 'Save as…', onClick: () => void saveFile(true), disabled: !model },
          'sep',
          { label: 'Extract model (selection)…', onClick: () => void extractFile(), disabled: !selection.length },
        ]} />
        <Menu title="Edit" items={[
          { label: 'Undo', hint: 'Ctrl+Z', onClick: () => st().undo(), disabled: !canUndo },
          { label: 'Redo', hint: 'Ctrl+Y', onClick: () => st().redo(), disabled: !canRedo },
          'sep',
          { label: 'Copy', hint: 'Ctrl+C', onClick: doCopy, disabled: !selection.length },
          { label: 'Paste', hint: 'Ctrl+V', onClick: doPaste },
          { label: 'Delete', hint: 'Del', onClick: doDelete, disabled: !selection.length },
        ]} />
        <Menu title="Data" items={[
          { label: 'General settings…', onClick: () => setPanel('general') },
          { label: 'Auto-mesh pipes…', onClick: () => setPanel('general') },
          { label: 'Test conditions', onClick: () => setShowTests(true) },
          { label: 'Data checking', onClick: () => setPanel('check') },
        ]} />
        <Menu title="Run" items={[
          { label: 'Run all test points', onClick: () => run(), disabled: running || !model },
          { label: 'Run selected test points', onClick: () => run(selectedTests), disabled: running || !selectedTests.length },
          { label: 'Cancel', onClick: cancelRun, disabled: !running },
        ]} />
        <Menu title="Tools" items={([['combustion', 'Combustion analysis'], ['friction', 'Friction estimator'], ['portflow', 'Port flow analysis'], ['concept', 'Concept builder'], ['parametric', 'Parametric study']] as [EngineTool, string][]).map(([t, label]) => ({ label, onClick: () => setDialogTool(t) }))} />
        <Menu title="Results" items={[
          { label: 'Network', onClick: () => setCenter('network') },
          { label: 'Performance', onClick: results3('performance'), disabled: !results },
          { label: 'Crank-angle traces', onClick: results3('traces'), disabled: !results },
          { label: 'Pipe display', onClick: results3('pipes'), disabled: !results },
          { label: 'Report', onClick: results3('report'), disabled: !results },
          'sep',
          { label: 'Clear overlays', onClick: () => st().clearOverlays() },
        ]} />
        <span className="sep" />
        <button onClick={() => st().undo()} disabled={!canUndo} title="Undo">Undo</button>
        <button onClick={() => st().redo()} disabled={!canRedo} title="Redo">Redo</button>
        <span className="sep" />
        {running ? (
          <>
            <progress value={progress} max={1} className="eprog" />
            <span className="muted small">{message}</span>
            <button onClick={cancelRun}>Cancel</button>
          </>
        ) : (
          <>
            <button className="primary" onClick={() => run()} disabled={!model} data-testid="engine-run">Run</button>
            {selectedTests.length > 0 && <button onClick={() => run(selectedTests)}>Run selected</button>}
            {message && <span className="muted small">{message}</span>}
          </>
        )}
        <span className="sep" />
        <div className="seg" title="Module">
          <button onClick={() => { useTwoD.getState().deactivate(); leave(); }} data-testid="module-3d">3D</button>
          <button onClick={() => { useTwoD.getState().activate(); leave(); }} data-testid="module-2d">2D</button>
          <button className="on" data-testid="module-engine">Engine</button>
        </div>
        <span className="file">{fileName ?? ''}{dirty ? ' •' : ''}</span>
        {error && <span className="error" onClick={() => setError(null)}>{error}</span>}
      </header>
      <aside className="epalette">
        <div className="seg vert">
          <button className={tool === 'select' && !palette ? 'on' : ''} onClick={() => { setTool('select'); setPalette(null); }}>Select</button>
          <button className={tool === 'connect' ? 'on' : ''} onClick={() => { setTool('connect'); setPalette(null); }}>Connect</button>
        </div>
        <h4>Add</h4>
        {PALETTE.map((k) => (
          <button key={k} className={palette === k ? 'on' : ''} onClick={() => { setPalette(palette === k ? null : k); setCenter('network'); }}>{KIND_NAMES[k]}</button>
        ))}
        <button onClick={doDelete} disabled={!selection.length}>Delete</button>
      </aside>
      <main className="ecenter">
        {center === 'network' ? (
          model ? <Canvas issues={issues} tool={tool} paletteKind={palette} onPlaced={() => setPalette(null)} /> : <div className="muted pad">No model.</div>
        ) : (
          <div className="ecenter-results">
            <div className="tabs">
              <button onClick={() => setCenter('network')}>← Network</button>
              {(['performance', 'traces', 'pipes', 'report'] as ResultsView[]).map((v) => <button key={v} className={center === v ? 'on' : ''} onClick={() => setCenter(v)}>{v}</button>)}
            </div>
            <div className="scroll"><EngineResults view={center} /></div>
          </div>
        )}
      </main>
      <aside className="eside">
        <div className="tabs">
          {([['props', 'Properties'], ['general', 'General'], ['check', `Checking${issues.length ? ` (${issues.length})` : ''}`]] as [Panel, string][]).map(([p, l]) => (
            <button key={p} className={panel === p ? 'on' : ''} onClick={() => setPanel(p)}>{l}</button>
          ))}
        </div>
        <div className="scroll">{panel === 'props' ? <Properties /> : panel === 'general' ? <GeneralPanel /> : <CheckPanel issues={issues} />}</div>
      </aside>
      <section className="etests">
        <div className="tabs">
          <button className={showTests ? 'on' : ''} onClick={() => setShowTests(!showTests)}>Test conditions</button>
          <span className="grow" />
          <span className="muted small">{errors ? `${errors} error(s)` : 'Data OK'}</span>
        </div>
        {showTests && <div className="scroll"><TestTable /></div>}
      </section>
      {dialogTool && <EngineToolsDialog tool={dialogTool} onClose={() => setDialogTool(null)} evaluate={evaluateModel} />}
    </div>
  );
}

// Used by tests and drag-and-drop file loading.
export { loadText };
