import { useEffect, useRef, useState } from 'react';
import { BODY_USER, elementName, hasElement, type ElementKind } from '@claudus/core';
import { useApp } from '../store';
import { addElementNow, currentTemplate, pickInView, useDataUi, type DataDialogId, type PlaceMode } from '../dataUi';
import { loadFileText } from '../openFile';
import { useSettings } from '../settings';
import { AddPointDialog, openAddPoint } from './AddPointDialog';
import { BodyDialog, DamperDialog, PropertiesDialog, TextEditDialog, TitlesDialog, TyreDialog, UserBodyDialog } from './DataDialogs';
import { AboutDialog, AllSettingsDialog, HelpDialog, useSettingsShortcut } from './SettingsDialogs';

/** A drop-down menu button that closes on an outside click. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return { open, setOpen, ref };
}

const MODE_NAMES: [PlaceMode, string][] = [['abs', 'Absolute position…'], ['rel', 'Relative to a point…'], ['between', 'Between two points…']];
const ELEMENTS: ElementKind[] = ['spring1', 'spring2', 'damper1', 'damper2'];

/** Items added to the Data menu: titles, tyres, body, dampers, model properties and the raw file text. */
export function DataItems({ close }: { close: () => void }) {
  const bodyType = useApp((s) => s.model.body?.type ?? 0);
  const show = (d: DataDialogId) => () => { close(); useDataUi.getState().setDialog(d); };
  return (
    <>
      <hr />
      <button onClick={show('properties')}>Model properties…</button>
      <button onClick={show('titles')}>Titles…</button>
      <button onClick={show('tyres')}>Tyre sizes…</button>
      <button onClick={show('body')}>Body type…</button>
      <button disabled={bodyType !== BODY_USER} onClick={show('userBody')} title={bodyType === BODY_USER ? '' : 'Choose the user defined body type first'}>Edit user body data…</button>
      <button onClick={show('dampers')}>Damper properties…</button>
      <button onClick={show('textEdit')}>File text edit…</button>
    </>
  );
}

/** Items added to the Edit menu: All Settings, Add Point and Add to Model. */
export function EditItems({ onError, close }: { onError: (msg: string | null) => void; close: () => void }) {
  useApp((s) => s.revision);
  const t = currentTemplate();
  const go = (f: () => void) => () => { close(); f(); };
  const addElement = (kind: ElementKind) => go(() => {
    onError(null);
    pickInView(`Add ${elementName(kind)}`, ['spring or damper end on the body', 'end on the suspension'], (p) => {
      try {
        addElementNow(kind, p[0], p[1]);
      } catch (e) {
        onError((e as Error).message);
      }
    });
  });
  return (
    <>
      <hr />
      <button onClick={go(() => useDataUi.getState().setDialog('allSettings'))}>All settings… (Ctrl+,)</button>
      <div className="menuhead">Add point</div>
      {MODE_NAMES.map(([m, label]) => <button key={'g' + m} disabled={!t} onClick={go(() => openAddPoint('point', 'ground', m))}>To body, {label}</button>)}
      {MODE_NAMES.map(([m, label]) => <button key={'p' + m} disabled={!t} onClick={go(() => openAddPoint('point', 'part', m))}>To part, {label}</button>)}
      <div className="menuhead">Add to model</div>
      {ELEMENTS.map((k) => {
        const exists = !!t && hasElement(t, k);
        return (
          <button key={k} disabled={!t || exists} title={exists ? `${elementName(k)} is already in this template` : 'Pick the body end, then the suspension end'} onClick={addElement(k)}>
            {elementName(k)} (pick two points)
          </button>
        );
      })}
      {MODE_NAMES.map(([m, label]) => <button key={'c' + m} disabled={!t} onClick={go(() => openAddPoint('cog', 'part', m))}>Part C of G, {label}</button>)}
    </>
  );
}

/** The last five files opened. */
export function RecentMenu({ onError }: { onError: (msg: string | null) => void }) {
  const { open, setOpen, ref } = useMenu();
  const recent = useSettings((s) => s.recent);
  const clear = useSettings((s) => s.clearRecent);
  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)} className={open ? 'on' : ''} disabled={!recent.length} title="Recent files">Recent ▾</button>
      {open && (
        <div className="menulist" role="menu" data-testid="recent-menu">
          {recent.map((r, i) => (
            <button
              key={r.name}
              disabled={r.text === undefined}
              title={r.text === undefined ? 'Too big to keep; use Open' : ''}
              onClick={() => { setOpen(false); onError(loadFileText({ name: r.name, text: r.text! })); }}
            >
              {i + 1} {r.name}
            </button>
          ))}
          <hr />
          <button onClick={() => { setOpen(false); clear(); }}>Clear list</button>
        </div>
      )}
    </div>
  );
}

export function HelpMenu() {
  const { open, setOpen, ref } = useMenu();
  const show = (d: DataDialogId) => () => { setOpen(false); useDataUi.getState().setDialog(d); };
  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)} className={open ? 'on' : ''}>Help ▾</button>
      {open && (
        <div className="menulist" role="menu">
          <button onClick={show('help')}>Help contents and search…</button>
          <button onClick={show('about')}>About Claudus…</button>
        </div>
      )}
    </div>
  );
}

/** Opens whichever data dialog is asked for, and binds Ctrl+S. */
export function DataDialogsHost() {
  const dialog = useDataUi((s) => s.dialog);
  useSettingsShortcut();
  switch (dialog) {
    case 'titles': return <TitlesDialog />;
    case 'tyres': return <TyreDialog />;
    case 'body': return <BodyDialog />;
    case 'userBody': return <UserBodyDialog />;
    case 'properties': return <PropertiesDialog />;
    case 'textEdit': return <TextEditDialog />;
    case 'dampers': return <DamperDialog />;
    case 'allSettings': return <AllSettingsDialog />;
    case 'addPoint': return <AddPointDialog />;
    case 'help': return <HelpDialog />;
    case 'about': return <AboutDialog />;
    default: return null;
  }
}
