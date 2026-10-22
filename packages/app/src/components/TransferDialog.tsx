import { useMemo, useState } from 'react';
import {
  applyExport, applyImport, dataPoints, getTemplate, hasTemplate, labelsFor, planExport, planImport, type End, type FileFormat,
  type TransferPlan, type Vec3,
} from '@claudus/core';
import { useApp } from '../store';
import { files } from '../files';
import { useTransfer } from '../transfer';
import { NumberCell } from './PointTable';
import { fmtUnit, useUnitSettings } from '../units';

export type TransferMode = 'import' | 'export';

const STATUS: Record<string, string> = {
  found: 'found', maths: 'formula', derived: 'derived', undefined: 'not defined', missing: 'not in file', error: 'error',
};
const fmt = (v: Vec3 | undefined) => (v ? v.map((x) => String(Number(fmtUnit('mm', x, 2)))).join('  ') : '');
const AXES = ['X', 'Y', 'Z'];

/**
 * SHARK's import/export window: the file's text on one side, the matched points below it. Nothing changes
 * until Apply (import) or Save (export) is pressed.
 */
export function TransferDialog({ mode, format, onClose }: { mode: TransferMode; format: FileFormat; onClose: () => void }) {
  useUnitSettings();
  const model = useApp((s) => s.model);
  const currentEnd = useApp((s) => s.end);
  const { labels, settings, setLabel, resetLabels, setSettings } = useTransfer();
  const [end, setEnd] = useState<End>(currentEnd);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [bush, setBush] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const data = model[end];
  const tpl = data && hasTemplate(data.templateSlot) ? getTemplate(data.templateSlot) : undefined;
  const slot = data?.templateSlot ?? 0;
  const ls = tpl ? labelsFor(tpl, labels[slot]) : undefined;

  const switchOk = [0, 1, 2].every((a) => settings.switch.includes(a));
  const result = useMemo<{ plan?: TransferPlan; out?: string; error?: string }>(() => {
    if (!data || !tpl || !switchOk) return {};
    try {
      if (mode === 'import') return { plan: planImport(model, end, text, format, settings, labels[slot]) };
      const plan = planExport(model, end, text, format, settings, labels[slot]);
      return { plan, out: applyExport(model, plan, text, settings, labels[slot]) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [model, end, text, format, settings, labels, slot, mode, data, tpl, switchOk]);

  const openFile = async () => {
    const f = await files().open(format === 'adams' ? '.sub,.txt' : '.txt,.csv,.dat,.shk');
    if (f) {
      setName(f.name);
      setText(f.text);
      setMsg(null);
    }
  };
  const apply = async () => {
    if (!result.plan) return;
    if (mode === 'import') {
      const next = applyImport(model, result.plan);
      useApp.setState((s) => ({ model: next, dirty: true, revision: s.revision + 1 }));
      onClose();
    } else if (result.out !== undefined) {
      const saved = await files().save(name || (format === 'adams' ? 'export.sub' : 'export.txt'), result.out);
      if (saved) setMsg(`Saved ${saved}.`);
    }
  };

  const title = `${mode === 'import' ? 'Import' : 'Export'} hard points ${mode === 'import' ? 'from' : 'to'} ${format === 'adams' ? 'an Adams subsystem' : 'a User A format file'}`;
  const found = result.plan?.rows.filter((r) => r.status === 'found' || r.status === 'maths').length ?? 0;

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog wide transfer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        <div className="row">
          <button onClick={openFile}>Open file…</button>
          <span className="muted">{name || 'no file loaded'}</span>
          <span className="grow" />
          <label>End</label>
          <select value={end} onChange={(e) => setEnd(e.target.value as End)}>
            {(['front', 'rear'] as End[]).map((e) => <option key={e} value={e} disabled={!model[e]}>{e === 'front' ? 'Front' : 'Rear'}</option>)}
          </select>
          <label>Corner</label>
          <select value={settings.side} onChange={(e) => setSettings({ side: e.target.value as 'left' | 'right' })}>
            <option value="right">Right (+Y)</option>
            <option value="left">Left</option>
          </select>
        </div>

        <div className="row xform">
          <label>Shift</label>
          {[0, 1, 2].map((k) => <NumberCell key={k} unit="mm" value={settings.shift[k]} onCommit={(v) => setSettings({ shift: settings.shift.map((x, j) => (j === k ? v : x)) as Vec3 })} />)}
          <label>Scale</label>
          {[0, 1, 2].map((k) => <NumberCell key={k} value={settings.scale[k]} onCommit={(v) => v !== 0 && setSettings({ scale: settings.scale.map((x, j) => (j === k ? v : x)) as Vec3 })} />)}
          <label>Switch</label>
          {[0, 1, 2].map((k) => (
            <select key={k} value={settings.switch[k]} onChange={(e) => setSettings({ switch: settings.switch.map((x, j) => (j === k ? Number(e.target.value) : x)) as [number, number, number] })}>
              {AXES.map((a, i) => <option key={a} value={i}>{AXES[k]} = {a}</option>)}
            </select>
          ))}
        </div>
        <div className="muted small">
          {mode === 'import' ? 'Import applies shift, then scale, then switch.' : 'Export reverses the order: switch, scale, then shift is subtracted.'}
          {!switchOk && <span className="error"> The switch must use X, Y and Z once each.</span>}
        </div>

        <div className={`split ${mode === 'export' ? 'two' : ''}`}>
          <div>
            <div className="muted small">{mode === 'import' ? 'File text' : 'File text (before)'}</div>
            <textarea className="filetext" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder="Open a file or paste its text here." />
          </div>
          {mode === 'export' && (
            <div>
              <div className="muted small">After export</div>
              <textarea className="filetext" spellCheck={false} readOnly value={result.out ?? ''} />
            </div>
          )}
        </div>

        <div className="row">
          <b>Matched points</b>
          <span className="muted small">{result.plan ? `${found} matched, ${result.plan.changed} would change` : ''}</span>
          <span className="grow" />
          <label><input type="checkbox" checked={bush} onChange={(e) => setBush(e.target.checked)} /> Bush axis strings</label>
          <button onClick={() => resetLabels(slot)} title="Back to the default label strings">Reset strings</button>
        </div>
        <div className="tplbody">
          <table className="grid" aria-label="Matched points">
            <thead>
              <tr>
                <th>No</th><th>Point</th><th>Label string</th>
                {bush && <><th>Bush Z-axis string</th><th>Bush X-Z plane string</th></>}
                <th>Status</th><th>{mode === 'import' ? 'Model now' : 'In file now'}</th><th>{mode === 'import' ? 'After import' : 'After export'}</th>
              </tr>
            </thead>
            <tbody>
              {result.plan?.rows.map((r) => (
                <tr key={r.index} className={`st-${r.status}`}>
                  <td>{r.no}</td>
                  <td className="lbl" title={r.name}>{r.name}</td>
                  <td><input value={ls?.point[r.index] ?? ''} onChange={(e) => setLabel(slot, 'point', r.index, e.target.value)} /></td>
                  {bush && <>
                    <td><input value={ls?.bushZ[r.index] ?? ''} onChange={(e) => setLabel(slot, 'bushZ', r.index, e.target.value)} /></td>
                    <td><input value={ls?.bushXZ[r.index] ?? ''} onChange={(e) => setLabel(slot, 'bushXZ', r.index, e.target.value)} /></td>
                  </>}
                  <td className={`status ${r.status}`} title={r.message}>{STATUS[r.status]}</td>
                  <td className="num">{fmt(r.current)}</td>
                  <td className={`num ${r.changes ? 'changed' : ''}`}>{fmt(r.next)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bush && <div className="muted small">Bush axis strings are kept with the template for when compliance data is imported; they are not applied yet.</div>}
        <div className="actions">
          <span className="muted">{result.error ?? msg ?? (!data ? 'This end has no suspension.' : '')}</span>
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={apply} disabled={!result.plan || !text || found === 0}>
            {mode === 'import' ? `Apply import (${result.plan?.changed ?? 0} points)` : 'Save exported file…'}
          </button>
        </div>
      </div>
    </div>
  );
}
