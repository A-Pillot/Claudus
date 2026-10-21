import { useMemo, useState } from 'react';
import { sortLine, type LineKey, type UserLines, type XY } from '@claudus/core';
import { LinePlot, type PlotLine } from './LinePlot';
import { useTwoD } from './store2d';
import type { Solution2D } from './useSolution';

const DATA = '#4e9fe5';
const USER = '#f28e2b';
const LEFT = '#6fcf97';

interface GraphDef {
  title: string;
  unit: string;
  x: string;
  /** User line this graph shows, if any (track change has none). */
  line?: LineKey;
  data: (s: Solution2D) => PlotLine[];
}

const bumpGraphs: GraphDef[] = [
  { title: 'Camber angle', unit: 'deg', x: 'Bump travel (mm)', line: 'camberBump', data: (s) => [{ label: 'Camber', colour: DATA, points: s.results.bump.map((b) => [b.bump, b.camber]) }] },
  { title: 'Roll centre height', unit: 'mm', x: 'Bump travel (mm)', line: 'rcBump', data: (s) => [{ label: 'RC height', colour: DATA, points: s.results.bump.map((b) => [b.bump, b.rcHeight]) }] },
  { title: 'Half track change', unit: 'mm', x: 'Bump travel (mm)', data: (s) => [{ label: 'Track change', colour: DATA, points: s.results.bump.map((b) => [b.bump, b.halfTrackChange]) }] },
];

const rollGraphs: GraphDef[] = [
  {
    title: 'Camber angle', unit: 'deg', x: 'Roll angle (deg)', line: 'camberRoll',
    data: (s) => [
      { label: 'Camber, right', colour: DATA, points: s.results.roll.map((r) => [r.roll, r.camber]) },
      { label: 'Camber, left', colour: LEFT, dash: [2, 4], points: s.results.roll.map((r) => [r.roll, r.camberLeft]) },
    ],
  },
  { title: 'Roll centre height', unit: 'mm', x: 'Roll angle (deg)', line: 'rcRoll', data: (s) => [{ label: 'RC height', colour: DATA, points: s.results.roll.map((r) => [r.roll, r.rcHeight]) }] },
  { title: 'Roll centre lateral', unit: 'mm', x: 'Roll angle (deg)', line: 'rcLateralRoll', data: (s) => [{ label: 'RC lateral', colour: DATA, points: s.results.roll.map((r) => [r.roll, r.rcLateral]) }] },
];

const LINE_TITLES: Record<LineKey, string> = {
  camberBump: 'Camber against bump',
  rcBump: 'Roll centre height against bump',
  camberRoll: 'Camber against roll',
  rcRoll: 'Roll centre height against roll',
  rcLateralRoll: 'Roll centre lateral against roll',
};

/** Three graphs for the current articulation, with the user (target) lines over the data lines. */
export function TwoDGraphs({ sol }: { sol: Solution2D }) {
  const mode = useTwoD((s) => s.mode);
  const art = useTwoD((s) => s.art);
  const setUserLines = useTwoD((s) => s.setUserLines);
  const userLines = useTwoD((s) => s.userLines);
  const [editing, setEditing] = useState(false);
  const defs = mode === 'bump' ? bumpGraphs : rollGraphs;
  const x = mode === 'bump' ? art.bump : art.roll;

  const copyDataToUser = () =>
    setUserLines({
      camberBump: sol.results.bump.map((b) => [b.bump, b.camber]),
      rcBump: sol.results.bump.map((b) => [b.bump, b.rcHeight]),
      camberRoll: sol.results.roll.map((r) => [r.roll, r.camber]),
      rcRoll: sol.results.roll.map((r) => [r.roll, r.rcHeight]),
      rcLateralRoll: sol.results.roll.map((r) => [r.roll, r.rcLateral]),
    });

  return (
    <div className="twod-graphs">
      <div className="twod-graphbar">
        <span className="muted small">{userLines ? 'User lines edited' : 'User lines follow the general data'}</span>
        <button onClick={copyDataToUser} title="Graphs / Copy 2D Data to User">Copy data to user</button>
        <button onClick={() => setEditing(true)}>Edit user lines…</button>
        <button onClick={() => setUserLines(null)} disabled={!userLines}>Reset user lines</button>
      </div>
      <div className="graphs">
        {defs.map((d) => (
          <GraphCard key={d.title + mode} def={d} sol={sol} marker={x} />
        ))}
      </div>
      {editing && <UserLineEditor lines={sol.lines} onClose={() => setEditing(false)} onSave={(l) => { setUserLines(l); setEditing(false); }} />}
    </div>
  );
}

function GraphCard({ def, sol, marker }: { def: GraphDef; sol: Solution2D; marker: number }) {
  const lines = useMemo(() => {
    const out = def.data(sol);
    if (def.line) out.push({ label: 'User line', colour: USER, dash: [6, 4], points: sol.lines[def.line] });
    return out;
  }, [def, sol]);
  return (
    <div className="graphcard">
      <div className="graphhead"><b>{def.title}</b><span className="muted">({def.unit})</span></div>
      <LinePlot lines={lines} xLabel={def.x} yLabel={def.unit} marker={marker} />
    </div>
  );
}

/** Edit each user line as text, one "x y" pair per row. Rows are sorted by x when saved, as SHARK does. */
function UserLineEditor({ lines, onSave, onClose }: { lines: UserLines; onSave: (l: UserLines) => void; onClose: () => void }) {
  const keys = Object.keys(LINE_TITLES) as LineKey[];
  const [text, setText] = useState(() => Object.fromEntries(keys.map((k) => [k, lines[k].map((p) => `${+p[0].toFixed(4)} ${+p[1].toFixed(4)}`).join('\n')])) as Record<LineKey, string>);
  const parse = (t: string): XY[] =>
    sortLine(t.split('\n').map((r) => r.trim().split(/[\s,]+/).map(Number)).filter((r) => r.length >= 2 && r.every(Number.isFinite)).map((r) => [r[0], r[1]] as XY));
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h3>Edit user lines</h3>
        <p className="muted">One point per row: x then y. The lines are targets only and are not saved in the data file.</p>
        <div className="ulgrid">
          {keys.map((k) => (
            <label key={k}>{LINE_TITLES[k]}
              <textarea value={text[k]} rows={7} onChange={(e) => setText({ ...text, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(Object.fromEntries(keys.map((k) => [k, parse(text[k])])) as UserLines)}>OK</button>
        </div>
      </div>
    </div>
  );
}
