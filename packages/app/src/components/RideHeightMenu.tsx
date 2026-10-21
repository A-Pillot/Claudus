import { useEffect, useRef, useState } from 'react';
import { adjustSprings, matchToSprings, matchToWeightChange, setRideHeight, type Model } from '@claudus/core';
import { useApp } from '../store';

type Mode = 'bump' | 'pitch' | 'adjust' | 'match' | 'weight';

const ITEMS: [Mode, string][] = [
  ['bump', 'Bump…'],
  ['pitch', 'Bump + Pitch…'],
  ['adjust', 'Adjust Springs…'],
  ['match', 'Match to Springs…'],
  ['weight', 'Match to Weight Change…'],
];

const HELP: Record<Mode, string> = {
  bump: 'Move the model to a new ride height. A positive bump lowers the body.',
  pitch: 'Move the model by a bump and a pitch angle. Positive pitch lowers the rear. A full vehicle pitches about the front wheel centres, a single end about its own.',
  adjust: 'Change the spring fitted lengths so the springs carry the weight. The ride height does not change.',
  match: 'Move the body until the springs, as they are, carry the weight. Spring fitted lengths follow the new position.',
  weight: 'Move the body by the change in spring load between two weight conditions. The start need not balance the springs.',
};

/** SHARK's Solve / Set Ride Height utilities. */
export function RideHeightMenu({ onError }: { onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)}>Ride height ▾</button>
      {open && (
        <div className="menulist" role="menu">
          {ITEMS.map(([m, label]) => (
            <button key={m} onClick={() => { setOpen(false); setMode(m); }}>{label}</button>
          ))}
        </div>
      )}
      {mode && <RideHeightDialog mode={mode} onClose={() => setMode(null)} onError={onError} />}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="row">
      <label className="vlabel">{label}</label>
      <input className="numcell" type="number" value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function RideHeightDialog({ mode, onClose, onError }: { mode: Mode; onClose: () => void; onError: (msg: string) => void }) {
  const model = useApp((s) => s.model);
  const replaceModel = useApp((s) => s.replaceModel);
  const [bump, setBump] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [mass, setMass] = useState(1200);
  const [pct, setPct] = useState(model.params.weightFrontPct || 50);
  const [mass2, setMass2] = useState(1200);
  const [pct2, setPct2] = useState(model.params.weightFrontPct || 50);
  const full = !!(model.front && model.rear);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const apply = () => {
    try {
      let out: Model;
      if (mode === 'bump') out = setRideHeight(model, bump);
      else if (mode === 'pitch') out = setRideHeight(model, bump, pitch);
      else if (mode === 'adjust') out = adjustSprings(model, mass, pct);
      else if (mode === 'match') out = matchToSprings(model, mass, pct);
      else out = matchToWeightChange(model, { mass, frontPct: pct }, { mass: mass2, frontPct: pct2 });
      replaceModel(out);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const title = ITEMS.find(([m]) => m === mode)![1].replace('…', '');
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label={`Set ride height: ${title}`} onClick={(e) => e.stopPropagation()}>
        <h3>Set ride height: {title}</h3>
        <p className="muted">{HELP[mode]}</p>
        {(mode === 'bump' || mode === 'pitch') && <Field label="Bump change (mm)" value={bump} onChange={setBump} />}
        {mode === 'pitch' && <Field label="Pitch change (deg)" value={pitch} onChange={setPitch} />}
        {(mode === 'adjust' || mode === 'match' || mode === 'weight') && (
          <>
            {mode === 'weight' && <div className="menuhead">From</div>}
            <Field label="Mass on springs (kg)" value={mass} onChange={setMass} />
            {full && <Field label="Weight on front (%)" value={pct} onChange={setPct} />}
          </>
        )}
        {mode === 'weight' && (
          <>
            <div className="menuhead">To</div>
            <Field label="Mass on springs (kg)" value={mass2} onChange={setMass2} />
            {full && <Field label="Weight on front (%)" value={pct2} onChange={setPct2} />}
          </>
        )}
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  );
}
