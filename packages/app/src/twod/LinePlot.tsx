import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface PlotLine {
  label: string;
  colour: string;
  dash?: number[];
  /** [x, y] points; lines can have different x values. */
  points: [number, number][];
}

/** A small uPlot chart of several lines with a dashed marker at the current x. */
export function LinePlot({ lines, xLabel, yLabel, marker }: { lines: PlotLine[]; xLabel: string; yLabel: string; marker: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const markerRef = useRef(marker);
  markerRef.current = marker;

  // Merge every line onto one sorted x axis; gaps are bridged so a sparse user line still draws.
  const data = useMemo(() => {
    const xs = [...new Set(lines.flatMap((l) => l.points.map((p) => p[0])))].sort((a, b) => a - b);
    const cols = lines.map((l) => {
      const m = new Map(l.points.filter((p) => Number.isFinite(p[1])).map((p) => [p[0], p[1]]));
      return xs.map((x) => m.get(x) ?? null);
    });
    return [xs, ...cols] as uPlot.AlignedData;
  }, [lines]);

  const names = lines.map((l) => l.label).join('|');

  useEffect(() => {
    const el = ref.current!;
    const axis = { stroke: '#aab4c3', grid: { stroke: '#2a313b', width: 1 }, ticks: { stroke: '#2a313b', width: 1 } };
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: Math.max(140, el.clientHeight),
      scales: {
        x: { time: false },
        y: {
          range: (_u, min, max) => {
            if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
            const span = Math.max(max - min, 1e-3 * Math.max(1, Math.abs(min), Math.abs(max)), 0.01);
            const mid = (max + min) / 2;
            return [mid - span * 0.55, mid + span * 0.55];
          },
        },
      },
      legend: { show: true },
      cursor: { drag: { x: true, y: false } },
      axes: [{ ...axis, label: xLabel }, { ...axis, label: yLabel, size: 60 }],
      series: [
        { label: xLabel },
        ...lines.map((l) => ({ label: l.label, stroke: l.colour, width: 2, dash: l.dash, spanGaps: true, points: { show: !l.dash } })),
      ],
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
    // Rebuild when the axes or the set of lines changes; data updates go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xLabel, yLabel, names]);

  useEffect(() => { plot.current?.setData(data); }, [data]);
  useEffect(() => { plot.current?.redraw(false); }, [marker]);

  return <div className="plot" ref={ref} />;
}
