import { useEffect, useRef, useState } from 'react';
import type { End, EndAnalysis } from '@claudus/core';
import { SCOPE_SLOTS, useLab } from '../lab';
import { allLines } from './Graphs';

const NAMES: Record<End, string> = { front: 'Front', rear: 'Rear' };

/** SHARK's Graphs menu: visibility, scope line store, copy to user line and the user line sets. */
export function GraphsMenu({ results, busy }: { results?: EndAnalysis[]; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const vis = useLab((s) => s.graphVis);
  const scope = useLab((s) => s.scope);
  const devSlot = useLab((s) => s.scopeDevSlot);
  const userCount = useLab((s) => s.userLines.length);
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
  const toggle = (k: 'deviation' | 'userLine' | 'scope', label: string) => (
    <button role="menuitemcheckbox" aria-checked={vis[k]} onClick={() => lab().setGraphVis({ [k]: !vis[k] })}>
      <span className="tick">{vis[k] ? '✓' : ''}</span>{label}
    </button>
  );
  const copyToUser = (rows: EndAnalysis[] | null, end: End) => {
    const lines = allLines(rows ?? undefined, end);
    // The copy replaces that end's user lines.
    lab().setUserLines([...useLab.getState().userLines.filter((l) => l.end !== end), ...lines]);
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
