// Drop-down menu used by the Engine menu bar.
import { useEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; onClick: () => void; disabled?: boolean; hint?: string } | 'sep';

export function Menu({ title, items }: { title: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="emenu" ref={ref}>
      <button className={open ? 'on' : ''} onClick={() => setOpen(!open)}>{title}</button>
      {open && (
        <div className="emenu-list" role="menu">
          {items.map((it, i) =>
            it === 'sep' ? <hr key={i} /> : (
              <button key={i} role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>
                <span>{it.label}</span>{it.hint && <span className="hint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
