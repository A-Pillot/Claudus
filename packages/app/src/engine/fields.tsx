// Small form controls shared by the data editors.
import { useEffect, useState } from 'react';

export function NumField({ value, onChange, step, min, max, width }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText((t) => (Number(t) === value ? t : String(value))); }, [value]);
  return (
    <input
      className="num"
      type="number"
      value={text}
      step={step ?? 'any'}
      min={min}
      max={max}
      style={width ? { width } : undefined}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

export function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="txt" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function Row({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  return (
    <label className="frow">
      <span className="flabel">{label}</span>
      {children}
      <span className="funit">{unit ?? ''}</span>
    </label>
  );
}
