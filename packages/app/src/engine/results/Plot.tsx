// Generic x-y plot on uPlot (scatter mode, so P-V loops and cross-plots work as well as curves).
import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { interp } from '@claudus/engine';
import './results.css';

export interface PlotSeries {
  label: string;
  x: number[];
  y: number[];
  color: string;
  dash?: number[];
  /** Draw markers on each point (performance curves). */
  points?: boolean;
}

export const PALETTE = ['#4e9fe5', '#ff9f43', '#5fd38d', '#e5645e', '#b58cf0', '#e7d24a', '#4fd1d9', '#f07fb8'];

interface Props {
  series: PlotSeries[];
  xLabel: string;
  yLabel: string;
  logX?: boolean;
  logY?: boolean;
  /** True when x is not monotonic (P-V loop, cross-plot): the readout picks the nearest point instead of interpolating. */
  xy?: boolean;
  yRange?: [number, number];
  xRange?: [number, number];
  height?: number;
  /** Vertical marker line at this x (crank angle slider). */
  marker?: number;
  title?: string;
  readout?: boolean;
}

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function Plot({ series, xLabel, yLabel, logX, logY, xy, yRange, xRange, height = 260, marker, title, readout = true }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [reset, setReset] = useState(0);
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const markerRef = useRef(marker);
  markerRef.current = marker;

  const key = useMemo(() => JSON.stringify([series.map((s) => [s.label, s.color, s.dash, s.points]), xLabel, yLabel, logX, logY, yRange, xRange, height, reset]), [series, xLabel, yLabel, logX, logY, yRange, xRange, height, reset]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const text = css('--muted', '#8b96a5'), grid = css('--line', '#2a313b');
    const clean = (s: PlotSeries): [number[], number[]] => {
      const x: number[] = [], y: number[] = [];
      for (let i = 0; i < Math.min(s.x.length, s.y.length); i++) {
        const a = s.x[i], b = s.y[i];
        if (!Number.isFinite(a) || !Number.isFinite(b) || (logX && a <= 0) || (logY && b <= 0)) continue;
        x.push(a); y.push(b);
      }
      return [x, y];
    };
    const data: uPlot.AlignedData = [null, ...series.map((s) => clean(s))] as unknown as uPlot.AlignedData;
    const paths = (u: uPlot, si: number) => {
      const d = u.data[si] as unknown as [number[], number[]];
      const p = new Path2D();
      let pen = false;
      for (let i = 0; i < d[0].length; i++) {
        const px = u.valToPos(d[0][i], 'x', true), py = u.valToPos(d[1][i], 'y', true);
        if (pen) p.lineTo(px, py); else { p.moveTo(px, py); pen = true; }
      }
      return { stroke: p, fill: undefined, clip: undefined, flags: 0 } as unknown as uPlot.Series.Paths;
    };
    const axis = (scale: string, label: string): uPlot.Axis => ({ scale, label, stroke: text, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, labelSize: 16, labelFont: '11px sans-serif', font: '11px sans-serif', size: scale === 'y' ? 56 : 40 });
    const opts: uPlot.Options = {
      mode: 2,
      width: el.clientWidth || 400,
      height,
      legend: { show: false },
      cursor: { drag: { x: true, y: true, setScale: true } },
      scales: {
        x: { time: false, distr: logX ? 3 : 1, ...(xRange ? { range: xRange } : {}) },
        y: { distr: logY ? 3 : 1, ...(yRange ? { range: yRange } : {}) },
      },
      axes: [axis('x', xLabel), axis('y', yLabel)],
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.label,
          facets: [{ scale: 'x', auto: true }, { scale: 'y', auto: true }],
          stroke: s.color,
          width: 1.6,
          dash: s.dash,
          paths,
          points: { show: !!s.points, size: 6, stroke: s.color, fill: s.color },
          _i: i,
        })),
      ] as uPlot.Series[],
      hooks: {
        setCursor: [(u) => {
          const l = u.cursor.left, t = u.cursor.top;
          if (l == null || t == null || l < 0) { setCursor(null); return; }
          setCursor({ x: u.posToVal(l, 'x'), y: u.posToVal(t, 'y') });
        }],
        draw: [(u) => {
          const m = markerRef.current;
          if (m == null) return;
          const px = u.valToPos(m, 'x', true);
          if (!Number.isFinite(px)) return;
          const c = u.ctx;
          c.save();
          c.strokeStyle = css('--sel', '#ffe066');
          c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(px, u.bbox.top); c.lineTo(px, u.bbox.top + u.bbox.height); c.stroke();
          c.restore();
        }],
      },
    };
    const u = new uPlot(opts, data, el);
    plot.current = u;
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => { ro.disconnect(); u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, series]);

  // Redraw marker without rebuilding when only it changes.
  useEffect(() => { plot.current?.redraw(false); }, [marker]);

  const rows = useMemo(() => {
    if (!cursor) return [];
    return seriesRef.current.map((s) => {
      if (xy) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < s.x.length; i++) {
          const d = ((s.x[i] - cursor.x) / (Math.abs(cursor.x) || 1)) ** 2 + ((s.y[i] - cursor.y) / (Math.abs(cursor.y) || 1)) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        return { s, x: best >= 0 ? s.x[best] : NaN, v: best >= 0 ? s.y[best] : NaN };
      }
      return { s, x: cursor.x, v: interp(s.x, s.y, cursor.x) };
    });
  }, [cursor, xy]);

  return (
    <div className="er-plot">
      <div className="er-plot-head">
        <b>{title}</b>
        <button className="er-mini" onClick={() => setReset((n) => n + 1)} title="Autoscale (also: double-click the graph). Drag to zoom.">Autoscale</button>
      </div>
      <div ref={host} className="er-plot-host" />
      {readout && (
        <div className="er-readout">
          {cursor ? (
            <>
              <span className="er-readout-x">{xLabel}: {rows.length && xy ? '' : cursor.x.toPrecision(5)}</span>
              {rows.map((r, i) => (
                <span key={i} style={{ color: r.s.color }}>{r.s.label}: {xy ? `${r.x.toPrecision(4)}, ` : ''}{Number.isFinite(r.v) ? r.v.toPrecision(5) : '-'}</span>
              ))}
            </>
          ) : (
            <span className="er-dim">Move over the graph for values. Drag to zoom, double-click to autoscale.</span>
          )}
        </div>
      )}
      <div className="er-legend">
        {series.map((s, i) => (
          <span key={i} style={{ color: s.color }}>
            <i style={{ borderTopStyle: s.dash ? 'dashed' : 'solid', borderTopColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
