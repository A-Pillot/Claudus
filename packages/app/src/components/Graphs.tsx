import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { deviation, leftRows, lineFromData, lineKey, measureColumns, unitFactor, unitText, type End, type EndAnalysis, type Side, type Sweep, type UserLine } from '@claudus/core';
import { useApp } from '../store';
import { useLab } from '../lab';
import { defaultOptions, defaultStyle, drawMarker, GraphStyleDialog, type GraphOptions, type Marker } from './GraphOptions';
import { useUnitSettings } from '../units';

type Mode = 'bump' | 'roll' | 'steer';

interface VarDef { key: string; label: string; unit: string; get: (row: any) => number }

const g = (key: string) => (r: any) => r[key] as number;

export const VARIABLES: Record<Mode, { x: VarDef; ys: VarDef[] }> = {
  bump: {
    x: { key: 'bump', label: 'Bump travel', unit: 'mm', get: g('bump') },
    ys: [
      { key: 'camber', label: 'Camber angle', unit: 'deg', get: g('camber') },
      { key: 'toeSae', label: 'Toe angle (SAE)', unit: 'deg', get: g('toeSae') },
      { key: 'toePlane', label: 'Toe angle (wheel plane)', unit: 'deg', get: g('toePlane') },
      { key: 'castor', label: 'Castor angle', unit: 'deg', get: g('castor') },
      { key: 'kingpin', label: 'Kingpin angle', unit: 'deg', get: g('kingpin') },
      { key: 'castorTrail', label: 'Castor trail', unit: 'mm', get: g('castorTrail') },
      { key: 'castorOffset', label: 'Castor offset', unit: 'mm', get: g('castorOffset') },
      { key: 'mechanicalTrail', label: 'Mechanical trail', unit: 'mm', get: g('mechanicalTrail') },
      { key: 'kingpinOffsetWheel', label: 'Kingpin offset at wheel', unit: 'mm', get: g('kingpinOffsetWheel') },
      { key: 'kingpinOffsetGround', label: 'Kingpin offset at ground', unit: 'mm', get: g('kingpinOffsetGround') },
      { key: 'damperRatio', label: 'Damper ratio', unit: '', get: g('damperRatio') },
      { key: 'springRatio', label: 'Spring ratio', unit: '', get: g('springRatio') },
      { key: 'antiDive', label: 'Anti dive', unit: '%', get: g('antiDive') },
      { key: 'antiSquat', label: 'Anti squat', unit: '%', get: g('antiSquat') },
      { key: 'rollCentreToBody', label: 'Roll centre height to body', unit: 'mm', get: g('rollCentreToBody') },
      { key: 'rollCentreToGround', label: 'Roll centre height to ground', unit: 'mm', get: g('rollCentreToGround') },
      { key: 'halfTrackChange', label: 'Half track change', unit: 'mm', get: g('halfTrackChange') },
      { key: 'wheelbaseChange', label: 'Wheelbase change', unit: 'mm', get: g('wheelbaseChange') },
      { key: 'damperTravel', label: 'Damper travel', unit: 'mm', get: g('damperTravel') },
      { key: 'springTravel', label: 'Spring travel', unit: 'mm', get: g('springTravel') },
    ],
  },
  roll: {
    x: { key: 'roll', label: 'Roll angle', unit: 'deg', get: g('roll') },
    ys: [
      { key: 'camber', label: 'Camber angle', unit: 'deg', get: g('camber') },
      { key: 'toeSae', label: 'Toe angle (SAE)', unit: 'deg', get: g('toeSae') },
      { key: 'castor', label: 'Castor angle', unit: 'deg', get: g('castor') },
      { key: 'kingpin', label: 'Kingpin angle', unit: 'deg', get: g('kingpin') },
      { key: 'damperRatio', label: 'Damper ratio', unit: '', get: g('damperRatio') },
      { key: 'springRatio', label: 'Spring ratio', unit: '', get: g('springRatio') },
      { key: 'rollCentreY', label: 'Roll centre Y', unit: 'mm', get: (r) => r.rollCentre[1] },
      { key: 'rollCentreZ', label: 'Roll centre Z', unit: 'mm', get: (r) => r.rollCentre[2] },
      { key: 'halfTrackChange', label: 'Half track change', unit: 'mm', get: g('halfTrackChange') },
      { key: 'wheelbaseChange', label: 'Wheelbase change', unit: 'mm', get: g('wheelbaseChange') },
      { key: 'damperTravel', label: 'Damper travel', unit: 'mm', get: g('damperTravel') },
      { key: 'springTravel', label: 'Spring travel', unit: 'mm', get: g('springTravel') },
    ],
  },
  steer: {
    x: { key: 'rack', label: 'Rack travel', unit: 'mm', get: g('rack') },
    ys: [
      { key: 'toeInner', label: 'Toe angle, inner wheel', unit: 'deg', get: g('toeInner') },
      { key: 'toeOuter', label: 'Toe angle, outer wheel', unit: 'deg', get: g('toeOuter') },
      { key: 'camberInner', label: 'Camber, inner wheel', unit: 'deg', get: g('camberInner') },
      { key: 'camberOuter', label: 'Camber, outer wheel', unit: 'deg', get: g('camberOuter') },
      { key: 'steerInner', label: 'Steer angle, inner wheel', unit: 'deg', get: g('steerInner') },
      { key: 'steerOuter', label: 'Steer angle, outer wheel', unit: 'deg', get: g('steerOuter') },
      { key: 'ackermann', label: 'Ackermann', unit: '%', get: g('ackermann') },
      { key: 'turningRadius', label: 'Turning radius', unit: 'mm', get: g('turningRadius') },
    ],
  },
};

/** The plottable results of the measurement elements (distance, components, angle) of every end's template. */
function measureVars(results?: EndAnalysis[]): VarDef[] {
  const seen = new Map<string, VarDef>();
  for (const e of results ?? [])
    for (const c of measureColumns(e.corner.template))
      if (!seen.has(c.key)) seen.set(c.key, { key: c.key, label: c.label, unit: c.unit, get: (r) => r.measures?.[c.key] ?? NaN });
  return [...seen.values()];
}

const DEFAULTS: { mode: Mode; key: string }[] = [
  { mode: 'bump', key: 'camber' },
  { mode: 'bump', key: 'toeSae' },
  { mode: 'bump', key: 'rollCentreToGround' },
  { mode: 'steer', key: 'ackermann' },
];

export function Graphs({ results }: { results?: EndAnalysis[] }) {
  const [charts, setCharts] = useState(DEFAULTS);
  return (
    <div className="graphs">
      {charts.map((c, i) => (
        <GraphCard
          key={i}
          results={results}
          mode={c.mode}
          varKey={c.key}
          onChange={(mode, key) => setCharts(charts.map((cc, j) => (j === i ? { mode, key } : cc)))}
        />
      ))}
    </div>
  );
}

/** Every graph variable of every sweep for one set of results, as user lines (SHARK's "copy all to user"). */
export function allLines(results: EndAnalysis[] | undefined, end: End, side: Side = 'right'): UserLine[] {
  const r = results?.find((e) => e.end === end);
  if (!r) return [];
  const out: UserLine[] = [];
  for (const sweep of ['bump', 'roll', 'steer'] as Mode[])
    for (const v of VARIABLES[sweep].ys) {
      const l = lineFromData(r[sweep], sweep, v.key, end, side);
      if (l.points.length) out.push(l);
    }
  return out;
}

const SCOPE_ALPHA = ['ff', 'cc', 'a6', '80', '66'];
const END_NAME = { front: 'Front', rear: 'Rear' } as const;
const fixed = (v: number | undefined, f = 1) => (v === undefined ? '–' : (v * f).toFixed(3));

/** Per-series drawing info that uPlot's own series options do not cover. */
interface ColMeta { marker: Marker; colour: string; size: number; grad: boolean }

function GraphCard({ results, mode, varKey, onChange }: { results?: EndAnalysis[]; mode: Mode; varKey: string; onChange: (m: Mode, k: string) => void }) {
  const base = VARIABLES[mode];
  const extra = useMemo(() => measureVars(results), [results]);
  const def = useMemo(() => ({ x: base.x, ys: [...base.ys, ...extra] }), [base, extra]);
  const y = def.ys.find((v) => v.key === varKey) ?? def.ys[0];
  const art = useApp((s) => s.art);
  const units = useUnitSettings();
  const fx = unitFactor(def.x.unit, units);
  const fy = unitFactor(y.unit, units);
  const current = (mode === 'bump' ? art.bump : mode === 'roll' ? art.roll : art.rack) * fx;
  const userLines = useLab((s) => s.userLines);
  const scope = useLab((s) => s.scope);
  const vis = useLab((s) => s.graphVis);
  const devSlot = useLab((s) => s.scopeDevSlot);
  const cmd = useLab((s) => s.graphCmd);
  const lab = useLab.getState;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [opts, setOpts] = useState<GraphOptions>(defaultOptions);
  const [view, setView] = useState<View | null>(null);
  const [styling, setStyling] = useState(false);

  // Menu commands that apply to every open graph.
  const seen = useRef(cmd.n);
  useEffect(() => {
    if (cmd.n === seen.current) return;
    seen.current = cmd.n;
    if (cmd.kind === 'autoscale') setView(null);
    else if (cmd.kind === 'swap') setOpts((o) => ({ ...o, swap: !o.swap }));
    else setOpts((o) => ({ ...o, style: defaultStyle() }));
  }, [cmd]);

  const ends = useMemo(() => (results ?? []).filter((r) => r[mode].length > 0), [results, mode]);
  // Steer results are inner/outer wheel values, so there is no separate left-hand data line for them.
  const sides: Side[] = vis.left && mode !== 'steer' ? ['right', 'left'] : ['right'];
  const idOf = (end: End, side: Side) => ({ end, side, sweep: mode as Sweep, variable: y.key });
  const lineFor = (end: End, side: Side) => userLines.find((l) => lineKey(l) === lineKey(idOf(end, side)));
  const sideName = (side: Side) => (side === 'left' ? ' -Y' : '');

  const { data, series, metas } = useMemo(() => {
    if (!ends.length) return { data: null, series: [], metas: [] };
    type Col = { s: uPlot.Series; meta: ColMeta; m: Map<number, number | null> };
    const cols: Col[] = [];
    const rowsMap = (rows: any[]) => new Map<number, number | null>(rows.map((r) => { const v = y.get(r); return [def.x.get(r) * fx, v === undefined || !Number.isFinite(v) ? null : v * fy]; }));
    const st = opts.style;
    // Scope lines first so the data line is drawn on top of them.
    if (vis.scope)
      scope.forEach((snap, i) => {
        if (!snap) return;
        for (const e of ends) {
          const r = snap.find((x) => x.end === e.end);
          if (!r || !r[mode].length) continue;
          const colour = st.scope.colour + SCOPE_ALPHA[i];
          cols.push({
            s: { label: `Scope ${i + 1}${ends.length > 1 ? ' ' + END_NAME[e.end].toLowerCase() : ''}`, stroke: colour, width: 1.5, dash: [6, 4], spanGaps: true, points: { show: false } },
            meta: { marker: st.scope.marker, colour, size: 3, grad: false },
            m: rowsMap(r[mode] as any[]),
          });
        }
      });
    if (vis.userLine)
      for (const e of ends)
        for (const side of sides) {
          const l = lineFor(e.end, side);
          if (!l) continue;
          cols.push({
            s: { label: `User${ends.length > 1 ? ' ' + END_NAME[e.end].toLowerCase() : ''}${sideName(side)}`, stroke: st.user.colour, width: 2, dash: side === 'left' ? [3, 3] : undefined, spanGaps: true, points: { show: false } },
            meta: { marker: st.user.marker, colour: st.user.colour, size: 4, grad: false },
            m: new Map(l.points.map(([px, py]) => [px * fx, py * fy] as [number, number | null])),
          });
        }
    for (const e of ends)
      for (const side of sides) {
        const ls = e.end === 'front' ? st.dataFront : st.dataRear;
        cols.push({
          s: { label: END_NAME[e.end] + sideName(side), stroke: ls.colour, width: 2, dash: side === 'left' ? [8, 4] : undefined, spanGaps: true, points: { show: false } },
          meta: { marker: ls.marker, colour: ls.colour, size: 3, grad: true },
          m: rowsMap((side === 'left' ? leftRows(e[mode] as any[], mode) : e[mode]) as any[]),
        });
      }
    const xs = [...new Set(cols.flatMap((c) => [...c.m.keys()]))].sort((a, b) => a - b);
    return {
      data: [xs, ...cols.map((c) => xs.map((x) => c.m.get(x) ?? null))] as uPlot.AlignedData,
      series: cols.map((c) => c.s),
      metas: cols.map((c) => c.meta),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ends, y, def, userLines, scope, vis.scope, vis.userLine, vis.left, mode, opts.style, fx, fy]);

  const devs = useMemo(() => ends.flatMap((e) => sides.map((side) => {
    const l = lineFor(e.end, side);
    const snap = scope[devSlot]?.find((x) => x.end === e.end);
    return {
      end: e.end,
      side,
      user: l ? deviation(e[mode] as any[], l) : undefined,
      scope: snap?.[mode].length ? deviation(e[mode] as any[], lineFromData(snap[mode] as any[], mode, y.key, e.end, side)) : undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [ends, userLines, scope, devSlot, mode, y, vis.left]);

  const closeMenu = () => setMenu(null);
  const run = (fn: () => void) => () => { fn(); closeMenu(); };
  const title = `${y.label} against ${def.x.label.toLowerCase()}`;
  const edit = (end: End, side: Side) => lab().setEditLine({ end, side, sweep: mode, variable: y.key, label: `${END_NAME[end]} ${side === 'left' ? '(-Y) ' : ''}${title}`, xUnit: def.x.unit, yUnit: y.unit });
  const copyData = () => ends.forEach((e) => sides.forEach((side) => lab().setUserLine(lineFromData(e[mode] as any[], mode, y.key, e.end, side))));
  const store = (slot: number) => results && lab().storeScope(slot, results);
  const hasUser = userLines.some((l) => ends.some((e) => (['right', 'left'] as Side[]).some((side) => lineKey(l) === lineKey(idOf(e.end, side)))));

  return (
    <div className="graphcard" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      <div className="graphhead">
        <select value={mode} onChange={(e) => { const m = e.target.value as Mode; onChange(m, VARIABLES[m].ys[0].key); setView(null); }}>
          <option value="bump">Bump</option>
          <option value="roll">Roll</option>
          <option value="steer">Steer</option>
        </select>
        <select value={y.key} onChange={(e) => { onChange(mode, e.target.value); setView(null); }}>
          {def.ys.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
        <button className="icon" title="Switch the x and y axes" aria-label="Switch x-y" aria-pressed={opts.swap} onClick={() => setOpts({ ...opts, swap: !opts.swap })}>⇄</button>
        <button className="icon" title="Autoscale (or double-click the graph). Drag a box on the graph to zoom." aria-label="Autoscale" disabled={!view} onClick={() => setView(null)}>⤢</button>
        <button className="icon" title="User lines, scope lines and appearance (or right-click the graph)" aria-label="Graph menu" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom }); }}>⋯</button>
      </div>
      {vis.deviation && devs.length > 0 && (
        <div className="devline" data-testid="deviation">
          {devs.map((d) => (
            <span key={d.end + d.side}>
              {ends.length > 1 || sides.length > 1 ? `${END_NAME[d.end]}${sideName(d.side)}: ` : ''}
              user deviation <b>{fixed(d.user, fy)}</b> · scope {devSlot + 1} deviation <b>{fixed(d.scope, fy)}</b>
            </span>
          ))}
        </div>
      )}
      {data ? (
        <Plot
          data={data} series={series} metas={metas} swap={opts.swap} view={view} onView={setView} showSlope={vis.derivative}
          xLabel={`${def.x.label} (${unitText(def.x.unit, units)})`} yLabel={y.unit ? `${y.label} (${unitText(y.unit, units)})` : y.label} marker={current}
        />
      ) : (
        <div className="muted pad">{results ? 'Not applicable to this model.' : 'Calculating…'}</div>
      )}
      {styling && <GraphStyleDialog options={opts} onChange={setOpts} onClose={() => setStyling(false)} />}
      {menu && (
        <GraphMenu at={menu} onClose={closeMenu}>
          {ends.flatMap((e) => (['right', 'left'] as Side[]).map((side) => (
            <button key={e.end + side} onClick={run(() => edit(e.end, side))}>Edit {END_NAME[e.end].toLowerCase()} ({side === 'left' ? '-Y' : '+Y'}) user line…</button>
          )))}
          <button disabled={!ends.length} onClick={run(copyData)}>Copy data line to user line</button>
          <button disabled={!hasUser} onClick={run(() => ends.forEach((e) => (['right', 'left'] as Side[]).forEach((side) => lab().clearUserLine(idOf(e.end, side)))))}>Clear user line</button>
          <hr />
          <div className="menuhead">Save to scope line</div>
          <div className="scopebtns">
            {scope.map((snap, i) => <button key={i} className={snap ? 'on' : ''} title={snap ? 'Replace scope line ' + (i + 1) : 'Save to scope line ' + (i + 1)} onClick={run(() => store(i))}>{i + 1}</button>)}
          </div>
          <button disabled={!scope.some(Boolean)} onClick={run(() => lab().clearScope())}>Clear scope lines</button>
          <hr />
          <button role="menuitemcheckbox" aria-checked={vis.deviation} onClick={run(() => lab().setGraphVis({ deviation: !vis.deviation }))}>
            <span className="tick">{vis.deviation ? '✓' : ''}</span>Show deviation values
          </button>
          <button role="menuitemcheckbox" aria-checked={vis.derivative} onClick={run(() => lab().setGraphVis({ derivative: !vis.derivative }))}>
            <span className="tick">{vis.derivative ? '✓' : ''}</span>Show derivative values
          </button>
          <hr />
          <button role="menuitemcheckbox" aria-checked={opts.swap} onClick={run(() => setOpts({ ...opts, swap: !opts.swap }))}>
            <span className="tick">{opts.swap ? '✓' : ''}</span>Switch x-y axis
          </button>
          <button disabled={!view} onClick={run(() => setView(null))}>Autoscale</button>
          <button onClick={run(() => setStyling(true))}>Colours and markers…</button>
        </GraphMenu>
      )}
    </div>
  );
}

/** A small context menu at a screen position that closes when the mouse goes down outside it. */
function GraphMenu({ at, onClose, children }: { at: { x: number; y: number }; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div className="menulist ctxmenu" role="menu" ref={ref} style={{ position: 'fixed', left: Math.min(at.x, window.innerWidth - 280), top: Math.max(4, Math.min(at.y, window.innerHeight - 480)), maxHeight: '90vh', overflowY: 'auto' }}>
      {children}
    </div>
  );
}

/** Zoom window: a [min, max] per scale; absent means autoscale. */
export interface View { x?: [number, number]; y?: [number, number] }

/** The slope of a curve at each of its points (central differences), skipping gaps. */
function nodeSlopes(xs: number[], ys: (number | null)[]): { x: number; y: number; m: number }[] {
  const p: [number, number][] = [];
  xs.forEach((x, i) => { const v = ys[i]; if (v != null && Number.isFinite(v)) p.push([x, v]); });
  return p.map(([x, y], i) => {
    const a = p[Math.max(0, i - 1)];
    const b = p[Math.min(p.length - 1, i + 1)];
    return { x, y, m: b[0] === a[0] ? NaN : (b[1] - a[1]) / (b[0] - a[0]) };
  });
}

/** The slope at x: node slopes interpolated linearly between the neighbouring points. */
export function slopeAt(nodes: { x: number; m: number }[], x: number): number | undefined {
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    if (x >= a.x && x <= b.x) return b.x === a.x ? b.m : a.m + ((x - a.x) / (b.x - a.x)) * (b.m - a.m);
  }
  return undefined;
}

function Plot({ data, series, metas, swap, view, onView, showSlope, xLabel, yLabel, marker }: {
  data: uPlot.AlignedData; series: uPlot.Series[]; metas: ColMeta[]; swap: boolean; view: View | null; onView: (v: View | null) => void;
  showSlope: boolean; xLabel: string; yLabel: string; marker: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const live = useRef({ marker, metas, view, onView, showSlope });
  live.current = { marker, metas, view, onView, showSlope };

  useEffect(() => {
    const el = ref.current!;
    const axisStyle = { stroke: '#aab4c3', grid: { stroke: '#2a313b', width: 1 }, ticks: { stroke: '#2a313b', width: 1 } };
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: Math.max(140, el.clientHeight),
      scales: {
        x: { time: false, ori: swap ? 1 : 0, range: (_u, min, max) => live.current.view?.x ?? [min, max] },
        // Keep a flat curve flat: without a minimum span uPlot zooms into solver round-off.
        y: {
          ori: swap ? 0 : 1,
          range: (_u, min, max) => {
            if (live.current.view?.y) return live.current.view.y;
            if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
            const span = Math.max(max - min, 1e-3 * Math.max(1, Math.abs(min), Math.abs(max)), 0.01);
            const mid = (max + min) / 2;
            const pad = span * 0.55;
            return [mid - pad, mid + pad];
          },
        },
      },
      legend: { show: true },
      cursor: { drag: { x: true, y: true, setScale: false } },
      axes: swap
        ? [{ ...axisStyle, scale: 'x', side: 3, label: xLabel, size: 60 }, { ...axisStyle, scale: 'y', side: 2, label: yLabel }]
        : [{ ...axisStyle, scale: 'x', label: xLabel }, { ...axisStyle, scale: 'y', label: yLabel, size: 60 }],
      series: [{ label: xLabel }, ...series],
      hooks: {
        init: [(u) => { u.over.addEventListener('dblclick', () => live.current.onView(null)); }],
        setSelect: [
          (u) => {
            const s = u.select;
            const range = (scale: 'x' | 'y'): [number, number] | undefined => {
              const horiz = u.scales[scale].ori === 0;
              if ((horiz ? s.width : s.height) < 6) return undefined;
              const a = u.posToVal(horiz ? s.left : s.top, scale);
              const b = u.posToVal(horiz ? s.left + s.width : s.top + s.height, scale);
              return [Math.min(a, b), Math.max(a, b)];
            };
            const x = range('x');
            const y = range('y');
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            if (x || y) live.current.onView({ ...live.current.view, ...(x ? { x } : {}), ...(y ? { y } : {}) });
          },
        ],
        draw: [
          (u) => {
            const ctx = u.ctx;
            const px = uPlot.pxRatio;
            const horiz = u.scales.x.ori === 0;
            const at = (xv: number, yv: number): [number, number] => {
              const a = u.valToPos(xv, 'x', true);
              const b = u.valToPos(yv, 'y', true);
              return horiz ? [a, b] : [b, a];
            };
            const { left, top, width, height } = u.bbox;
            const inside = (x: number, y: number) => x >= left - 1 && x <= left + width + 1 && y >= top - 1 && y <= top + height + 1;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, top, width, height);
            ctx.clip();
            // The static position.
            const m = live.current.marker;
            const mp = u.valToPos(m, 'x', true);
            if (Number.isFinite(mp)) {
              ctx.strokeStyle = '#ffe066';
              ctx.setLineDash([4 * px, 4 * px]);
              ctx.lineWidth = px;
              ctx.beginPath();
              if (horiz) { ctx.moveTo(mp, top); ctx.lineTo(mp, top + height); } else { ctx.moveTo(left, mp); ctx.lineTo(left + width, mp); }
              ctx.stroke();
              ctx.setLineDash([]);
            }
            const xs = u.data[0] as number[];
            ctx.font = `${10 * px}px sans-serif`;
            let slopeRow = 0;
            live.current.metas.forEach((meta, i) => {
              const ys = u.data[i + 1] as (number | null)[];
              ctx.strokeStyle = meta.colour;
              ctx.fillStyle = meta.colour;
              ctx.lineWidth = 1.5 * px;
              if (meta.marker !== 'none')
                xs.forEach((xv, k) => {
                  const yv = ys[k];
                  if (yv == null) return;
                  const [cx, cy] = at(xv, yv);
                  if (inside(cx, cy)) drawMarker(ctx, meta.marker, cx, cy, meta.size * px);
                });
              if (live.current.showSlope && meta.grad) {
                const nodes = nodeSlopes(xs, ys);
                // Each point's gradient; with many points only the static value is listed.
                if (nodes.length <= 30 && (horiz ? width : height) / px / nodes.length > 38) {
                  ctx.globalAlpha = 0.8;
                  for (const n of nodes) {
                    if (!Number.isFinite(n.m)) continue;
                    const [cx, cy] = at(n.x, n.y);
                    if (inside(cx, cy)) ctx.fillText(n.m.toFixed(3), cx + 4 * px, cy - 6 * px);
                  }
                  ctx.globalAlpha = 1;
                }
                const g = slopeAt(nodes, m);
                if (g !== undefined && Number.isFinite(g)) {
                  const yAt = nodes.length ? interpolateNodes(nodes, m) : undefined;
                  ctx.font = `bold ${11 * px}px sans-serif`;
                  const label = `slope ${g.toFixed(3)}`;
                  const [cx, cy] = yAt === undefined ? [left + 6 * px, top + (14 + 14 * slopeRow) * px] : at(m, yAt);
                  ctx.fillStyle = '#ffe066';
                  ctx.fillText(label, Math.min(cx + 8 * px, left + width - 130 * px), Math.max(cy - (12 + 12 * slopeRow) * px, top + 12 * px));
                  ctx.beginPath();
                  ctx.arc(cx, cy, 4 * px, 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.font = `${10 * px}px sans-serif`;
                  slopeRow++;
                }
              }
            });
            ctx.restore();
          },
        ],
      },
    };
    plot.current = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height: Math.max(140, el.clientHeight - 30) }));
    ro.observe(el);
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null; };
    // Rebuild when the axes or series change; data updates go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xLabel, yLabel, swap, series.map((s) => String(s.label) + String(s.stroke) + String(s.dash)).join()]);

  useEffect(() => { plot.current?.setData(data); }, [data, view]);
  useEffect(() => { plot.current?.redraw(false); }, [marker, metas, showSlope]);

  return <div className="plot" ref={ref} />;
}

function interpolateNodes(nodes: { x: number; y: number }[], x: number): number | undefined {
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    if (x >= a.x && x <= b.x) return b.x === a.x ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return undefined;
}
