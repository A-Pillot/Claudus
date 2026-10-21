import { useState } from 'react';
import type { UserLineSet } from '@claudus/core';
import { useLab } from '../lab';
import { files } from '../files';
import { exportSets, importSets, loadSets, storeSets } from '../userLineSets';
import { Dlg } from './ComplianceDialogs';
import { NumberCell } from './PointTable';

/** The right-mouse "Edit user line" table: x and y per row, sorted ascending on x when it is closed. */
export function EditUserLineDialog() {
  const target = useLab((s) => s.editLine);
  if (!target) return null;
  return <EditBody key={`${target.end}:${target.sweep}:${target.variable}`} />;
}

function EditBody() {
  const target = useLab((s) => s.editLine)!;
  const existing = useLab((s) => s.userLines.find((l) => l.end === target.end && l.sweep === target.sweep && l.variable === target.variable));
  const [rows, setRows] = useState<[number, number][]>(() => (existing ? existing.points.map((p) => [...p] as [number, number]) : []));
  const close = () => {
    // Rows are sorted into ascending x on closure; an empty table removes the line.
    useLab.getState().setUserLine({ end: target.end, sweep: target.sweep, variable: target.variable, points: rows });
    useLab.getState().setEditLine(null);
  };
  const set = (i: number, k: 0 | 1, v: number) => setRows(rows.map((r, j) => (j === i ? (k === 0 ? [v, r[1]] : [r[0], v]) : r) as [number, number]));
  const add = () => {
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    setRows([...rows, last ? [last[0] + (prev ? last[0] - prev[0] : 10), last[1]] : [0, 0]]);
  };
  return (
    <Dlg title={`User line: ${target.label}`} onClose={close}>
      <p className="muted small">Target curve for the +Y corner. Points are put in ascending x order when this window is closed.</p>
      <div className="tblwrap">
        <table className="ctable" data-testid="userline-table">
          <thead><tr><th>#</th><th>X</th><th>Y</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="no">{i + 1}</td>
                <td><NumberCell value={r[0]} digits={4} onCommit={(v) => set(i, 0, v)} /></td>
                <td><NumberCell value={r[1]} digits={4} onCommit={(v) => set(i, 1, v)} /></td>
                <td><button className="icon" aria-label={`Remove point ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">No points. Add some, or copy the data line to the user line.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row"><button onClick={add}>Add point</button><button onClick={() => setRows([])}>Clear all</button></div>
    </Dlg>
  );
}

/** Graphs / Manage User Lines: named sets kept in the browser's storage, with JSON export and import. */
export function ManageUserLinesDialog() {
  const open = useLab((s) => s.manageLines);
  if (!open) return null;
  return <ManageBody />;
}

function ManageBody() {
  const setManage = useLab((s) => s.setManageLines);
  const current = useLab((s) => s.userLines);
  const [sets, setSets] = useState<UserLineSet[]>(loadSets);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const commit = (next: UserLineSet[]) => { setSets(next); storeSets(next); };
  const save = () => {
    const label = name.trim();
    if (!label || !current.length) return;
    commit([...sets.filter((s) => s.label !== label), { label, lines: structuredClone(current) }]);
    setMsg(`Saved "${label}" (${current.length} lines).`);
  };
  const load = (s: UserLineSet) => { useLab.getState().setUserLines(structuredClone(s.lines)); setMsg(`Loaded "${s.label}".`); };
  const exportJson = async () => { await files().save('user-lines.json', exportSets(sets)); };
  const importJson = async () => {
    const f = await files().open('.json');
    if (!f) return;
    try {
      const incoming = importSets(f.text);
      commit([...sets.filter((s) => !incoming.some((i) => i.label === s.label)), ...incoming]);
      setMsg(`Imported ${incoming.length} set${incoming.length === 1 ? '' : 's'} from ${f.name}.`);
    } catch (e) {
      setMsg(`Could not read ${f.name}: ${(e as Error).message}`);
    }
  };
  return (
    <Dlg title="Manage user lines" onClose={() => setManage(false)}>
      <p className="muted small">User lines are not saved in the .dat file. Keep them here as named sets; the sets are stored in this browser.</p>
      <div className="row">
        <input className="gname" aria-label="Set name" placeholder="Set name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <button disabled={!name.trim() || !current.length} onClick={save} title={current.length ? '' : 'There are no user lines to save'}>Save current</button>
      </div>
      <div className="tblwrap">
        <table className="ctable" data-testid="userline-sets">
          <thead><tr><th>Set</th><th>Lines</th><th /></tr></thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td className="num">{s.lines.length}</td>
                <td className="rowbtns">
                  <button onClick={() => load(s)}>Load</button>
                  <button onClick={() => { commit(sets.filter((x) => x.label !== s.label)); setMsg(`Deleted "${s.label}".`); }}>Delete</button>
                </td>
              </tr>
            ))}
            {sets.length === 0 && <tr><td colSpan={3} className="muted">No saved sets.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button onClick={exportJson} disabled={!sets.length}>Export JSON…</button>
        <button onClick={importJson}>Import JSON…</button>
        <span className="muted small grow">{msg}</span>
      </div>
    </Dlg>
  );
}
