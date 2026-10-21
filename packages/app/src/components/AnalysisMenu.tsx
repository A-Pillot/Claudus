import { DataItems } from './DataMenu';
import { useEffect, useRef, useState } from 'react';
import { steeringOf, type End } from '@claudus/core';
import { useApp } from '../store';
import { useModes, type ModeDialog } from '../modes';

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

const Check = ({ on, children, onClick, disabled, title }: { on: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) => (
  <button role="menuitemcheckbox" aria-checked={on} disabled={disabled} title={title} onClick={onClick}>
    <span className="tick">{on ? '✓' : ''}</span>{children}
  </button>
);

/** SHARK's Data menu entries for the combined motion, extended bump, static angle and steering data. */
export function DataMenu() {
  const m = useMenu();
  const model = useApp((s) => s.model);
  const end = useApp((s) => s.end);
  const replaceModel = useApp((s) => s.replaceModel);
  const open = (d: ModeDialog) => () => { m.setOpen(false); useModes.getState().set({ dialog: d }); };
  const useExt = model.extendedBump?.use ?? false;
  const box = steeringOf(model, end).type === 'box';
  return (
    <div className="menu" ref={m.ref}>
      <button onClick={() => m.setOpen(!m.open)} className={m.open ? 'on' : ''}>Data ▾</button>
      {m.open && (
        <div className="menulist" role="menu">
          <button onClick={open('static')}>Set static angles…</button>
          <hr />
          <button onClick={open('combined')}>Set / edit combined motion profile…</button>
          <Check on={useExt} onClick={() => replaceModel({ ...model, extendedBump: { steps: [], ...model.extendedBump, use: !useExt } })}>Use extended bump travel</Check>
          <button onClick={open('extended')}>Edit extended bump travel…</button>
          <hr />
          <button onClick={open('steering')}>Steering type…</button>
          <button disabled={!box} onClick={open('boxCoords')}>Edit box coords…</button>
          <DataItems close={() => m.setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** SHARK's Solve menu entries that this app handles: motion, roll solution, tolerances and tolerance analysis. */
export function SolveMenu() {
  const m = useMenu();
  const modes = useModes();
  const model = useApp((s) => s.model);
  const replaceModel = useApp((s) => s.replaceModel);
  const open = (d: ModeDialog) => () => { m.setOpen(false); modes.set({ dialog: d }); };
  const rollOld = model.rollSolution === 2;
  const tol = modes.tolPoint;
  const ends = (['front', 'rear'] as End[]).filter((e) => model[e]);
  const tolName = tol && model[tol.end] ? `${tol.end} point ${tol.index + 1}` : '';
  const toggleTol = () => {
    m.setOpen(false);
    if (!tol) modes.set({ dialog: 'tolPoint' });
    else modes.set({ tolOn: !modes.tolOn });
  };
  return (
    <div className="menu" ref={m.ref}>
      <button onClick={() => m.setOpen(!m.open)} className={m.open ? 'on' : ''}>Solve ▾</button>
      {m.open && (
        <div className="menulist" role="menu" style={{ left: 'auto', right: 0 }}>
          <div className="menuhead">Motion (bump)</div>
          <Check on={modes.motion === 'ground'} onClick={() => modes.set({ motion: 'ground' })}>Moving ground plane</Check>
          <Check on={modes.motion === 'body'} onClick={() => modes.set({ motion: 'body' })}>Moving body</Check>
          <div className="menuhead">Roll solution type</div>
          <Check on={!rollOld} onClick={() => replaceModel({ ...model, rollSolution: 1 })}>New: about the original roll centre</Check>
          <Check on={rollOld} onClick={() => replaceModel({ ...model, rollSolution: 2 })}>Old: about the previous step's centre</Check>
          <hr />
          <div className="menuhead">Adding a second axle</div>
          <Check on={modes.axleFit.wheelbase === 'parameter'} onClick={() => modes.set({ axleFit: { ...modes.axleFit, wheelbase: 'parameter' } })}>Wheelbase: change the parameter</Check>
          <Check on={modes.axleFit.wheelbase === 'move'} onClick={() => modes.set({ axleFit: { ...modes.axleFit, wheelbase: 'move' } })}>Wheelbase: move the added axle</Check>
          <Check on={modes.axleFit.ground === 'translate'} onClick={() => modes.set({ axleFit: { ...modes.axleFit, ground: 'translate' } })}>Ground plane: translate the added axle</Check>
          <Check on={modes.axleFit.ground === 'bump'} onClick={() => modes.set({ axleFit: { ...modes.axleFit, ground: 'bump' } })}>Ground plane: bump / rebound the added axle</Check>
          <hr />
          <button onClick={open('solverTol')}>Solver tolerances…</button>
          <Check on={modes.reportErrors} onClick={() => modes.set({ reportErrors: !modes.reportErrors })}>Report errors</Check>
          <hr />
          <div className="menuhead">Compliant analysis</div>
          <Check on={modes.rollBar} onClick={() => modes.set({ rollBar: !modes.rollBar })}>Suspension roll bar force</Check>
          <Check on={false} disabled title="Not implemented yet" onClick={() => undefined}>Rack cross-link force</Check>
          <Check on={modes.bushPreload} onClick={() => modes.set({ bushPreload: !modes.bushPreload })}>Bush rotation pre-loads</Check>
          <hr />
          <Check on={modes.tolOn && !!tol} disabled={!ends.length} onClick={toggleTol}>Point tolerance analysis{tolName ? ` (${tolName})` : ''}</Check>
          <button onClick={open('tolPoint')}>Set tolerance point…</button>
          <button onClick={open('pointTol')}>Edit point tolerances…</button>
          <button onClick={open('allTol')}>Set all point tolerances to…</button>
        </div>
      )}
    </div>
  );
}
