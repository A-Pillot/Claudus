import { useEffect, useRef, useState } from 'react';
import {
  addRollBar, addTwoPartRack, convertPointsToAxle, dataPoints, expandPoints, findGen, formatTemplates, GenType, getTemplate,
  hasTemplate, isCustomTemplate, nextFreeSlot, parseTemplates, type Template, type Vec3,
} from '@claudus/core';
import { useApp } from '../store';
import { files } from '../files';
import { addToLibrary, clearLibrary, customTemplates } from '../templates';
import { NumberCell } from './PointTable';
import { TemplateEditor } from './TemplateEditor';

type Dialog = 'edit' | 'rollbar' | 'rack' | null;

/** SHARK's template functions: File / Edit Templates, the Edit menu template tools, and template files. */
export function TemplateMenu({ onError }: { onError: (msg: string | null) => void }) {
  const data = useApp((s) => s.model[s.end]);
  const applyTemplate = useApp((s) => s.applyTemplate);
  const templatesChanged = useApp((s) => s.templatesChanged);
  useApp((s) => s.templatesRev);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const t = data && hasTemplate(data.templateSlot) ? getTemplate(data.templateSlot) : undefined;
  const full = !!t?.fullAxle;
  const run = (f: () => void) => () => {
    setOpen(false);
    try {
      f();
      onError(null);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  // A changed built-in template is saved under a new number, keeping the original intact.
  const target = (base: Template) => (isCustomTemplate(base.slot) ? base.slot : nextFreeSlot());

  const convert = run(() => {
    if (!t || !data) return;
    const out = convertPointsToAxle(t, data.points, { slot: target(t), label: `${t.label} (full axle)` });
    applyTemplate(out.template, out.points);
  });
  const loadFile = run(async () => {
    const f = await files().open('.dat,.tpl,.txt');
    if (!f) return;
    try {
      const list = parseTemplates(f.text, 'user');
      addToLibrary(list);
      templatesChanged();
      onError(`Loaded ${list.length} template${list.length === 1 ? '' : 's'} from ${f.name}.`);
    } catch (e) {
      onError(`Could not read templates from ${f.name}: ${(e as Error).message}`);
    }
  });
  const saveFile = run(async () => {
    const list = customTemplates();
    if (!list.length) throw new Error('There are no user templates to save yet.');
    await files().save('_User_Templates.Dat', formatTemplates(list));
  });
  const reset = run(() => {
    if (!window.confirm('Remove all your templates and go back to the built-in set? Models that use them will need them loaded again.')) return;
    clearLibrary();
    templatesChanged();
  });

  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className={open ? 'on' : ''}>Template ▾</button>
      {open && (
        <div className="menulist">
          <button disabled={!t} onClick={() => { setOpen(false); setDialog('edit'); }}>Edit template…</button>
          <hr />
          <button disabled={!t || full} onClick={convert}>Convert corner to full axle</button>
          <button disabled={!full} onClick={() => { setOpen(false); setDialog('rollbar'); }}>Add roll bar…</button>
          <button disabled={!full || !t || !findGen(t, GenType.SteeringAttachment2)} onClick={() => { setOpen(false); setDialog('rack'); }}>Add two-part rack…</button>
          <hr />
          <button onClick={loadFile}>Load templates file…</button>
          <button onClick={saveFile}>Save my templates…</button>
          <button onClick={reset}>Reset to built-in templates</button>
        </div>
      )}
      {dialog === 'edit' && t && <TemplateEditor template={t} onClose={() => setDialog(null)} />}
      {dialog === 'rollbar' && t && data && <RollBarDialog template={t} points={data.points} target={target(t)} onClose={() => setDialog(null)} onError={onError} />}
      {dialog === 'rack' && t && data && <RackDialog template={t} points={data.points} target={target(t)} onClose={() => setDialog(null)} onError={onError} />}
    </div>
  );
}

function VecInput({ label, value, onChange }: { label: string; value: Vec3; onChange: (v: Vec3) => void }) {
  return (
    <div className="row">
      <label className="vlabel">{label}</label>
      {[0, 1, 2].map((k) => (
        <NumberCell key={k} value={value[k]} onCommit={(v) => onChange(value.map((x, j) => (j === k ? v : x)) as Vec3)} />
      ))}
    </div>
  );
}

interface ToolProps {
  template: Template;
  points: Vec3[];
  target: number;
  onClose: () => void;
  onError: (msg: string | null) => void;
}

/** The template under its new number, labelled as a custom copy when it leaves a built-in slot. */
const retarget = (t: Template, slot: number): Template => (slot === t.slot ? t : { ...t, slot, label: `${t.label} (custom)` });

/** The current position of each template point (by number) in the model. */
function positions(t: Template, points: Vec3[]): Map<number, Vec3> {
  const all = expandPoints(t, points.slice(0, dataPoints(t).length));
  return new Map(t.points.map((p, i) => [p.no, all[i]]));
}

function RollBarDialog({ template: t, points, target, onClose, onError }: ToolProps) {
  const applyTemplate = useApp((s) => s.applyTemplate);
  // Right-hand parts only: the left copies carry a "(2)" label.
  const parts = t.parts.map((label, i) => ({ label, k: i + 1 })).filter((p) => !/ \(2\)$/.test(p.label) && t.parts.includes(`${p.label} (2)`));
  const [part, setPart] = useState(parts.find((p) => /lower/i.test(p.label))?.k ?? parts[0]?.k ?? 1);
  const pos = positions(t, points);
  const centroid = (k: number): Vec3 => {
    const on = t.points.filter((p) => (p.part1 === k || p.part2 === k) && !p.dummy).map((p) => pos.get(p.no)!);
    const c = on.reduce<Vec3>((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]);
    return c.map((v) => Math.round(v / Math.max(1, on.length))) as Vec3;
  };
  const [link, setLink] = useState<Vec3>(() => centroid(part));
  const [barEnd, setBarEnd] = useState<Vec3>(() => [link[0], link[1], link[2] + 130]);
  const [mount, setMount] = useState<Vec3>(() => [link[0] + 180, Math.round(link[1] * 0.6), link[2] + 130]);

  const apply = () => {
    try {
      const nt = addRollBar(retarget(t, target), { part, link, barEnd, mount });
      // New points sit after the existing data points, at the positions just entered.
      applyTemplate(nt, [...points.slice(0, dataPoints(t).length), ...dataPoints(nt).slice(dataPoints(t).length).map((p) => p.def)]);
      onError(null);
      onClose();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Add roll bar</h3>
        <p className="muted">A bar in two halves turning in body mounts, with a drop link to each side. The left side is mirrored for you.</p>
        <label>Drop link attaches to</label>
        <select value={part} onChange={(e) => { const k = Number(e.target.value); setPart(k); setLink(centroid(k)); }}>
          {parts.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
        </select>
        <VecInput label="Drop link to suspension" value={link} onChange={setLink} />
        <VecInput label="Drop link to bar" value={barEnd} onChange={setBarEnd} />
        <VecInput label="Bar mount to body" value={mount} onChange={setMount} />
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={apply}>Add roll bar</button>
        </div>
      </div>
    </div>
  );
}

function RackDialog({ template: t, points, target, onClose, onError }: ToolProps) {
  const applyTemplate = useApp((s) => s.applyTemplate);
  const pos = positions(t, points);
  const steer = pos.get(findGen(t, GenType.SteeringAttachment)!.no)!;
  const [link, setLink] = useState<Vec3>([steer[0], Math.round(steer[1] - 50), steer[2]]);
  const [mount, setMount] = useState<Vec3>([steer[0] + 30, Math.round(steer[1] - 50), steer[2]]);
  const apply = () => {
    try {
      const nt = addTwoPartRack(retarget(t, target), { link, mount });
      applyTemplate(nt, [...points.slice(0, dataPoints(t).length), ...dataPoints(nt).slice(dataPoints(t).length).map((p) => p.def)]);
      onError(null);
      onClose();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Add two-part rack</h3>
        <p className="muted">The inner track rod joints move onto a rack link that slides in a housing mounted to the body. The left side is mirrored for you.</p>
        <VecInput label="Rack link end" value={link} onChange={setLink} />
        <VecInput label="Housing mount" value={mount} onChange={setMount} />
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={apply}>Add rack</button>
        </div>
      </div>
    </div>
  );
}
