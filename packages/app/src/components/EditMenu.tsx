import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { movePoint, trackingAxes, useEdit, type ChangeMode, type ModifyMode, type Tracking } from '../editing';
import { cameraApi, cycleDyn, dominantAxis, useViewCtl } from '../viewCtl';
import { Dlg } from './ComplianceDialogs';
import { NumberCell } from './PointTable';
import { EditItems } from './DataMenu';

const typing = (e: KeyboardEvent) => /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName);

/** Keyboard: undo/redo, autoscale, mouse-mode cycling and joggling the picked point. */
function useEditKeys() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); useApp.getState().undo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); useApp.getState().redo(); return; }
        if (k === 'a') { e.preventDefault(); cameraApi()?.fit(); return; }
      }
      if (e.altKey && k === 'z') { e.preventDefault(); cycleDyn(); return; }
      if (k === 'escape') {
        // Only touch the stores when there is something to cancel (a store update would re-render open dialogs mid-event).
        if (useViewCtl.getState().tool) useViewCtl.getState().setTool(null);
        if (useEdit.getState().tempPicking) useEdit.getState().setTempPicking(false);
        return;
      }
      // Joggle: Ctrl+arrows move by the fine step, Shift+arrows by the coarse step.
      const arrows = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'pageup', 'pagedown'];
      if (!arrows.includes(k) || !(e.ctrlKey || e.shiftKey)) return;
      const sel = useApp.getState().selected;
      if (sel === null) return;
      e.preventDefault();
      const ed = useEdit.getState();
      const axes = trackingAxes(ed.tracking, useViewCtl.getState().stdView);
      const step = e.shiftKey ? ed.joggleCoarse : ed.joggleFine;
      const b = cameraApi()?.basis() ?? { right: [1, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number] };
      const delta: [number, number, number] = [0, 0, 0];
      const outside = (keep: number[]) => [0, 1, 2].filter((a) => !keep.includes(a));
      if (k === 'pageup' || k === 'pagedown') {
        // Along the axis that is not in the screen plane.
        const r = dominantAxis(b.right, outside(axes));
        const u = dominantAxis(b.up, [...outside(axes), r.axis]);
        const depth = axes.length === 3 ? [0, 1, 2].find((a) => a !== r.axis && a !== u.axis)! : axes.length === 1 ? axes[0] : -1;
        if (depth < 0) return;
        delta[depth] = (k === 'pageup' ? 1 : -1) * step;
      } else if (axes.length === 1) {
        delta[axes[0]] = (k === 'arrowright' || k === 'arrowup' ? 1 : -1) * step;
      } else {
        const r = dominantAxis(b.right, outside(axes));
        const u = dominantAxis(b.up, [...outside(axes), r.axis]);
        if (k === 'arrowleft' || k === 'arrowright') delta[r.axis] = (k === 'arrowright' ? 1 : -1) * r.sign * step;
        else delta[u.axis] = (k === 'arrowup' ? 1 : -1) * u.sign * step;
      }
      movePoint(sel, delta);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
}

const MODES: [ModifyMode, string][] = [['edit', 'Edit (type values)'], ['joggle', 'Joggle (keys)'], ['drag', 'Drag (mouse)']];
const TRACKS: [Tracking, string][] = [['all', 'All'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']];

/** SHARK's Edit menu (undo, redo, modify and change modes, tracking, temporary group) and SetUp / Gen Defaults. */
export function EditMenu({ onError }: { onError: (msg: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ed = useEdit();
  const canUndo = useApp((s) => s.undoStack.length > 0);
  const canRedo = useApp((s) => s.redoStack.length > 0);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  useEditKeys();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const check = (on: boolean, label: string, f: () => void, keep = true) => (
    <button key={label} role="menuitemcheckbox" aria-checked={on} onClick={() => { f(); if (!keep) setOpen(false); }}>
      <span className="tick">{on ? '✓' : ''}</span>{label}
    </button>
  );

  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)}>Edit ▾</button>
      {open && (
        <div className="menulist" role="menu">
          <button disabled={!canUndo} onClick={() => { undo(); setOpen(false); }}>Undo (Ctrl+Z)</button>
          <button disabled={!canRedo} onClick={() => { redo(); setOpen(false); }}>Redo (Ctrl+Y)</button>
          <hr />
          <div className="menuhead">Modify mode</div>
          {MODES.map(([m, l]) => check(ed.mode === m, l, () => ed.set({ mode: m })))}
          <div className="menuhead">Change mode</div>
          {check(ed.changeMode === 'change', 'Change part lengths', () => ed.set({ changeMode: 'change' as ChangeMode }))}
          {check(ed.changeMode === 'retain', 'Retain part lengths (body points only)', () => ed.set({ changeMode: 'retain' as ChangeMode }))}
          <hr />
          <div className="menuhead">Tracking</div>
          <button onClick={() => ed.set({ tracking: TRACKS[(TRACKS.findIndex(([t]) => t === ed.tracking) + 1) % TRACKS.length][0] })}>Toggle (now {ed.tracking.toUpperCase()})</button>
          {TRACKS.map(([t, l]) => check(ed.tracking === t, l, () => ed.set({ tracking: t })))}
          {check(ed.trackVisible, 'Tracking lines visible', () => ed.set({ trackVisible: !ed.trackVisible }))}
          <hr />
          {check(ed.tempPicking, 'Pick temporary group', () => ed.setTempPicking(!ed.tempPicking))}
          <button disabled={ed.tempGroup.length === 0} onClick={() => ed.setTempGroup([])}>Clear temporary group ({ed.tempGroup.length})</button>
          {check(ed.coincidence, 'Point coincidence', () => ed.set({ coincidence: !ed.coincidence }))}
          <hr />
          <button onClick={() => { setOpen(false); setDefaults(true); }}>Gen defaults / undo buffer…</button>
          <EditItems onError={onError} close={() => setOpen(false)} />
        </div>
      )}
      {defaults && <GenDefaults onClose={() => setDefaults(false)} />}
    </div>
  );
}

/** Joggle steps, tracking line length, coincidence tolerance and the undo buffer length. */
function GenDefaults({ onClose }: { onClose: () => void }) {
  const ed = useEdit();
  const limit = useApp((s) => s.undoLimit);
  const setLimit = useApp((s) => s.setUndoLimit);
  const num = (label: string, value: number, f: (v: number) => void) => (
    <label className="row">{label}<span className="grow" /><NumberCell value={value} onCommit={(v) => v >= 0 && f(v)} /></label>
  );
  return (
    <Dlg title="General defaults" onClose={onClose}>
      {num('Fine joggle step (Ctrl+arrows), mm', ed.joggleFine, (v) => v > 0 && ed.set({ joggleFine: v }))}
      {num('Coarse joggle step (Shift+arrows), mm', ed.joggleCoarse, (v) => v > 0 && ed.set({ joggleCoarse: v }))}
      {num('Tracking line length, mm', ed.trackLength, (v) => v > 0 && ed.set({ trackLength: v }))}
      {num('Point coincidence tolerance, mm', ed.coincidenceTol, (v) => ed.set({ coincidenceTol: v }))}
      {num('Undo buffer length (0 switches undo off)', limit, setLimit)}
    </Dlg>
  );
}
