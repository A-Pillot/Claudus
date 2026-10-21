// SVG network canvas: draws the layout, supports select, drag, pan/zoom, palette drops and connecting.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementKind, ElementRef, EngineModel } from '@claudus/engine';
import { addConnection, addElement, allItems, itemMap, keyOf, parseKey, refKey, type Key } from './elements';
import { anchor, autoLayout, ensureLayout, HALF, isViaOnly, route, S, type Pt } from './layout';
import { useEngine } from './store';
import { errorKeys, warnKeys, type Issue } from './check';

export type Tool = 'select' | 'connect';
interface View { x: number; y: number; k: number }

const SHORT: Partial<Record<ElementKind, string>> = { compressor: 'C', turbine: 'T', cooler: 'HX' };

export function Canvas({ issues, tool, paletteKind, onPlaced }: { issues: Issue[]; tool: Tool; paletteKind: ElementKind | null; onPlaced: () => void }) {
  const model = useEngine((s) => s.model)!;
  const selection = useEngine((s) => s.selection);
  const { setSelection, edit, checkpoint } = useEngine.getState();
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<null | { mode: 'move' | 'pan' | 'box' | 'connect'; start: Pt; last: Pt; from?: ElementRef; moved: boolean }>(null);
  const [cursor, setCursor] = useState<Pt>({ x: 0, y: 0 });

  const grid = useMemo(() => ensureLayout(model), [model]);
  const layout = useMemo(() => {
    const o: Record<Key, Pt> = {};
    for (const [k, p] of Object.entries(grid)) o[k] = { x: p.x * S, y: p.y * S };
    return o;
  }, [grid]);
  const loadCount = useEngine((s) => s.loadCount);
  const items = useMemo(() => allItems(model), [model]);
  const map = useMemo(() => itemMap(model), [model]);
  const bad = useMemo(() => errorKeys(issues), [issues]);
  const warn = useMemo(() => warnKeys(issues), [issues]);
  const sel = new Set(selection);
  const nodes = items.filter((i) => !isViaOnly(model, i.kind, i.id));

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  const hit = (p: Pt): Key | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const c = layout[n.key];
      const h = HALF[n.kind];
      if (c && Math.abs(p.x - c.x) <= h.w + 3 && Math.abs(p.y - c.y) <= h.h + 3) return n.key;
    }
    return null;
  };

  const refFor = (key: Key, p: Pt): ElementRef => {
    const { kind, id } = parseKey(key);
    return kind === 'pipe' ? { kind, id, end: p.x < layout[key].x ? 1 : 2 } : { kind, id };
  };

  const onDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      setDrag({ mode: 'pan', start: { x: e.clientX, y: e.clientY }, last: { x: view.x, y: view.y }, moved: false });
      return;
    }
    const p = toWorld(e);
    if (paletteKind) {
      const pos = { x: Math.round((p.x / S) * 2) / 2, y: Math.round((p.y / S) * 2) / 2 };
      let key = '';
      edit((m) => {
        m.layout = ensureLayout(m);
        key = addElement(m, paletteKind, pos);
      });
      setSelection([key]);
      onPlaced();
      return;
    }
    const k = hit(p);
    if (tool === 'connect' || e.shiftKey) {
      if (k) setDrag({ mode: 'connect', start: p, last: p, from: refFor(k, p), moved: false });
      return;
    }
    if (k) {
      if (e.ctrlKey || e.metaKey) setSelection(sel.has(k) ? selection.filter((x) => x !== k) : [...selection, k]);
      else if (!sel.has(k)) setSelection([k]);
      setDrag({ mode: 'move', start: p, last: p, moved: false });
    } else {
      if (!(e.ctrlKey || e.metaKey)) setSelection([]);
      setDrag({ mode: 'box', start: p, last: p, moved: false });
    }
  };

  const onMove = (e: React.MouseEvent) => {
    const p = toWorld(e);
    setCursor(p);
    if (!drag) return;
    if (drag.mode === 'pan') {
      setView({ ...view, x: drag.last.x + e.clientX - drag.start.x, y: drag.last.y + e.clientY - drag.start.y });
      return;
    }
    if (drag.mode === 'move') {
      const dx = p.x - drag.last.x;
      const dy = p.y - drag.last.y;
      if (!drag.moved) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 3) return;
        checkpoint();
        // Make sure positions exist before the first move.
        edit((m) => { m.layout = ensureLayout(m); }, { noHistory: true });
      }
      edit((m) => {
        for (const k of useEngine.getState().selection) {
          const c = m.layout[k];
          if (c) { c.x += dx / S; c.y += dy / S; }
        }
      }, { noHistory: true });
      setDrag({ ...drag, last: p, moved: true });
      return;
    }
    setDrag({ ...drag, last: p, moved: true });
  };

  const onUp = (e: React.MouseEvent) => {
    if (!drag) return;
    const p = toWorld(e);
    if (drag.mode === 'box' && drag.moved) {
      const x0 = Math.min(drag.start.x, p.x), x1 = Math.max(drag.start.x, p.x);
      const y0 = Math.min(drag.start.y, p.y), y1 = Math.max(drag.start.y, p.y);
      const inside = nodes.filter((n) => { const c = layout[n.key]; return c && c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1; }).map((n) => n.key);
      setSelection(e.ctrlKey || e.metaKey ? [...new Set([...selection, ...inside])] : inside);
    }
    if (drag.mode === 'connect' && drag.from) {
      const k = hit(p);
      if (k && k !== refKey(drag.from)) connect(model, drag.from, refFor(k, p), grid);
    }
    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const k = Math.min(4, Math.max(0.2, view.k * f));
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k });
  };

  const fitRef = useRef<() => void>(() => {});
  const fit = () => {
    const pts = Object.values(layout);
    if (!pts.length || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const x0 = Math.min(...pts.map((p) => p.x)) - 80, x1 = Math.max(...pts.map((p) => p.x)) + 80;
    const y0 = Math.min(...pts.map((p) => p.y)) - 110, y1 = Math.max(...pts.map((p) => p.y)) + 70;
    const k = Math.min(1.5, r.width / (x1 - x0), r.height / (y1 - y0));
    setView({ k, x: -x0 * k + (r.width - (x1 - x0) * k) / 2, y: -y0 * k + (r.height - (y1 - y0) * k) / 2 });
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(id);
  }, [loadCount]);

  const pos = (r: ElementRef): Pt | undefined => layout[refKey(r)];

  fitRef.current = fit;
  return (
    <div className="ecanvas">
      <div className="ecanvas-tools">
        <button onClick={fit} title="Fit network to window">Fit</button>
        <button onClick={() => setView({ ...view, k: Math.min(4, view.k * 1.25) })}>+</button>
        <button onClick={() => setView({ ...view, k: Math.max(0.2, view.k / 1.25) })}>−</button>
        <button onClick={() => { checkpoint(); edit((m) => { m.layout = autoLayout(m, true); }, { noHistory: true }); }} title="Re-run the automatic layout">Auto layout</button>
      </div>
      <svg ref={svg} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => setDrag(null)} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
        className={paletteKind ? 'placing' : tool === 'connect' ? 'connecting' : ''} data-testid="engine-canvas">
        <defs>
          <pattern id="egrid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="var(--line)" /></pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#egrid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {model.connections.map((c, i) => {
            const pa = pos(c.a), pb = pos(c.b);
            if (!pa || !pb) return null;
            const a = anchor(c.a.kind, c.a.end, pa, pb);
            const b = anchor(c.b.kind, c.b.end, pb, pa);
            const pts = route(a, b);
            const mid = pts.length === 2 ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: pts[1].x, y: (pts[1].y + pts[2].y) / 2 };
            return (
              <g key={i} className="econn">
                <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
                {c.via.map((v, j) => {
                  const vk = refKey(v);
                  const x = mid.x + (j - (c.via.length - 1) / 2) * 20;
                  const sx = sel.has(vk);
                  return (
                    <g key={j} className={`evia ${v.kind}${sx ? ' sel' : ''}`} transform={`translate(${x} ${mid.y})`}
                      onMouseDown={(e) => { e.stopPropagation(); setSelection(e.ctrlKey ? [...selection, vk] : [vk]); }}>
                      <title>{map.get(vk)?.label ?? vk}</title>
                      {v.kind === 'throttle' ? <><circle r="8" /><line x1="-6" y1="6" x2="6" y2="-6" /></> : v.kind === 'valve' ? <path d="M-7,-7 L7,7 M7,-7 L-7,7" /> : <rect x="-5" y="-5" width="10" height="10" />}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {nodes.map((n) => {
            const c = layout[n.key];
            if (!c) return null;
            const cls = `enode ${n.kind}${sel.has(n.key) ? ' sel' : ''}${bad.has(n.key) ? ' bad' : warn.has(n.key) ? ' warn' : ''}`;
            return <g key={n.key} className={cls} transform={`translate(${c.x} ${c.y})`}><Shape model={model} kind={n.kind} id={n.id} /><text y={HALF[n.kind].h + 13} textAnchor="middle">{n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label}</text></g>;
          })}
          {/* Free pipe ends that have no connection are marked. */}
          {model.pipes.map((p) => [1, 2].map((end) => {
            const used = model.connections.some((c) => [c.a, c.b].some((r) => r.kind === 'pipe' && r.id === p.id && r.end === end));
            const c = layout[keyOf('pipe', p.id)];
            if (used || !c) return null;
            return <circle key={`${p.id}-${end}`} className="eopen" cx={c.x + (end === 2 ? HALF.pipe.w : -HALF.pipe.w)} cy={c.y} r="5" />;
          }))}
          {drag?.mode === 'connect' && drag.from && pos(drag.from) && (
            <line className="erubber" x1={anchor(drag.from.kind, drag.from.end, pos(drag.from)!, cursor).x} y1={anchor(drag.from.kind, drag.from.end, pos(drag.from)!, cursor).y} x2={cursor.x} y2={cursor.y} />
          )}
          {drag?.mode === 'box' && drag.moved && (
            <rect className="ebox" x={Math.min(drag.start.x, cursor.x)} y={Math.min(drag.start.y, cursor.y)} width={Math.abs(cursor.x - drag.start.x)} height={Math.abs(cursor.y - drag.start.y)} />
          )}
        </g>
      </svg>
      <div className="ecanvas-hint">
        {paletteKind ? `Click to place a ${paletteKind}` : tool === 'connect' ? 'Drag from one element to another to connect them' : 'Drag to move. Shift+drag to connect. Wheel zooms, middle/right/Alt drag pans.'}
      </div>
    </div>
  );
}

/** Create a connection between two refs; cylinder links get a valve and port. */
function connect(_model: EngineModel, a: ElementRef, b: ElementRef, layout: Record<Key, Pt>) {
  const st = useEngine.getState();
  const cylA = a.kind === 'cylinder', cylB = b.kind === 'cylinder';
  st.edit((m) => {
    m.layout = layout;
    if (cylA !== cylB) {
      const cyl = cylA ? a : b;
      const other = cylA ? b : a;
      const ox = layout[refKey(other)]?.x ?? 0;
      const cx = layout[refKey(cyl)]?.x ?? 0;
      const kind = ox < cx ? 'intake' : 'exhaust';
      const vk = addElement(m, 'valve', undefined, { valveKind: kind });
      const pk = addElement(m, 'port', undefined, { valveKind: kind });
      delete m.layout[vk]; delete m.layout[pk];
      addConnection(m, cyl, other, [{ kind: 'valve', id: parseKey(vk).id }, { kind: 'port', id: parseKey(pk).id }]);
    } else addConnection(m, a, b);
  });
}
// Re-exported for tests of the connect logic via the store.
export { connect as connectElements };

function Shape({ model, kind, id }: { model: EngineModel; kind: ElementKind; id: number }) {
  void model; void id;
  switch (kind) {
    case 'cylinder': return <><rect x="-30" y="-38" width="60" height="76" rx="4" /><line x1="-30" y1="-8" x2="30" y2="-8" /><text className="in" y="22" textAnchor="middle">{id}</text></>;
    case 'pipe': return <><rect x="-42" y="-8" width="84" height="16" rx="8" /></>;
    case 'plenum': return <ellipse rx="30" ry="24" />;
    case 'inlet': return <><circle r="20" /><path d="M-8,-8 L8,0 L-8,8 Z" /></>;
    case 'exit': return <><circle r="20" /><path d="M-8,-8 L8,0 L-8,8 Z" /></>;
    case 'throttle': return <><rect x="-8" y="-16" width="16" height="32" /><line x1="-8" y1="12" x2="8" y2="-12" /></>;
    case 'valve': return <path d="M-8,-8 L8,8 M8,-8 L-8,8" />;
    case 'port': return <rect x="-8" y="-8" width="16" height="16" />;
    case 'junction': return <circle r="7" />;
    default: return <><rect x="-24" y="-24" width="48" height="48" rx="8" /><text className="in" textAnchor="middle" y="5">{SHORT[kind] ?? kind[0].toUpperCase()}</text></>;
  }
}
