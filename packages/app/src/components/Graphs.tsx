import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { EndAnalysis } from '@claudus/core';
import { useApp } from '../store';

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
      { key: 'rcY', label: 'Roll centre Y', unit: 'mm', get: (r) => r.rollCentre[1] },
      { key: 'rcZ', label: 'Roll centre Z', unit: 'mm', get: (r) => r.rollCentre[2] },
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

function GraphCard({ results, mode, varKey, onChange }: { results?: EndAnalysis[]; mode: Mode; varKey: string; onChange: (m: Mode, k: string) => void }) {
  const def = VARIABLES[mode];
  const y = def.ys.find((v) => v.key === varKey) ?? def.ys[0];
  const art = useApp((s) => s.art);
  const current = mode === 'bump' ? art.bump : mode === 'roll' ? art.roll : art.rack;

  const { data, series } = useMemo(() => {
    const ends = (results ?? []).filter((r) => r[mode].length > 0);
    if (!ends.length) return { data: null, series: [] };
    // Each end may have its own x values; merge them onto one sorted x axis.
    const xs = [...new Set(ends.flatMap((e) => (e[mode] as any[]).map(def.x.get)))].sort((a, b) => a - b);
    const cols = ends.map((e) => {
      const m = new Map((e[mode] as any[]).map((r) => [def.x.get(r), y.get(r)]));
      return xs.map((x) => { const v = m.get(x); return v === undefined || !Number.isFinite(v) ? null : v; });
    });
    return {
      data: [xs, ...cols] as uPlot.AlignedData,
      series: ends.map((e) => ({ label: e.end === 'front' ? 'Front' : 'Rear', stroke: END_COLOURS[e.end], width: 2, spanGaps: false })),
    };
  }, [results, mode, y, def]);

  return (
    <div className="graphcard">
      <div className="graphhead">
        <select value={mode} onChange={(e) => { const m = e.target.value as Mode; onChange(m, VARIABLES[m].ys[0].key); }}>
          <option value="bump">Bump</option>
          <option value="roll">Roll</option>
          <option value="steer">Steer</option>
        </select>
        <select value={y.key} onChange={(e) => onChange(mode, e.target.value)}>
          {def.ys.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
      </div>
      {data ? (
        <Plot data={data} series={series} xLabel={`${def.x.label} (${def.x.unit})`} yLabel={y.unit || 'ratio'} marker={current} />
      ) : (
        <div className="muted pad">{results ? 'Not applicable to this model.' : 'Calculating…'}</div>
      )}
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
