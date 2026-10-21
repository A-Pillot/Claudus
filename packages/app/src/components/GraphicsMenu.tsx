import { useEffect, useRef, useState } from 'react';
import { ELEMENT_OPTIONS, getTemplate, hasTemplate, optionOf } from '@claudus/core';
import { useApp, type GraphicsView } from '../store';
import { useModes } from '../modes';
import { cancelAdd, deleteGraphic, startAdd } from '../graphicsActions';
import { captureFrame, useFrames } from '../video';
import { VideoDialog } from './VideoDialog';

const GROUPS = [...new Set(ELEMENT_OPTIONS.map((o) => o.group))];

const TOGGLES: [keyof GraphicsView, string][] = [
  ['pointNos', 'Point numbers'],
  ['pointValues', 'Point values'],
  ['bothSides', 'Display both sides'],
  ['triad', 'Triad (axes)'],
];

/** Compliance visibility (SHARK's Graphics / Compliance Visibility): drawn only in compliant mode. */
const COMPLIANCE_TOGGLES: [keyof GraphicsView, string][] = [
  ['showBushes', 'Bushes and rigid joints'],
  ['showBushAxes', 'Bush local axes'],
  ['showForces', 'External forces'],
  ['showJointForces', 'Calculated joint forces'],
  ['showCog', 'Part C of G markers'],
  ['showCogAxes', 'Part C of G local axes'],
];

/** SHARK's Graphics menu: add elements by picking points, delete the picked element, and display options. */
export function GraphicsMenu() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const selectedGraphic = useApp((s) => s.selectedGraphic);
  const selectGraphic = useApp((s) => s.selectGraphic);
  const data = useApp((s) => s.model[s.end]);
  useApp((s) => s.templatesRev);
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [video, setVideo] = useState(false);
  const limitsVisible = useModes((s) => s.limitsVisible);
  const limitsUse = useModes((s) => s.limitsUse);
  const frameCount = useFrames((s) => s.frames.length);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  // The Delete key removes the picked element, unless the user is typing in a field.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === 'Escape') cancelAdd();
      if (e.key === 'Delete' && !/INPUT|SELECT|TEXTAREA/.test(el.tagName)) {
        const g = useApp.getState().selectedGraphic;
        if (g !== null) deleteGraphic(g);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const t = data && hasTemplate(data.templateSlot) ? getTemplate(data.templateSlot) : undefined;
  const name = (i: number) => {
    const g = t!.graphics[i];
    return `${i + 1}  ${optionOf(g)?.name ?? g.kind}  (${g.points.join(', ')})`;
  };

  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)}>Graphics ▾</button>
      {open && (
        <div className="menulist" role="menu">
          <div className="menuhead">Add element</div>
          {GROUPS.map((gr) => (
            <div key={gr}>
              <button className="grouphead" onClick={() => setGroup(group === gr ? null : gr)}>{group === gr ? '▾' : '▸'} {gr}</button>
              {group === gr && ELEMENT_OPTIONS.filter((o) => o.group === gr).map((o) => (
                <button key={o.name} className="sub" onClick={() => { setOpen(false); startAdd(o); }}>{o.name}</button>
              ))}
            </div>
          ))}
          <hr />
          <button className="grouphead" disabled={!t?.graphics.length} onClick={() => setListing(!listing)}>{listing ? '▾' : '▸'} Pick element…</button>
          {listing && t && (
            <div className="elemlist">
              {t.graphics.map((_, i) => (
                <button key={i} className={'sub' + (selectedGraphic === i ? ' on' : '')} onClick={() => selectGraphic(selectedGraphic === i ? null : i)}>{name(i)}</button>
              ))}
            </div>
          )}
          <button disabled={selectedGraphic === null} onClick={() => { setOpen(false); if (selectedGraphic !== null) deleteGraphic(selectedGraphic); }}>
            Delete picked element{selectedGraphic !== null && t?.graphics[selectedGraphic] ? ` (${selectedGraphic + 1})` : ''}
          </button>
          <hr />
          {TOGGLES.map(([k, label]) => (
            <button key={k} role="menuitemcheckbox" aria-checked={view[k]} onClick={() => setView({ [k]: !view[k] })}>
              <span className="tick">{view[k] ? '✓' : ''}</span>{label}
            </button>
          ))}
          <hr />
          <div className="menuhead">Point limits</div>
          <button role="menuitemcheckbox" aria-checked={limitsVisible} onClick={() => useModes.getState().set({ limitsVisible: !limitsVisible })}>
            <span className="tick">{limitsVisible ? '✓' : ''}</span>Limit boxes visible
          </button>
          <button role="menuitemcheckbox" aria-checked={limitsUse} disabled={!limitsVisible} title="Limit boxes can only be in use while visible" onClick={() => useModes.getState().set({ limitsUse: !limitsUse })}>
            <span className="tick">{limitsUse ? '✓' : ''}</span>Limit boxes in use
          </button>
          <hr />
          <div className="menuhead">Compliance visibility</div>
          {COMPLIANCE_TOGGLES.map(([k, label]) => (
            <button key={k} role="menuitemcheckbox" aria-checked={view[k]} onClick={() => setView({ [k]: !view[k] })}>
              <span className="tick">{view[k] ? '✓' : ''}</span>{label}
            </button>
          ))}
          <hr />
          <button onClick={() => { setOpen(false); setVideo(true); }}>Export animation…</button>
          <button onClick={() => { setOpen(false); void captureFrame(); }}>Capture frame ({frameCount} captured)</button>
        </div>
      )}
      {video && <VideoDialog onClose={() => setVideo(false)} />}
    </div>
  );
}

/** Shown over the 3D view while an element is being added: what to pick next, and the typed-in numbers. */
export function AddBanner() {
  const a = useApp((s) => s.addMode);
  const setAddMode = useApp((s) => s.setAddMode);
  if (!a) return null;
  const { option, picked, params } = a;
  const next = option.prompts[picked.length];
  return (
    <div className="addbanner">
      <b>{option.group}: {option.name}</b>
      {option.params.map((p, i) => (
        <label key={p.label}>
          {p.label}
          <input
            type="number"
            value={params[i]}
            onChange={(e) => setAddMode({ ...a, params: params.map((v, k) => (k === i ? Number(e.target.value) : v)) })}
          />
        </label>
      ))}
      <span>
        {next ? `Pick ${picked.length + 1} of ${option.points}: ${next}` : ''}
        {picked.length > 0 && <span className="muted"> (picked {picked.join(', ')})</span>}
      </span>
      <button onClick={cancelAdd}>Cancel</button>
    </div>
  );
}
