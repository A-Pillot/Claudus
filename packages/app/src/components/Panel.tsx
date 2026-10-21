import { useRef, useState } from 'react';

/**
 * A floating window that stays open beside the 3D view (the kinematic sum, optimiser and result charts are
 * used while the model is being changed, so they do not block the screen). Drag it by its title bar.
 */
export function Panel({ title, onClose, width = 520, x, y = 56, children, testId }: {
  title: string;
  onClose: () => void;
  width?: number;
  /** Left edge in px; default places it at the right-hand side of the window. */
  x?: number;
  y?: number;
  children: React.ReactNode;
  testId?: string;
}) {
  const [pos, setPos] = useState({ x: x ?? Math.max(8, window.innerWidth - width - 24), y });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  return (
    <div className="panel" style={{ left: pos.x, top: pos.y, width }} role="dialog" aria-label={title} data-testid={testId}>
      <div
        className="panelhead"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) setPos({ x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.dy)) });
        }}
        onPointerUp={() => { drag.current = null; }}
      >
        <b>{title}</b>
        <button className="icon" aria-label={`Close ${title}`} onClick={onClose}>✕</button>
      </div>
      <div className="panelbody">{children}</div>
    </div>
  );
}
