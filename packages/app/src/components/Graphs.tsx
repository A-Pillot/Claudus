import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { deviation, lineFromData, lineKey, measureColumns, type End, type EndAnalysis, type Sweep, type UserLine } from '@claudus/core';
import { useApp } from '../store';
import { useLab } from '../lab';

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

const END_COLOURS = { front: '#4e9fe5', rear: '#f28e2b' } as const;
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
export function allLines(results: EndAnalysis[] | undefined, end: End): UserLine[] {
  const r = results?.find((e) => e.end === end);
  if (!r) return [];
  const out: UserLine[] = [];
  for (const sweep of ['bump', 'roll', 'steer'] as Mode[])
    for (const v of VARIABLES[sweep].ys) {
      const l = lineFromData(r[sweep], sweep, v.key, end);
      if (l.points.length) out.push(l);
    }
  return out;
}

const SCOPE_COLOURS = ['#b39ddb', '#80cbc4', '#e6ee9c', '#ffab91', '#90a4ae'];
const END_NAME = { front: 'Front', rear: 'Rear' } as const;
const fixed = (v: number | undefined) => (v === undefined ? '–' : v.toFixed(3));

function GraphCard({ results, mode, varKey, onChange }: { results?: EndAnalysis[]; mode: Mode; varKey: string; onChange: (m: Mode, k: string) => void }) {
  const base = VARIABLES[mode];
  const extra = useMemo(() => measureVars(results), [results]);
  const def = useMemo(() => ({ x: base.x, ys: [...base.ys, ...extra] }), [base, extra]);
  const y = def.ys.find((v) => v.key === varKey) ?? def.ys[0];
  const art = useApp((s) => s.art);
  const current = mode === 'bump' ? art.bump : mode === 'roll' ? art.roll : art.rack;
  const userLines = useLab((s) => s.userLines);
  const scope = useLab((s) => s.scope);
  const vis = useLab((s) => s.graphVis);
  const devSlot = useLab((s) => s.scopeDevSlot);
  const lab = useLab.getState;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const ends = useMemo(() => (results ?? []).filter((r) => r[mode].length > 0), [results, mode]);
  const idOf = (end: End) => ({ end, sweep: mode as Sweep, variable: y.key });
  const lineFor = (end: End) => userLines.find((l) => lineKey(l) === lineKey(idOf(end)));

  const { data, series } = useMemo(() => {
    if (!ends.length) return { data: null, series: [] };
    type Col = { s: uPlot.Series; m: Map<number, number | null> };
    const cols: Col[] = [];
    const rowsMap = (rows: any[]) => new Map<number, number | null>(rows.map((r) => { const v = y.get(r); return [def.x.get(r), v === undefined || !Number.isFinite(v) ? null : v]; }));
    // Scope lines first so the data line is drawn on top of them.
    if (vis.scope)
      scope.forEach((snap, i) => {
        if (!snap) return;
        for (const e of ends) {
          const r = snap.find((x) => x.end === e.end);
          if (!r || !r[mode].length) continue;
          cols.push({
            s: { label: `Scope ${i + 1}${ends.length > 1 ? ' ' + END_NAME[e.end].toLowerCase() : ''}`, stroke: SCOPE_COLOURS[i], width: 1.5, dash: [6, 4], spanGaps: true, points: { show: false } },
            m: rowsMap(r[mode] as any[]),
          });
        }
      });
    if (vis.userLine)
      for (const e of ends) {
        const l = lineFor(e.end);
        if (!l) continue;
        cols.push({
          s: { label: `User${ends.length > 1 ? ' ' + END_NAME[e.end].toLowerCase() : ''}`, stroke: '#7ee787', width: 2, spanGaps: true, points: { show: true, size: 7, fill: '#7ee787', stroke: '#7ee787' } },
          m: new Map(l.points.map(([px, py]) => [px, py] as [number, number | null])),
        });
      }
    for (const e of ends)
      cols.push({ s: { label: END_NAME[e.end], stroke: END_COLOURS[e.end], width: 2, spanGaps: true }, m: rowsMap(e[mode] as any[]) });
    const xs = [...new Set(cols.flatMap((c) => [...c.m.keys()]))].sort((a, b) => a - b);
    return {
      data: [xs, ...cols.map((c) => xs.map((x) => c.m.get(x) ?? null))] as uPlot.AlignedData,
      series: cols.map((c) => c.s),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ends, y, def, userLines, scope, vis.scope, vis.userLine, mode]);

  const devs = useMemo(() => ends.map((e) => {
    const l = lineFor(e.end);
    const snap = scope[devSlot]?.find((x) => x.end === e.end);
    return {
      end: e.end,
      user: l ? deviation(e[mode] as any[], l) : undefined,
      scope: snap?.[mode].length ? deviation(e[mode] as any[], lineFromData(snap[mode] as any[], mode, y.key, e.end)) : undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ends, userLines, scope, devSlot, mode, y]);

  const closeMenu = () => setMenu(null);
  const run = (fn: () => void) => () => { fn(); closeMenu(); };
  const title = `${y.label} against ${def.x.label.toLowerCase()}`;
  const edit = (end: End) => lab().setEditLine({ end, sweep: mode, variable: y.key, label: `${END_NAME[end]} ${title}` });
  const copyData = () => ends.forEach((e) => lab().setUserLine(lineFromData(e[mode] as any[], mode, y.key, e.end)));
  const store = (slot: number) => results && lab().storeScope(slot, results);

  return (
    <div className="graphcard" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      <div className="graphhead">
        <select value={mode} onChange={(e) => { const m = e.target.value as Mode; onChange(m, VARIABLES[m].ys[0].key); }}>
          <option value="bump">Bump</option>
          <option value="roll">Roll</option>
          <option value="steer">Steer</option>
        </select>
        <select value={y.key} onChange={(e) => onChange(mode, e.target.value)}>
          {def.ys.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
        <button className="icon" title="User lines and scope lines (or right-click the graph)" aria-label="Graph menu" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom }); }}>⋯</button>
      </div>
      {vis.deviation && devs.length > 0 && (
        <div className="devline" data-testid="deviation">
          {devs.map((d) => (
            <span key={d.end}>
              {ends.length > 1 ? `${END_NAME[d.end]}: ` : ''}
              user deviation <b>{fixed(d.user)}</b> · scope {devSlot + 1} deviation <b>{fixed(d.scope)}</b>
            </span>
          ))}
        </div>
      )}
      {data ? (
        <Plot data={data} series={series} xLabel={`${def.x.label} (${def.x.unit})`} yLabel={y.unit || 'ratio'} marker={current} />
      ) : (
        <div className="muted pad">{results ? 'Not applicable to this model.' : 'Calculating…'}</div>
      )}
      {menu && (
        <GraphMenu at={menu} onClose={closeMenu}>
          {ends.map((e) => <button key={e.end} onClick={run(() => edit(e.end))}>Edit {END_NAME[e.end].toLowerCase()} (+Y) user line…</button>)}
          <button disabled={!ends.length} onClick={run(copyData)}>Copy data line to user line</button>
          <button disabled={!userLines.some((l) => ends.some((e) => lineKey(l) === lineKey(idOf(e.end))))} onClick={run(() => ends.forEach((e) => lab().clearUserLine(idOf(e.end))))}>Clear user line</button>
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
    <div className="menulist ctxmenu" role="menu" ref={ref} style={{ position: 'fixed', left: Math.min(at.x, window.innerWidth - 280), top: Math.min(at.y, window.innerHeight - 330) }}>
      {children}
    </div>
  );
}

function Plot({ data, series, xLabel, yLabel, marker }: { data: uPlot.AlignedData; series: uPlot.Series[]; xLabel: string; yLabel: string; marker: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const markerRef = useRef(marker);
  markerRef.current = marker;

  useEffect(() => {
    const el = ref.current!;
    const axisStyle = { stroke: '#aab4c3', grid: { stroke: '#2a313b', width: 1 }, ticks: { stroke: '#2a313b', width: 1 } };
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: Math.max(140, el.clientHeight),
      scales: {
        x: { time: false },
        // Keep a flat curve flat: without a minimum span uPlot zooms into solver round-off.
        y: {
          range: (_u, min, max) => {
            if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
            const span = Math.max(max - min, 1e-3 * Math.max(1, Math.abs(min), Math.abs(max)), 0.01);
            const mid = (max + min) / 2;
            const pad = span * 0.55;
            return [mid - pad, mid + pad];
          },
        },
      },
      legend: { show: true },
      cursor: { drag: { x: true, y: false } },
      axes: [{ ...axisStyle, label: xLabel }, { ...axisStyle, label: yLabel, size: 60 }],
      series: [{ label: xLabel }, ...series],
      hooks: {
        draw: [
          (u) => {
            const x = u.valToPos(markerRef.current, 'x', true);
            if (!Number.isFinite(x)) return;
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = '#ffe066';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
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
  }, [xLabel, yLabel, series.map((s) => s.label).join()]);

  useEffect(() => { plot.current?.setData(data); }, [data]);
  useEffect(() => { plot.current?.redraw(false); }, [marker]);

  return <div className="plot" ref={ref} />;
}
