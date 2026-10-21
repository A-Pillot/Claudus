// Shared form pieces for the tool dialogs.
import { useRef, useState, type ReactNode } from 'react';

/** Number field that keeps its own text while typing and reports valid numbers. */
export function Num({ label, value, onChange, step, wide, title }: { label: string; value: number | undefined; onChange: (v: number) => void; step?: number; wide?: boolean; title?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className={wide ? 'ef wide' : 'ef'} title={title}>
      {label}
      <input
        type="number" step={step ?? 'any'}
        value={text ?? (value === undefined || !Number.isFinite(value) ? '' : String(Math.round(value * 1e6) / 1e6))}
        onChange={(e) => { setText(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

export function Sel<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="ef wide">
      {label}
      <select value={String(value)} onChange={(e) => { const o = options.find(([v]) => String(v) === e.target.value); if (o) onChange(o[0]); }}>
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </label>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="echeck"><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

/** Load a text file or paste its contents. Calls onText with the contents and file name. */
export function DataSource({ label, accept, text, onText, rows = 4 }: { label: string; accept: string; text: string; onText: (t: string, name?: string) => void; rows?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="erow">
        <button onClick={() => input.current?.click()}>Load file...</button>
        <input ref={input} type="file" accept={accept} hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) { setName(f.name); onText(await f.text(), f.name); }
          e.target.value = '';
        }} />
        <span className="edim">{name || 'or paste below'}</span>
      </div>
      <textarea rows={rows} spellCheck={false} value={text} onChange={(e) => onText(e.target.value)} placeholder="Paste file contents here" />
    </fieldset>
  );
}

export function Stats({ items }: { items: [string, ReactNode][] }) {
  return <div className="estat">{items.map(([k, v]) => <div key={k}><span>{k}</span><span>{v}</span></div>)}</div>;
}

export const f2 = (v: number | undefined, d = 2) => (v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d));
