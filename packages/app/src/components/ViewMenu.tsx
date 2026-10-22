import { useEffect, useRef, useState } from 'react';
import {
  UNIT_KINDS, UNIT_KIND_NAMES, UNIT_PRESETS, defaultUnits, presetSetting, toDisplay,
  type UnitKind, type UnitSetting, type UnitSettings,
} from '@claudus/core';
import { useUnits } from '../units';
import { Dlg } from './ComplianceDialogs';
import { STD_VIEWS, cameraApi, useViewCtl, type FillStyle } from '../viewCtl';
import { DisplayDialog, SavedViewsDialog, copyViewImage, saveViewImage } from './ViewControls';
import { SpaceMouseDialog } from './SpaceMouseDialog';
import { useSpaceMouse } from '../spacemouse';

/** SHARK's View menu: Change Units. */
export function ViewMenu() {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState(false);
  const [display, setDisplay] = useState(false);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const [mouse3d, setMouse3d] = useState(false);
  const smDevice = useSpaceMouse((s) => s.device);
  const vc = useViewCtl();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)}>View ▾</button>
      {open && (
        <div className="menulist" role="menu">
          <button onClick={() => { setOpen(false); cameraApi()?.fit(); }}>Autoscale / fit (Ctrl+A)</button>
          <button onClick={() => { setOpen(false); vc.setTool('box'); }}>Zoom box</button>
          <button onClick={() => { setOpen(false); vc.setTool('centre'); }}>Pick view centre</button>
          <button onClick={() => vc.set({ dyn: vc.dyn === 'rotate' ? 'pan' : vc.dyn === 'pan' ? 'zoom' : 'rotate' })}>Dynamic mode: {vc.dyn} (Alt+Z)</button>
          <div className="menuhead">Standard views</div>
          {STD_VIEWS.map(([id, label]) => (
            <button key={id} role="menuitemradio" aria-checked={vc.stdView === id} onClick={() => { setOpen(false); cameraApi()?.stdView(id); }}>
              <span className="tick">{vc.stdView === id ? '●' : ''}</span>{label}
            </button>
          ))}
          <button onClick={() => { setOpen(false); setSaved(true); }}>Saved views…</button>
          <button onClick={() => { setOpen(false); setMouse3d(true); }}>SpaceMouse…{smDevice ? ' (connected)' : ''}</button>
          <hr />
          <div className="menuhead">Fill style</div>
          {(['solid', 'wireframe', 'hidden'] as FillStyle[]).map((f) => (
            <button key={f} role="menuitemradio" aria-checked={vc.fill === f} onClick={() => vc.set({ fill: f })}>
              <span className="tick">{vc.fill === f ? '●' : ''}</span>{f === 'hidden' ? 'Hidden line' : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button onClick={() => { setOpen(false); setDisplay(true); }}>Display options (colours, labels, visibility)…</button>
          <hr />
          <button onClick={async () => { setNote(await copyViewImage()); }}>Copy view to clipboard</button>
          <button onClick={() => { setOpen(false); void saveViewImage(); }}>Save view as PNG…</button>
          {note && <div className="muted small pad">{note}</div>}
          <hr />
          <button onClick={() => { setOpen(false); setUnits(true); }}>Units…</button>
        </div>
      )}
      {units && <UnitsDialog onClose={() => setUnits(false)} />}
      {display && <DisplayDialog onClose={() => setDisplay(false)} />}
      {saved && <SavedViewsDialog onClose={() => setSaved(false)} />}
      {mouse3d && <SpaceMouseDialog onClose={() => setMouse3d(false)} />}
    </div>
  );
}

const EXAMPLE: Record<UnitKind, { value: number; unit: string }> = {
  angle: { value: 1.5, unit: 'deg' }, length: { value: 100, unit: 'mm' }, mass: { value: 10, unit: 'kg' }, force: { value: 500, unit: 'N' },
};

/** Pick the display unit of each kind. Applied at once; the data and files stay in deg, mm, kg and N. */
export function UnitsDialog({ onClose }: { onClose: () => void }) {
  const settings = useUnits((s) => s.settings);
  const setSettings = useUnits((s) => s.setSettings);
  const [draft, setDraft] = useState<UnitSettings>(settings);
  // Text of the user-defined scale while typing, per kind.
  const [scaleText, setScaleText] = useState<Record<UnitKind, string>>(() => Object.fromEntries(UNIT_KINDS.map((k) => [k, String(settings[k].scale)])) as Record<UnitKind, string>);

  const update = (k: UnitKind, s: UnitSetting) => {
    const next = { ...draft, [k]: s };
    setDraft(next);
    // Only a usable user-defined scale and label are applied.
    if (s.preset !== 'user' || (s.scale > 0 && Number.isFinite(s.scale) && s.label.trim())) setSettings(next);
  };
  const pick = (k: UnitKind, id: string) => {
    if (id === 'user') {
      update(k, { ...draft[k], preset: 'user' });
    } else {
      const p = presetSetting(k, id);
      setScaleText({ ...scaleText, [k]: String(p.scale) });
      update(k, p);
    }
  };
  const reset = () => {
    const d = defaultUnits();
    setDraft(d);
    setScaleText(Object.fromEntries(UNIT_KINDS.map((k) => [k, String(d[k].scale)])) as Record<UnitKind, string>);
    setSettings(d);
  };

  return (
    <Dlg title="Change units" onClose={onClose}>
      <p className="muted small">A viewing option only: model data and saved files always use deg, mm, kg and N. Your choice is kept for next time.</p>
      <table className="ctable unitstable">
        <thead><tr><th>Quantity</th><th>Unit</th><th>Scale</th><th>Label</th><th>Extra decimals</th><th>Example</th></tr></thead>
        <tbody>
          {UNIT_KINDS.map((k) => {
            const s = draft[k];
            const user = s.preset === 'user';
            const ex = EXAMPLE[k];
            return (
              <tr key={k}>
                <td>{UNIT_KIND_NAMES[k]}</td>
                <td>
                  <select aria-label={`${UNIT_KIND_NAMES[k]} unit`} value={s.preset} onChange={(e) => pick(k, e.target.value)}>
                    {UNIT_PRESETS[k].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="user">User-defined</option>
                  </select>
                </td>
                <td>
                  <input
                    className="numcell"
                    aria-label={`${UNIT_KIND_NAMES[k]} scale`}
                    disabled={!user}
                    value={user ? scaleText[k] : String(Number(s.scale.toPrecision(6)))}
                    onChange={(e) => { setScaleText({ ...scaleText, [k]: e.target.value }); const v = Number(e.target.value); update(k, { ...s, scale: Number.isFinite(v) && v > 0 ? v : NaN }); }}
                  />
                </td>
                <td>
                  <input
                    className="numcell"
                    aria-label={`${UNIT_KIND_NAMES[k]} label`}
                    disabled={!user}
                    maxLength={12}
                    value={s.label}
                    onChange={(e) => update(k, { ...s, label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="numcell"
                    type="number"
                    min={-6}
                    max={6}
                    aria-label={`${UNIT_KIND_NAMES[k]} extra decimals`}
                    disabled={!user}
                    value={s.extra}
                    onChange={(e) => update(k, { ...s, extra: Math.max(-6, Math.min(6, Math.round(Number(e.target.value)) || 0)) })}
                  />
                </td>
                <td className="muted">
                  {Number.isFinite(s.scale) ? `${ex.value} ${ex.unit} = ${Number(toDisplay(k, ex.value, draft).toPrecision(6))} ${s.label}` : 'enter a scale above 0'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row"><button onClick={reset}>Back to defaults</button></div>
    </Dlg>
  );
}
