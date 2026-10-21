import { useRef, useState } from 'react';
import { useViewCtl, cameraApi, STD_VIEWS, defaultViewSettings, type DynMode, type FillStyle, type ViewSettings } from '../viewCtl';
import { useEdit } from '../editing';
import { useApp } from '../store';
import { getCanvas } from '../video';
import { Dlg } from './ComplianceDialogs';

const DYN: [DynMode, string][] = [['rotate', 'Rotate'], ['pan', 'Pan'], ['zoom', 'Zoom']];

/** A strip of view buttons over the 3D view, and the overlays for box zoom, centre picking and coincident points. */
export function ViewTools() {
  const dyn = useViewCtl((s) => s.dyn);
  const tool = useViewCtl((s) => s.tool);
  const setTool = useViewCtl((s) => s.setTool);
  const stdView = useViewCtl((s) => s.stdView);
  const set = useViewCtl((s) => s.set);
  const box = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<[number, number, number, number] | null>(null);
  const coincident = useEdit((s) => s.coincident);
  const setCoincident = useEdit((s) => s.setCoincident);
  const setTempGroup = useEdit((s) => s.setTempGroup);
  const data = useApp((s) => s.model[s.end]);
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);

  const frac = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <>
      <div className="viewtools" role="toolbar" aria-label="3D view">
        <div className="seg" title="Mouse action (Alt+Z or right click cycles)">
          {DYN.map(([m, l]) => <button key={m} className={dyn === m ? 'on' : ''} onClick={() => set({ dyn: m })}>{l}</button>)}
        </div>
        <button title="Fit the model in the view (Ctrl+A)" onClick={() => cameraApi()?.fit()}>Fit</button>
        <button className={tool === 'box' ? 'on' : ''} title="Drag a box to zoom to" onClick={() => setTool(tool === 'box' ? null : 'box')}>Box</button>
        <button className={tool === 'centre' ? 'on' : ''} title="Click to set the centre of rotation" onClick={() => setTool(tool === 'centre' ? null : 'centre')}>Centre</button>
        <select aria-label="Standard view" value={stdView ?? ''} onChange={(e) => e.target.value && cameraApi()?.stdView(e.target.value as never)}>
          <option value="">View…</option>
          {STD_VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {tool && (
        <div
          className="viewtool-layer"
          data-testid="view-tool-layer"
          onPointerDown={(e) => {
            if (tool === 'centre') return;
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            const f = frac(e);
            box.current = f;
            setRect([f.x, f.y, f.x, f.y]);
          }}
          onPointerMove={(e) => { if (box.current) { const f = frac(e); setRect([box.current.x, box.current.y, f.x, f.y]); } }}
          onPointerUp={(e) => {
            const f = frac(e);
            if (tool === 'centre') { cameraApi()?.pickCentre(f.x, f.y); setTool(null); return; }
            const b = box.current;
            box.current = null;
            setRect(null);
            if (b && Math.abs(f.x - b.x) > 0.01 && Math.abs(f.y - b.y) > 0.01) cameraApi()?.zoomBox(b.x, b.y, f.x, f.y);
            setTool(null);
          }}
        >
          <div className="viewtool-hint">{tool === 'box' ? 'Drag a box to zoom to' : 'Click to set the centre of rotation'}</div>
          {rect && <div className="zoombox" style={{ left: `${Math.min(rect[0], rect[2]) * 100}%`, top: `${Math.min(rect[1], rect[3]) * 100}%`, width: `${Math.abs(rect[2] - rect[0]) * 100}%`, height: `${Math.abs(rect[3] - rect[1]) * 100}%` }} />}
        </div>
      )}
      {coincident && data && (
        <div className="coincident" role="dialog" aria-label="Coincident points">
          <b>Points at this position</b>
          {coincident.map((i) => (
            <button key={i} className={selected === i ? 'on' : ''} onClick={() => { select(i); setCoincident(null); }}>Point {i + 1}</button>
          ))}
          <button onClick={() => { setTempGroup(coincident); setCoincident(null); }}>All points (temporary group)</button>
          <button onClick={() => setCoincident(null)}>Cancel</button>
        </div>
      )}
    </>
  );
}

/** Copy the 3D view to the clipboard as a PNG. */
export async function copyViewImage(): Promise<string> {
  const c = getCanvas();
  if (!c) return 'No 3D view to copy.';
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) return 'Could not read the view.';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'Copied the view to the clipboard.';
  } catch {
    return 'The browser did not allow copying to the clipboard.';
  }
}

/** Save the 3D view as a PNG file. */
export async function saveViewImage(name = 'view.png'): Promise<void> {
  const c = getCanvas();
  if (!c) return;
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SavedViewsDialog({ onClose }: { onClose: () => void }) {
  const views = useViewCtl((s) => s.savedViews);
  const setViews = useViewCtl((s) => s.setSavedViews);
  const [name, setName] = useState('');
  const save = () => {
    const cur = cameraApi()?.current();
    const n = name.trim();
    if (!cur || !n) return;
    setViews([...views.filter((v) => v.name !== n), { name: n, ...cur }]);
    setName('');
  };
  return (
    <Dlg title="Saved views" onClose={onClose}>
      <div className="row">
        <input aria-label="View name" placeholder="Name for the current view" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <button onClick={save} disabled={!name.trim()}>Save current view</button>
      </div>
      {views.length === 0 && <p className="muted small">No saved views yet.</p>}
      {views.map((v) => (
        <div key={v.name} className="row gitem">
          <span className="gtitle">{v.name}</span>
          <span className="grow" />
          <button onClick={() => cameraApi()?.apply(v.position, v.target)}>Recall</button>
          <button onClick={() => setViews(views.filter((x) => x.name !== v.name))}>Delete</button>
        </div>
      ))}
    </Dlg>
  );
}

const VIS: [keyof ViewSettings, string][] = [
  ['showSprings', 'Springs'], ['showDampers', 'Dampers'], ['showWheels', 'Wheels'], ['showPivots', 'Pivot axes'],
  ['showBody', 'Body (ground) points'], ['showGround', 'Ground grid'], ['showRollCentre', 'Roll centre'],
];
const LABELS: [keyof ViewSettings, string][] = [['pointNames', 'Point names'], ['partLabels', 'Part labels'], ['bothEnds', 'Show front and rear together']];
const COLOURS: [keyof ViewSettings, string][] = [
  ['background', 'Background'], ['wheelColour', 'Wheels'], ['springColour', 'Springs'], ['damperColour', 'Dampers'], ['pointColour', 'Points'], ['bodyColour', 'Body points'],
];

/** Fill style, background, what is drawn, labels, colours and sizes. */
export function DisplayDialog({ onClose }: { onClose: () => void }) {
  const vc = useViewCtl();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const check = (k: keyof ViewSettings, label: string) => (
    <label key={k}><input type="checkbox" checked={vc[k] as boolean} onChange={(e) => vc.set({ [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <Dlg title="3D display options" onClose={onClose}>
      <div className="row">
        <span>Fill style</span>
        <select aria-label="Fill style" value={vc.fill} onChange={(e) => vc.set({ fill: e.target.value as FillStyle })}>
          <option value="solid">Solid</option>
          <option value="wireframe">Wireframe</option>
          <option value="hidden">Hidden line</option>
        </select>
      </div>
      <b>Show</b>
      <div className="checkgrid">{VIS.map(([k, l]) => check(k, l))}</div>
      <b>Labels</b>
      <div className="checkgrid">
        <label><input type="checkbox" checked={view.pointNos} onChange={(e) => setView({ pointNos: e.target.checked })} /> Point numbers</label>
        <label><input type="checkbox" checked={view.pointValues} onChange={(e) => setView({ pointValues: e.target.checked })} /> Point values</label>
        {LABELS.map(([k, l]) => check(k, l))}
      </div>
      <b>Colours</b>
      <div className="checkgrid">
        {COLOURS.map(([k, l]) => (
          <label key={k}><input type="color" aria-label={`${l} colour`} value={vc[k] as string} onChange={(e) => vc.set({ [k]: e.target.value })} /> {l}</label>
        ))}
      </div>
      <b>Sizes</b>
      <div className="row">
        <label>Point size <input type="range" min={0.4} max={3} step={0.1} value={vc.pointSize} onChange={(e) => vc.set({ pointSize: Number(e.target.value) })} /></label>
        <label>Line thickness <input type="range" min={0.4} max={3} step={0.1} value={vc.lineSize} onChange={(e) => vc.set({ lineSize: Number(e.target.value) })} /></label>
      </div>
      <div className="row"><button onClick={() => vc.set({ ...defaultViewSettings })}>Back to defaults</button></div>
    </Dlg>
  );
}
