// Spreadsheet-style test point editor with a speed sweep wizard.
import { useState } from 'react';
import { NumField, Row } from './fields';
import { useEngine } from './store';
import { defaultTestPoint, speedSweep } from './testpoints';

const COLS: { key: 'speed' | 'afr' | 'burnStart' | 'burnDuration' | 'ambientPressure' | 'ambientTemperature' | 'maxCycles'; label: string; step?: number }[] = [
  { key: 'speed', label: 'Speed (rpm)' }, { key: 'afr', label: 'AFR', step: 0.1 }, { key: 'burnStart', label: 'Burn start (deg ATDC)' },
  { key: 'burnDuration', label: 'Burn duration (deg)' }, { key: 'ambientPressure', label: 'Ambient p (bar)', step: 0.001 },
  { key: 'ambientTemperature', label: 'Ambient T (K)' }, { key: 'maxCycles', label: 'Max cycles' },
];

export function TestTable() {
  const model = useEngine((s) => s.model);
  const edit = useEngine((s) => s.edit);
  const selected = useEngine((s) => s.selectedTests);
  const setSelected = useEngine((s) => s.setSelectedTests);
  const [wizard, setWizard] = useState(false);
  if (!model) return null;
  const set = (i: number, f: string, v: number | string) => edit((m) => { (m.tests[i] as unknown as Record<string, unknown>)[f] = v; }, { key: `test.${i}.${f}` });
  const toggle = (i: number, multi: boolean) => setSelected(multi ? (selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i]) : [i]);
  return (
    <div className="tests">
      <div className="tests-bar">
        <button onClick={() => edit((m) => { const last = m.tests[m.tests.length - 1]; m.tests.push(last ? { ...last, throttle: last.throttle ? { ...last.throttle } : undefined } : defaultTestPoint()); })}>Add row</button>
        <button disabled={!selected.length} onClick={() => { edit((m) => { m.tests = m.tests.filter((_, i) => !selected.includes(i)); }); setSelected([]); }}>Delete rows</button>
        <button onClick={() => setWizard(true)}>Test wizard…</button>
        <span className="muted small">{model.tests.length} test point(s); click row numbers to select (Ctrl for several)</span>
      </div>
      <div className="tests-scroll">
        <table className="etable sheet">
          <thead>
            <tr><th>#</th><th>Label</th>{COLS.map((c) => <th key={c.key}>{c.label}</th>)}{model.throttles.map((t) => <th key={t.id}>{t.label}</th>)}</tr>
          </thead>
          <tbody>
            {model.tests.map((t, i) => (
              <tr key={i} className={selected.includes(i) ? 'sel' : ''}>
                <td className="rownum" onClick={(e) => toggle(i, e.ctrlKey || e.metaKey)}>{i + 1}</td>
                <td><input className="txt" value={t.label} onChange={(e) => set(i, 'label', e.target.value)} /></td>
                {COLS.map((c) => <td key={c.key}><NumField value={t[c.key]} step={c.step} onChange={(v) => set(i, c.key, v)} width={96} /></td>)}
                {model.throttles.map((th) => (
                  <td key={th.id}>
                    <NumField value={t.throttle?.[th.id] ?? th.position} onChange={(v) => edit((m) => { const tp = m.tests[i]; tp.throttle = { ...(tp.throttle ?? {}), [th.id]: v }; }, { key: `test.${i}.th${th.id}` })} width={64} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {wizard && <Wizard onClose={() => setWizard(false)} />}
    </div>
  );
}

function Wizard({ onClose }: { onClose: () => void }) {
  const model = useEngine((s) => s.model)!;
  const edit = useEngine((s) => s.edit);
  const base = model.tests[0] ?? defaultTestPoint();
  const [from, setFrom] = useState(1000);
  const [to, setTo] = useState(7000);
  const [step, setStep] = useState(500);
  const [replace, setReplace] = useState(true);
  const pts = speedSweep(base, from, to, step);
  return (
    <div className="edialog-bg" onMouseDown={onClose}>
      <div className="edialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Test wizard: speed sweep</h3>
        <Row label="Start speed" unit="rpm"><NumField value={from} onChange={setFrom} /></Row>
        <Row label="End speed" unit="rpm"><NumField value={to} onChange={setTo} /></Row>
        <Row label="Step" unit="rpm"><NumField value={step} onChange={setStep} /></Row>
        <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace existing test points</label>
        <p className="muted small">Other settings (AFR, burn, ambient, throttles) are copied from the first test point. {pts.length} point(s) will be created.</p>
        <div className="dlg-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!pts.length} onClick={() => { edit((m) => { m.tests = replace ? pts : [...m.tests, ...pts]; }); onClose(); }}>Create</button>
        </div>
      </div>
    </div>
  );
}
