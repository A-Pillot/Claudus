import { useState } from 'react';
import { convert2DTo3D, convertTargets, defaultTwoDConvertOptions, getTemplate, type End, type Model2D } from '@claudus/core';
import { useApp } from '../store';
import { NumberCell } from '../components/PointTable';
import { useTwoD } from './store2d';

/** Solve / Convert 2D to 3D: pick a 3D template and give the extra data the third dimension needs. */
export function ConvertDialog({ model, onClose }: { model: Model2D; onClose: () => void }) {
  const [o, setO] = useState(() => defaultTwoDConvertOptions(model));
  const [error, setError] = useState<string | null>(null);
  const fileName = useTwoD((s) => s.fileName);
  const hasData = useApp((s) => !!(s.model.front || s.model.rear));
  const dirty3d = useApp((s) => s.dirty);

  const create = () => {
    try {
      const m3 = convert2DTo3D(model, o);
      useApp.getState().setModel(m3, fileName.replace(/_2d\.dat$/i, '').replace(/\.dat$/i, '') + '_3d.dat');
      useApp.setState({ dirty: true });
      useTwoD.getState().deactivate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Convert 2D to 3D</h3>
        <label>3D suspension type</label>
        <div className="tpllist">
          {convertTargets(model.type).map((slot) => (
            <button key={slot} className={o.slot === slot ? 'on' : ''} onClick={() => setO({ ...o, slot })}>
              <b>{slot}</b> {getTemplate(slot).label}
            </button>
          ))}
        </div>
        <label>Axle</label>
        <div className="seg">
          {(['front', 'rear'] as End[]).map((e) => (
            <button key={e} className={o.end === e ? 'on' : ''} onClick={() => setO({ ...o, end: e })}>{e === 'front' ? 'Front' : 'Rear'}</button>
          ))}
        </div>
        <div className="row"><span className="vlabel">Wheelbase (mm)</span><NumberCell value={o.wheelbase} onCommit={(v) => v > 0 && setO({ ...o, wheelbase: v })} /></div>
        <div className="row"><span className="vlabel">Castor angle (deg)</span><NumberCell value={o.castor} onCommit={(v) => setO({ ...o, castor: v })} /></div>
        <div className="row"><span className="vlabel">Tyre rolling radius (mm)</span><NumberCell value={o.rollingRadius} onCommit={(v) => v > 0 && setO({ ...o, rollingRadius: v })} /></div>
        <p className="muted small">
          The 2D hard points go into the template; the points the 2D model does not have keep the template layout, moved with the part they belong to.
          {hasData && ' The current 3D model will be replaced.'}{hasData && dirty3d && ' It has unsaved changes.'}
        </p>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create} data-testid="convert-ok">Convert</button>
        </div>
      </div>
    </div>
  );
}
