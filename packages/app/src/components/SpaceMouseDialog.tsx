import { useState } from 'react';
import { isDesktop } from '../desktop';
import {
  connectSpaceMouse, defaultSpaceMouseSettings, disconnectSpaceMouse, spaceMouseSupported, useSpaceMouse, type SpaceMouseSettings,
} from '../spacemouse';
import { Dlg } from './ComplianceDialogs';

/** View / SpaceMouse: connect a 3Dconnexion device and set how it moves the 3D view. */
export function SpaceMouseDialog({ onClose }: { onClose: () => void }) {
  const { settings, setSettings, device, source, error } = useSpaceMouse();
  const [note, setNote] = useState<string | null>(null);
  const desktop = isDesktop();
  const check = (k: keyof SpaceMouseSettings, label: string) => (
    <label key={k}><input type="checkbox" checked={settings[k] as boolean} onChange={(e) => setSettings({ [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <Dlg title="SpaceMouse" onClose={onClose}>
      <div className="row">
        <span>{device ? <>Connected: <b>{device}</b>{source === 'native' ? ' (desktop reader)' : ' (WebHID)'}</> : 'No SpaceMouse connected.'}</span>
      </div>
      {!spaceMouseSupported() && (
        <p className="muted small">This browser cannot reach USB devices (no WebHID). Use Chrome, Edge or Opera, or the desktop app.</p>
      )}
      {!desktop && spaceMouseSupported() && (
        <div className="row">
          {device
            ? <button onClick={() => void disconnectSpaceMouse()}>Disconnect</button>
            : <button onClick={async () => setNote(await connectSpaceMouse())}>Connect SpaceMouse…</button>}
        </div>
      )}
      {desktop && !device && <p className="muted small">The desktop app looks for a SpaceMouse every few seconds; plug it in and it connects by itself.</p>}
      {(note ?? error) && <p className="muted small">{note ?? error}</p>}
      <div className="checkgrid">
        {check('enabled', 'Use the SpaceMouse in the 3D view')}
        {check('pan', 'Pan (push left, right, up, down)')}
        {check('zoom', 'Zoom (push forward or pull back)')}
        {check('rotate', 'Rotate (tilt and twist)')}
        {check('invertPan', 'Reverse pan')}
        {check('invertZoom', 'Reverse zoom')}
        {check('invertRotate', 'Reverse rotation')}
      </div>
      <div className="row">
        <label>Speed <input type="range" aria-label="SpaceMouse speed" min={0.1} max={4} step={0.1} value={settings.speed} onChange={(e) => setSettings({ speed: Number(e.target.value) })} /> {settings.speed.toFixed(1)}×</label>
        <label>Dead zone <input type="range" aria-label="SpaceMouse dead zone" min={0} max={0.4} step={0.01} value={settings.deadZone} onChange={(e) => setSettings({ deadZone: Number(e.target.value) })} /> {Math.round(settings.deadZone * 100)}%</label>
      </div>
      <p className="muted small">
        The model follows the cap: push to pan, pull to zoom in, tilt to tip the model, twist to turn it.
        Buttons: left (Menu) = isometric view, right (Fit) = autoscale; on a SpaceMouse Pro, T, R and F give the top, right and front views.
      </p>
      <div className="row"><button onClick={() => setSettings({ ...defaultSpaceMouseSettings })}>Back to defaults</button></div>
    </Dlg>
  );
}
