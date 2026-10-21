import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { useLab } from '../lab';
import { useSettings } from '../settings';
import { useViewCtl } from '../viewCtl';
import { editModel, useDataUi } from '../dataUi';
import { optimiserSnapshot } from '../openFile';
import { Dlg } from './ComplianceDialogs';
import { LINE_NAMES, MARKER_NAMES, type LineKind, type Marker } from './GraphOptions';

const close = () => useDataUi.getState().setDialog(null);

/** Edit / All Settings (Ctrl+S): the display, graph and file settings in one window. */
export function AllSettingsDialog() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const vc = useViewCtl();
  const hasOpt = useApp((s) => !!s.model.optimiser);
  const vis = useLab((s) => s.graphVis);
  const { settings, set, setStyle, reset } = useSettings();
  const check = (label: string, on: boolean, change: (v: boolean) => void) => (
    <label className="check"><input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} /> {label}</label>
  );
  const num = (label: string, key: 'markerSize' | 'textSize' | 'decimals', min: number, max: number) => (
    <div className="row">
      <label className="vlabel">{label}</label>
      <input type="number" aria-label={label} min={min} max={max} value={settings[key]} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set({ [key]: v }); }} />
    </div>
  );
  return (
    <Dlg title="All settings" onClose={close} wide>
      <div className="settingsgrid" data-testid="all-settings">
        <fieldset>
          <legend>3D view</legend>
          <p className="muted small">The same settings as View / 3D display options.</p>
          {check('Point numbers', view.pointNos, (v) => setView({ pointNos: v }))}
          {check('Point values', view.pointValues, (v) => setView({ pointValues: v }))}
          {check('Show both sides', view.bothSides, (v) => setView({ bothSides: v }))}
          {check('Triad', view.triad, (v) => setView({ triad: v }))}
          {check('Body graphics', vc.showBodyGraphics, (v) => vc.set({ showBodyGraphics: v }))}
          {check('Springs', vc.showSprings, (v) => vc.set({ showSprings: v }))}
          {check('Dampers', vc.showDampers, (v) => vc.set({ showDampers: v }))}
          {check('Wheels', vc.showWheels, (v) => vc.set({ showWheels: v }))}
          {check('Ground grid', vc.showGround, (v) => vc.set({ showGround: v }))}
        </fieldset>
        <fieldset>
          <legend>Graph lines shown</legend>
          {check('Deviation values', vis.deviation, (v) => useLab.getState().setGraphVis({ deviation: v }))}
          {check('User line', vis.userLine, (v) => useLab.getState().setGraphVis({ userLine: v }))}
          {check('Scope lines', vis.scope, (v) => useLab.getState().setGraphVis({ scope: v }))}
          {check('Derivative values', vis.derivative, (v) => useLab.getState().setGraphVis({ derivative: v }))}
          {check('-Y (left) wheel lines', vis.left, (v) => useLab.getState().setGraphVis({ left: v }))}
        </fieldset>
        <fieldset>
          <legend>Graph display</legend>
          {num('Marker size (px)', 'markerSize', 1, 12)}
          {num('Text size (px)', 'textSize', 6, 24)}
          {num('Decimal places', 'decimals', 0, 8)}
          <div className="row">
            <label className="vlabel">Scope position symbol</label>
            <select aria-label="Scope position symbol" value={settings.scopeSymbol} onChange={(e) => set({ scopeSymbol: e.target.value as Marker })}>
              {(Object.keys(MARKER_NAMES) as Marker[]).map((m) => <option key={m} value={m}>{MARKER_NAMES[m]}</option>)}
            </select>
          </div>
        </fieldset>
        <fieldset>
          <legend>Line colours and markers</legend>
          {(Object.keys(LINE_NAMES) as LineKind[]).map((k) => (
            <div className="row" key={k}>
              <label className="vlabel">{LINE_NAMES[k]}</label>
              <input type="color" aria-label={`${LINE_NAMES[k]} colour`} value={settings.style[k].colour} onChange={(e) => setStyle({ ...settings.style, [k]: { ...settings.style[k], colour: e.target.value } })} />
              <select aria-label={`${LINE_NAMES[k]} marker`} value={settings.style[k].marker} onChange={(e) => setStyle({ ...settings.style, [k]: { ...settings.style[k], marker: e.target.value as Marker } })}>
                {(Object.keys(MARKER_NAMES) as Marker[]).map((m) => <option key={m} value={m}>{MARKER_NAMES[m]}</option>)}
              </select>
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend>Data files</legend>
          {check('Include optimiser settings in data files', hasOpt, (on) => editModel((m) => { if (on) m.optimiser = optimiserSnapshot(); else delete m.optimiser; }))}
          <p className="muted small">The optimiser parameters, its settings and the kinematic sum targets are saved in a Claudus-only section, so SHARK still opens the file.</p>
        </fieldset>
      </div>
      <p className="muted small">Settings are kept in this browser (or the desktop app) for next time.</p>
      <div className="row"><button onClick={reset}>Back to defaults</button></div>
    </Dlg>
  );
}

/** Ctrl+, opens All Settings (Ctrl+S is Save). */
export function useSettingsShortcut(): void {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault();
        useDataUi.getState().setDialog('allSettings');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
}

// ---- Help and About -----------------------------------------------------------------------------------

const HELP: { title: string; text: string }[] = [
  {
    title: 'Getting started',
    text: 'Open a SHARK data file with Open, or start a model with New and pick a suspension type. The hard points are listed on the left and drawn in the 3D view. Drag the sliders under the 3D view to move the suspension through bump, roll and steer. The graphs below show the results of the full sweeps.',
  },
  {
    title: 'Editing hard points',
    text: 'Type new coordinates in the Hard points table, or click a point in the 3D view to select it. Edit / Add Point puts a new point on the body or on a part, at an absolute position, relative to a point, or between two points. Edit / Add to Model joins two points as a spring or damper, or sets a part C of G.',
  },
  {
    title: 'Data menu',
    text: 'Data / Model Properties shows every data field as a tree. Titles, Tyre Sizes (rolling radius and width) and Body Type are separate windows. User body data takes lines and facets as text, or an STL file. Damper Properties lists all four damper rates. File Text Edit shows the raw data file and reads it back when you apply.',
  },
  {
    title: 'Graphs',
    text: 'Each graph can be closed with its cross, and + Add graph opens another. Choose the sweep and the variable in the header. Right-click a graph for user lines, scope lines and appearance. Graphs / Autoscale Y only keeps the X zoom; the Y increment box scales every Y axis to whole steps. Marker and text sizes, decimal places and the scope position symbol are in Edit / All Settings (Ctrl+,).',
  },
  {
    title: 'Scope and user lines',
    text: 'Scope lines store a copy of all results to compare later (five slots). A user line is a target curve you type in or copy from the data. Manage user lines keeps named sets, which can be saved to and loaded from files, or included into the current user lines.',
  },
  {
    title: 'Compliance',
    text: 'Solve / 3D Compliance switches to the compliant solution. Bushes, springs, dampers, tyre rates and external forces are in the Compliance menus. The coefficient charts show compliant minus kinematic values per force set. Right-click a bar to change its variable, limit, scale or weight.',
  },
  {
    title: 'Files',
    text: 'Claudus reads and writes SHARK data files. Things SHARK has no place for (body graphics, optimiser settings, extra compliance data) go in separate CLAUDUS sections that SHARK ignores. The last five files opened are listed under Recent.',
  },
  {
    title: 'Keyboard',
    text: 'Ctrl+S saves the file and Ctrl+, opens All Settings. Escape closes a window. In a number box, Enter accepts the value and Escape puts the old one back. Double-click a graph to autoscale it.',
  },
];

export function HelpDialog() {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = HELP.filter((h) => words.every((w) => (h.title + ' ' + h.text).toLowerCase().includes(w)));
  return (
    <Dlg title="Help" onClose={close}>
      <input aria-label="Search help" placeholder="Search help" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="helptext" data-testid="help-text">
        {shown.map((h) => (
          <section key={h.title}>
            <h4>{h.title}</h4>
            <p>{h.text}</p>
          </section>
        ))}
        {shown.length === 0 && <p className="muted">Nothing matches "{q}".</p>}
      </div>
    </Dlg>
  );
}

export function AboutDialog() {
  return (
    <Dlg title="About Claudus" onClose={close}>
      <p><b>Claudus</b> {__APP_VERSION__}</p>
      <p>A suspension analysis program for kinematics and compliance, written from scratch in TypeScript to read and write the data files of Lotus SHARK. It is not made by or connected with Lotus Engineering.</p>
      <p className="muted small">Source and issues: github.com/A-Pillot/Claudus</p>
    </Dlg>
  );
}
