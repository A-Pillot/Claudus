import { useState } from 'react';
import {
  createGroup, dataPoints, deleteCoordSet, deleteGroup, editGroup, getTemplate, groupIndexes, groupsOfEnd, hasTemplate, moveGroup,
  recallCoordSet, saveCoordSet, type Model, type Vec3,
} from '@claudus/core';
import { useApp } from '../store';
import { useTransfer } from '../transfer';
import { NumberCell } from './PointTable';

/** SHARK's SetUp / Groups (create, edit, delete, joggle a group) and Data / Coordinates (saved point sets). */
export function GroupsPanel() {
  const model = useApp((s) => s.model);
  const end = useApp((s) => s.end);
  const selected = useApp((s) => s.selected);
  const data = model[end];
  const { coordSets, setCoordSets } = useTransfer();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [delta, setDelta] = useState<Record<string, Vec3>>({});
  const [setName2, setSetName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!data) return <p className="muted pad">No {end} suspension in this model.</p>;
  if (!hasTemplate(data.templateSlot)) return <p className="muted pad">Template type {data.templateSlot} is not available yet.</p>;
  const pts = dataPoints(getTemplate(data.templateSlot));
  const groups = groupsOfEnd(model, end);

  /** Run a model change; show the message when it is refused. */
  const change = (f: (m: Model) => Model) => {
    try {
      const next = f(model);
      useApp.setState((s) => ({ model: next, dirty: true, revision: s.revision + 1 }));
      setError(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const reset = () => { setName(''); setEditing(null); setPicked(new Set()); };
  const submit = () => {
    const ok = editing === null
      ? change((m) => createGroup(m, name, end, [...picked]))
      : change((m) => editGroup(m, editing, { label: name, end, indexes: [...picked] }));
    if (ok) reset();
  };
  const vec = (label: string): Vec3 => delta[label] ?? [0, 0, 0];

  return (
    <div className="groups">
      <div className="gsection">
        <b>{editing === null ? 'New group' : `Edit group "${editing}"`}</b>
        <input className="gname" placeholder="Group label" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group label" />
        <div className="gpoints" aria-label="Group points">
          {pts.map((p, i) => (
            <label key={i} className={selected === i ? 'sel' : ''}>
              <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} /> {p.no} {p.label}
            </label>
          ))}
        </div>
        <div className="row">
          <button disabled={selected === null} onClick={() => selected !== null && setPicked((p) => new Set(p).add(selected))}>Add selected point</button>
          <button onClick={() => setPicked(new Set())} disabled={picked.size === 0}>Clear</button>
          <span className="grow" />
          {editing !== null && <button onClick={reset}>Cancel</button>}
          <button className="primary" onClick={submit} disabled={!name.trim() || picked.size === 0}>
            {editing === null ? `Create (${picked.size} points)` : `Update (${picked.size} points)`}
          </button>
        </div>
        {error && <div className="error" onClick={() => setError(null)}>{error}</div>}
      </div>

      <div className="gsection">
        <b>Groups on the {end} suspension</b>
        {groups.length === 0 && <p className="muted small">No groups yet.</p>}
        {groups.map((g) => (
          <div key={g.label} className="gitem">
            <div className="row">
              <span className="gtitle">{g.label}</span>
              <span className="muted small">{groupIndexes(g).map((i) => pts[i]?.no ?? i + 1).join(', ')}</span>
              <span className="grow" />
              <button onClick={() => { setEditing(g.label); setName(g.label); setPicked(new Set(groupIndexes(g))); }}>Edit</button>
              <button onClick={() => { change((m) => deleteGroup(m, g.label)); if (editing === g.label) reset(); }}>Delete</button>
            </div>
            <div className="row">
              <span className="muted small">Move by</span>
              {['dx', 'dy', 'dz'].map((a, k) => (
                <label key={a} className="axis">{a}<NumberCell value={vec(g.label)[k]} onCommit={(v) => setDelta({ ...delta, [g.label]: vec(g.label).map((x, j) => (j === k ? v : x)) as Vec3 })} /></label>
              ))}
              <button onClick={() => change((m) => moveGroup(m, g.label, vec(g.label)))}>Move</button>
            </div>
          </div>
        ))}
      </div>

      <div className="gsection">
        <b>Saved point sets</b>
        <div className="muted small">Kept until the program is closed, like SHARK's Data / Coordinates.</div>
        <div className="row">
          <input className="gname" placeholder="Label" value={setName2} onChange={(e) => setSetName(e.target.value)} aria-label="Saved set label" />
          <button disabled={!setName2.trim()} onClick={() => { try { setCoordSets(saveCoordSet(coordSets, setName2, model)); setSetName(''); setError(null); } catch (e) { setError((e as Error).message); } }}>Save current</button>
        </div>
        {coordSets.map((s) => (
          <div key={s.label} className="row gitem">
            <span className="gtitle">{s.label}</span>
            <span className="grow" />
            <button onClick={() => change((m) => recallCoordSet(coordSets, s.label, m))}>Recall</button>
            <button onClick={() => setCoordSets(deleteCoordSet(coordSets, s.label))}>Delete</button>
          </div>
        ))}
        {coordSets.length > 1 && <button onClick={() => setCoordSets([])}>Delete all</button>}
      </div>
    </div>
  );
}
