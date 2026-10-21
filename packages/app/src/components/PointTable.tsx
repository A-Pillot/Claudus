import { useEffect, useRef, useState } from 'react';
import { dataPoints, fromDisplayUnit, getTemplate, GROUND, hasTemplate, toDisplayUnit, unitDecimalsFor } from '@claudus/core';
import { useApp } from '../store';
import { pickPoint } from '../graphicsActions';
import { unitText, useUnitSettings } from '../units';

/**
 * A number input that only commits on Enter or blur, so half-typed values never reach the solver. With `unit` (a
 * default-unit string such as 'mm' or 'N/mm') the value is shown and typed in the display units and committed back
 * in the default units.
 */
export function NumberCell({ value, onCommit, digits = 3, unit, placeholder }: { value: number; onCommit: (v: number) => void; digits?: number; unit?: string; placeholder?: string }) {
  useUnitSettings();
  const d = unit ? unitDecimalsFor(unit, digits) : digits;
  const shown = Number.isFinite(value) ? String(Number((unit ? toDisplayUnit(unit, value) : value).toFixed(d))) : '';
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(shown); }, [shown, editing]);
  // Escape blurs the box, which would commit the typed text: this tells the blur to throw it away.
  const cancelled = useRef(false);
  const commit = () => {
    setEditing(false);
    if (cancelled.current) { cancelled.current = false; setText(shown); return; }
    const typed = Number(text);
    const v = unit ? fromDisplayUnit(unit, typed) : typed;
    if (text.trim() !== '' && text !== shown && Number.isFinite(v) && v !== value) onCommit(v);
    else setText(shown);
  };
  return (
    <input
      className="numcell"
      placeholder={placeholder}
      value={text}
      inputMode="decimal"
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { cancelled.current = true; setText(shown); setEditing(false); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

export function PointTable() {
  const end = useApp((s) => s.end);
  const data = useApp((s) => s.model[s.end]);
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  const setPoint = useApp((s) => s.setPoint);
  const setRollingRadius = useApp((s) => s.setRollingRadius);
  useUnitSettings();
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  useEffect(() => {
    if (selected !== null) rowRefs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!data) return <p className="muted pad">No {end} suspension in this model.</p>;
  if (!hasTemplate(data.templateSlot)) return <p className="muted pad">Template type {data.templateSlot} is not available yet.</p>;
  const t = getTemplate(data.templateSlot);

  return (
    <div className="points">
      <div className="tplname">
        Type {t.slot}: {t.label} <span className="muted">({unitText('mm')})</span>
      </div>
      <table>
        <thead>
          <tr><th>No</th><th>Point</th><th>X</th><th>Y</th><th>Z</th></tr>
        </thead>
        <tbody>
          {dataPoints(t).map((tp, i) => (
            <tr
              key={tp.no}
              ref={(el) => { rowRefs.current[i] = el; }}
              className={selected === i ? 'sel' : ''}
              onClick={() => (useApp.getState().addMode ? pickPoint(tp.no) : select(i))}
            >
              <td className="no">{tp.no}</td>
              <td className="label" title={tp.label}>
                {tp.label}
                {(tp.part1 === GROUND || tp.part2 === GROUND) && <span className="tag">body</span>}
              </td>
              {[0, 1, 2].map((k) => (
                <td key={k}><NumberCell unit="mm" value={data.points[i][k]} onCommit={(v) => setPoint(i, k, v)} /></td>
              ))}
            </tr>
          ))}
          <tr>
            <td />
            <td className="label">Tyre rolling radius</td>
            <td><NumberCell unit="mm" value={data.rollingRadius} onCommit={setRollingRadius} /></td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
