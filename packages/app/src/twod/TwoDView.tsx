import { useEffect, useMemo, useRef, useState } from 'react';
import type { Corner2D, Model2D, P2 } from '@claudus/core';
import { useTwoD, type Point2DId } from './store2d';
import type { Solution2D } from './useSolution';

/** Nominal tyre drawn for reference: the 2D data has no tyre size. */
const TYRE_W = 200;
const TYRE_H = 500;
const FAR = 20000;

/** SVG y runs down, so heights are negated. */
const q = (p: P2): P2 => [p[0], -p[1]];
const mirror = (p: P2): P2 => [-p[0], p[1]];

interface Rect { x: number; y: number; w: number; h: number }

/** The view the 2D module opens with: the right-hand corner and the centre line, or the whole axle. */
function fitRect(m: Model2D, both: boolean): Rect {
  const half = m.track / 2;
  const x0 = both ? -(half + 260) : -140;
  const x1 = half + 260;
  const top = Math.max(m.upperOuterZ, m.type === 1 ? m.upperInner[1] : 0, 560) + 120;
  return { x: x0, y: -top, w: x1 - x0, h: top + 100 };
}

/** Where a point drag sends the data. The file holds heights and angles, so outer points set Z and the kingpin angle. */
function dragEdit(id: Point2DId, y: number, z: number, m: Model2D): Partial<Model2D> | null {
  const r = (v: number) => Math.round(v * 10) / 10;
  const groundY = m.track / 2 - m.kingpinOffset;
  switch (id) {
    case 'lowerInner': return { lowerInner: [r(y), r(z)] };
    case 'upperInner': return { upperInner: [r(y), r(z)] };
    case 'lowerOuter':
    case 'upperOuter': {
      if (z < 20) return null;
      const angle = (Math.atan((groundY - y) / z) * 180) / Math.PI;
      return { kingpinAngle: Math.round(angle * 100) / 100, ...(id === 'lowerOuter' ? { lowerOuterZ: r(z) } : { upperOuterZ: r(z) }) };
    }
    case 'ground': return { kingpinOffset: r(m.track / 2 - y) };
    case 'contact': return y > 100 ? { track: r(2 * y) } : null;
  }
}

export function TwoDView({ sol }: { sol: Solution2D }) {
  const model = useTwoD((s) => s.model);
  const mode = useTwoD((s) => s.mode);
  const freeMode = useTwoD((s) => s.freeMode);
  const selected = useTwoD((s) => s.selected);
  const select = useTwoD((s) => s.select);
  const edit = useTwoD((s) => s.edit);
  const [both, setBoth] = useState(false);
  const [rect, setRect] = useState<Rect>(() => fitRect(model, false));
  const [px, setPx] = useState({ w: 800, h: 500 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'pan' | 'point'; id?: Point2DId; x: number; y: number; rect: Rect } | null>(null);

  // Refit when the toggle changes or a different file is opened.
  const fileName = useTwoD((s) => s.fileName);
  useEffect(() => setRect(fitRect(model, both)), [both, model.type, fileName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = svg.current!;
    const ro = new ResizeObserver(() => setPx({ w: el.clientWidth || 800, h: el.clientHeight || 500 }));
    ro.observe(el);
    // Wheel zoom needs a non-passive listener so the page does not scroll.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY);
      const f = Math.exp(e.deltaY * 0.0015);
      setRect((r) => ({ x: p[0] - (p[0] - r.x) * f, y: p[1] - (p[1] - r.y) * f, w: r.w * f, h: r.h * f }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel); };
  }, []);

  /** Screen position to SVG coordinates (y down). */
  function toWorld(cx: number, cy: number): P2 {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const m = el.getScreenCTM()!.inverse();
    const o = pt.matrixTransform(m);
    return [o.x, o.y];
  }

  // Size of one screen pixel in drawing units, so marks stay the same size when zooming.
  const k = Math.max(rect.w / px.w, rect.h / px.h);

  const geo = sol.geo;
  const staticCorner = sol.rest.corner;
  const right: Corner2D = mode === 'bump' ? sol.bump.corner : sol.roll.right;
  const leftRaw: Corner2D = mode === 'bump' ? sol.bump.corner : sol.roll.left;
  const left = mode === 'bump' ? mirrorCorner(leftRaw) : leftRaw;
  const groundZ = mode === 'bump' ? sol.bump.bump : 0;
  const half = model.track / 2;

  const onDown = (e: React.PointerEvent, id?: Point2DId) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    drag.current = id ? { kind: 'point', id, x: w[0], y: w[1], rect } : { kind: 'pan', x: e.clientX, y: e.clientY, rect };
    if (id) { select(id); e.stopPropagation(); } else select(null);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const scale = Math.min(px.w / d.rect.w, px.h / d.rect.h);
      setRect({ ...d.rect, x: d.rect.x - (e.clientX - d.x) / scale, y: d.rect.y - (e.clientY - d.y) / scale });
    } else {
      const [wy, wz] = toWorld(e.clientX, e.clientY);
      const fields = dragEdit(d.id!, wy, -wz, model);
      if (fields) edit(fields);
    }
  };
  const onUp = () => { drag.current = null; };

  // Handles sit on the static positions of the stored model, so they stay put while the sliders move.
  const handles: { id: Point2DId; at: P2; free: boolean }[] = useMemo(() => {
    const g = staticCorner;
    const list: { id: Point2DId; at: P2 }[] = [
      { id: 'lowerInner', at: g.lowerInner },
      ...(model.type === 1 ? [{ id: 'upperInner' as const, at: g.upperInner }] : []),
      { id: 'lowerOuter', at: g.lowerOuter },
      { id: 'upperOuter', at: g.upperOuter },
      { id: 'ground', at: g.ground },
      { id: 'contact', at: g.contact },
    ];
    return list.map((h) => ({ ...h, free: h.id === freeMode }));
  }, [staticCorner, model.type, freeMode]);

  return (
    <div className="twod-view">
      <svg
        ref={svg}
        viewBox={`${rect.x} ${rect.y} ${rect.w} ${rect.h}`}
        onPointerDown={(e) => onDown(e)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        data-testid="twod-svg"
      >
        {/* ground, centre line */}
        <line x1={rect.x - FAR} x2={rect.x + rect.w + FAR} y1={-groundZ} y2={-groundZ} className="g-ground" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={0} y1={-3000} y2={400} className="g-centre" vectorEffect="non-scaling-stroke" />
        {/* static pose, faint */}
        <Corner c={staticCorner} geo={geo} k={k} ghost />
        {both && <Corner c={mirrorCorner(staticCorner)} geo={geo} k={k} ghost />}
        {/* construction lines, then the current pose */}
        <Construction right={right} left={left} bump={mode === 'bump'} sol={sol} k={k} showLeft={both || mode === 'roll'} />
        <Corner c={right} geo={geo} k={k} />
        {(both || mode === 'roll') && <Corner c={left} geo={geo} k={k} />}
        {/* static roll centre */}
        <Marker at={[0, sol.results.rcStatic]} kind="diamond" k={k} className="g-rc-static" />
        {/* drag handles */}
        {handles.map((h) => (
          <g key={h.id} transform={`translate(${h.at[0]} ${-h.at[1]})`}>
            <circle
              r={9 * k}
              className={`g-handle${selected === h.id ? ' sel' : ''}${h.free ? ' free' : ''}`}
              onPointerDown={h.free ? undefined : (e) => onDown(e, h.id)}
              style={{ cursor: h.free ? 'default' : 'grab' }}
              data-point={h.id}
            />
            <text x={(h.id === 'ground' ? -12 : 12) * k} y={(h.id === 'ground' || h.id === 'contact' ? 22 : -10) * k} fontSize={11 * k} textAnchor={h.id === 'ground' ? 'end' : 'start'} className="g-label">{LABELS[h.id]}</text>
          </g>
        ))}
      </svg>
      <div className="twod-tools">
        <button onClick={() => setRect(fitRect(model, both))} title="Fit the view">Fit</button>
        <button className={both ? 'on' : ''} onClick={() => setBoth(!both)} title="Show both sides of the axle">Both sides</button>
      </div>
      <div className="overlay">2D cross-car view{mode === 'bump' ? `, bump ${sol.bump.bump.toFixed(1)} mm` : `, roll ${sol.roll.roll.toFixed(2)}°`}</div>
      {(!sol.bump.ok || !sol.roll.ok) && <div className="overlay warn">The suspension cannot reach this position.</div>}
      <div className="twod-help muted">Drag a point to edit. Scroll to zoom, drag the background to pan. Track half-width {half.toFixed(0)} mm.</div>
    </div>
  );
}

const LABELS: Record<Point2DId, string> = {
  lowerInner: 'Lower inner',
  upperInner: 'Upper inner',
  lowerOuter: 'Lower outer',
  upperOuter: 'Upper outer',
  ground: 'KP ground',
  contact: 'Contact',
};

function mirrorCorner(c: Corner2D): Corner2D {
  return {
    ...c,
    lowerInner: mirror(c.lowerInner),
    upperInner: mirror(c.upperInner),
    lowerOuter: mirror(c.lowerOuter),
    upperOuter: mirror(c.upperOuter),
    contact: mirror(c.contact),
    ground: mirror(c.ground),
    ic: c.ic && mirror(c.ic),
    icDir: mirror(c.icDir),
  };
}

function Line({ a, b, className }: { a: P2; b: P2; className: string }) {
  const [x1, y1] = q(a);
  const [x2, y2] = q(b);
  return <line x1={x1} y1={y1} x2={x2} y2={y2} className={className} vectorEffect="non-scaling-stroke" />;
}

function Dot({ at, k, className, r = 4.5 }: { at: P2; k: number; className: string; r?: number }) {
  const [x, y] = q(at);
  return <circle cx={x} cy={y} r={r * k} className={className} />;
}

function Marker({ at, kind, k, className }: { at: P2; kind: 'diamond' | 'cross'; k: number; className: string }) {
  if (!Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
  const [x, y] = q(at);
  const s = 7 * k;
  const d = kind === 'diamond' ? `M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z` : `M${x - s} ${y - s}L${x + s} ${y + s}M${x - s} ${y + s}L${x + s} ${y - s}`;
  return <path d={d} className={className} vectorEffect="non-scaling-stroke" />;
}

/** One corner: links, upright, tyre and points. */
function Corner({ c, geo, k, ghost }: { c: Corner2D; geo: Solution2D['geo']; k: number; ghost?: boolean }) {
  const cls = ghost ? 'ghost' : 'live';
  // Tyre: a rectangle standing on the contact point and tilted by the camber (positive = top leans outboard).
  const out = c.contact[0] >= 0 ? 1 : -1;
  const ca = (c.camber * Math.PI) / 180;
  const up: P2 = [out * Math.sin(ca), Math.cos(ca)];
  const across: P2 = [Math.cos(ca), -out * Math.sin(ca)];
  const corner = (dx: number, dz: number): P2 => [c.contact[0] + dx * across[0] + dz * up[0], c.contact[1] + dx * across[1] + dz * up[1]];
  const tyre = [corner(-TYRE_W / 2, 0), corner(TYRE_W / 2, 0), corner(TYRE_W / 2, TYRE_H), corner(-TYRE_W / 2, TYRE_H)];
  const poly = tyre.map((p) => q(p).join(',')).join(' ');
  return (
    <g className={cls}>
      <polygon points={poly} className="g-tyre" vectorEffect="non-scaling-stroke" />
      <Line a={c.lowerOuter} b={c.upperOuter} className="g-upright" />
      <Line a={c.lowerOuter} b={c.contact} className="g-upright" />
      <Line a={c.lowerInner} b={c.lowerOuter} className="g-arm" />
      {geo.strut ? <StrutLine c={c} geo={geo} /> : <Line a={c.upperInner} b={c.upperOuter} className="g-arm" />}
      <Dot at={c.lowerInner} k={k} className="g-pt" />
      {!geo.strut && <Dot at={c.upperInner} k={k} className="g-pt" />}
      <Dot at={c.lowerOuter} k={k} className="g-pt" />
      <Dot at={c.upperOuter} k={k} className="g-pt" />
      <Dot at={c.contact} k={k} className="g-pt" />
      <Dot at={c.ground} k={k} className="g-pt small" r={3} />
    </g>
  );
}

/** The strut: the slider axis through the strut top, drawn down toward the lower ball joint. */
function StrutLine({ c, geo }: { c: Corner2D; geo: Solution2D['geo'] }) {
  const th = c.x[2];
  // Direction of the slider axis in the current pose, pointing down from the top (the damper angle rotated by the pose).
  const a = geo.damper + th;
  const len = Math.hypot(c.upperOuter[0] - c.lowerOuter[0], c.upperOuter[1] - c.lowerOuter[1]);
  const sign = c.contact[0] >= 0 ? 1 : -1;
  const dir: P2 = [sign * Math.sin(a), -Math.cos(a)];
  return <Line a={c.upperOuter} b={[c.upperOuter[0] + dir[0] * len, c.upperOuter[1] + dir[1] * len]} className="g-arm strut" />;
}

/** Instant centre and roll centre construction lines. */
function Construction({ right, left, bump, sol, k, showLeft }: { right: Corner2D; left: Corner2D; bump: boolean; sol: Solution2D; k: number; showLeft: boolean }) {
  const far = (from: P2, to: P2): P2 => {
    // Cut very distant instant centres short so the line still draws.
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return d > FAR ? [from[0] + ((to[0] - from[0]) * FAR) / d, from[1] + ((to[1] - from[1]) * FAR) / d] : to;
  };
  const side = (c: Corner2D, key: string) => {
    if (!c.ic) return null;
    const ic = c.ic;
    return (
      <g key={key}>
        <Line a={c.lowerInner} b={far(c.lowerInner, ic)} className="g-con" />
        <Line a={c.upperInner} b={far(c.upperInner, ic)} className="g-con" />
        <Line a={c.contact} b={far(c.contact, ic)} className="g-con rc" />
        {Math.abs(ic[0]) < FAR && Math.abs(ic[1]) < FAR && <Marker at={ic} kind="cross" k={k} className="g-ic" />}
      </g>
    );
  };
  // In bump the roll centre is on the centre line, found from the right wheel's line; in roll it is where both lines cross.
  const rc: P2 = bump ? [0, sol.bump.rcHeight + right.contact[1]] : [sol.roll.rcLateral, sol.roll.rcHeight];
  return (
    <g>
      {side(right, 'r')}
      {showLeft && side(left, 'l')}
      <Marker at={rc} kind="diamond" k={k} className="g-rc" />
    </g>
  );
}
