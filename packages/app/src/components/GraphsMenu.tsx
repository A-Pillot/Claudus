import { useEffect, useRef, useState } from 'react';
import type { End, EndAnalysis } from '@claudus/core';
import { SCOPE_SLOTS, useLab } from '../lab';
import { allLines } from './Graphs';
import { useDataUi } from '../dataUi';

const NAMES: Record<End, string> = { front: 'Front', rear: 'Rear' };

/** SHARK's Graphs menu: visibility, scope line store, copy to user line and the user line sets. */
export function GraphsMenu({ results, busy }: { results?: EndAnalysis[]; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const vis = useLab((s) => s.graphVis);
  const scope = useLab((s) => s.scope);
  const devSlot = useLab((s) => s.scopeDevSlot);
  const userCount = useLab((s) => s.userLines.length);
  const yInc = useLab((s) => s.yIncrement);
  const [yIncText, setYIncText] = useState(yInc ? String(yInc) : '');
  const lab = useLab.getState;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const ends = (results ?? []).map((r) => r.end);
  const have = !!results && !busy;
  const slots = [...Array(SCOPE_SLOTS).keys()];
  const done = (fn: () => void) => () => { fn(); setOpen(false); };
  const toggle = (k: 'deviation' | 'userLine' | 'scope' | 'derivative' | 'left', label: string) => (
    <button role="menuitemcheckbox" aria-checked={vis[k]} onClick={() => lab().setGraphVis({ [k]: !vis[k] })}>
      <span className="tick">{vis[k] ? '✓' : ''}</span>{label}
    </button>
  );
  const copyToUser = (rows: EndAnalysis[] | null, end: End) => {
    const lines = [...allLines(rows ?? undefined, end), ...(vis.left ? allLines(rows ?? undefined, end, 'left') : [])];
    // The copy replaces that end's user lines (both sides when the -Y lines are shown).
    lab().setUserLines([...useLab.getState().userLines.filter((l) => l.end !== end || (!vis.left && l.side === 'left')), ...lines]);
  };

  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)} className={open ? 'on' : ''}>Graphs ▾</button>
      {open && (
        <div className="menulist wide" role="menu">
          <div className="menuhead">Visibility</div>
          {toggle('deviation', 'Deviation values')}
          {toggle('userLine', 'User line')}
          {toggle('scope', 'Scope lines')}
          {toggle('derivative', 'Derivative values')}
          {toggle('left', '-Y (left) wheel lines')}
          <hr />
          <div className="menurow"><span>All graphs</span>
            <button onClick={done(() => lab().sendGraphCmd('swap'))}>Switch x-y</button>
            <button onClick={done(() => lab().sendGraphCmd('autoscale'))}>Autoscale</button>
            <button onClick={done(() => lab().sendGraphCmd('autoscaleY'))} title="Rescale the Y axis only, keeping any zoom on X">Autoscale Y only</button>
            <button onClick={done(() => lab().sendGraphCmd('styles'))} title="Set every graph's colours and markers back to the defaults">Default styles</button>
          </div>
          <div className="menurow"><span>Y increment</span>
            <input className="yinc" type="number" min={0} step="any" aria-label="Y increment" value={yIncText} placeholder="off" onChange={(e) => setYIncText(e.target.value)} />
            <button onClick={() => lab().setYIncrement(Number(yIncText))} title="Scale every Y axis to whole steps of this size">Autoscale to Y increment</button>
            <button disabled={!yInc} onClick={() => { setYIncText(''); lab().setYIncrement(0); }}>Off</button>
          </div>
          <div className="menurow"><span>Graphs</span>
            <button onClick={done(() => lab().sendGraphCmd('add'))}>New graph</button>
            <button onClick={done(() => lab().sendGraphCmd('closeAll'))}>Close all</button>
            <button onClick={done(() => useDataUi.getState().setDialog('allSettings'))} title="Marker and text sizes, decimal places, scope symbol">Display settings…</button>
          </div>
          <hr />
          <div className="menuhead">Scope lines</div>
          <div className="menurow"><span>Store</span>
            <button disabled={!have} onClick={done(() => lab().exclusiveScope(results!))} title="Store in position 1 and empty the others">Exclusive</button>
            <button disabled={!have} onClick={done(() => lab().shuffleScope(results!))} title="Store in position 1 after moving the others down one">Shuffle</button>
          </div>
          <div className="menurow"><span>Store in</span>
            {slots.map((i) => <button key={i} disabled={!have} className={scope[i] ? 'on' : ''} onClick={done(() => lab().storeScope(i, results!))}>{i + 1}</button>)}
          </div>
          <div className="menurow"><span>Clear</span>
            <button disabled={!scope.some(Boolean)} onClick={done(() => lab().clearScope())}>All</button>
            {slots.map((i) => <button key={i} disabled={!scope[i]} onClick={done(() => lab().clearScope(i))}>{i + 1}</button>)}
          </div>
          <div className="menurow"><span>Deviation from</span>
            {slots.map((i) => <button key={i} className={devSlot === i ? 'on' : ''} aria-pressed={devSlot === i} onClick={() => lab().setScopeDevSlot(i)}>{i + 1}</button>)}
          </div>
          <hr />
          <div className="menuhead">Copy to user lines</div>
          {ends.map((e) => <button key={e} disabled={!have} onClick={done(() => copyToUser(results!, e))}>Copy {NAMES[e].toLowerCase()} data to user</button>)}
          {ends.map((e) => (
            <div className="menurow" key={'s' + e}><span>{NAMES[e]} scope to user</span>
              {slots.map((i) => <button key={i} disabled={!scope[i]} onClick={done(() => copyToUser(scope[i], e))}>{i + 1}</button>)}
            </div>
          ))}
          <button disabled={!userCount} onClick={done(() => lab().clearUserLines())}>Clear current user store</button>
          <hr />
          <button onClick={done(() => lab().setManageLines(true))}>Manage user lines…</button>
        </div>
      )}
    </div>
  );
}
