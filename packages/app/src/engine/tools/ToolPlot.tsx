// Small shared line plot for the tool dialogs (uPlot, common x for all series).
import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export const TOOL_COLOURS = ['#4e9fe5', '#ff9f43', '#5fd38d', '#e5645e', '#b58cf0', '#e7d24a', '#4fd1d9', '#f07fb8'];

export interface ToolSeries {
  label: string;
  y: (number | null)[];
  colour?: string;
  dash?: number[];
  points?: boolean;
  /** Plot against the right-hand axis. */
  right?: boolean;
}

interface Props {
  title?: string;
  x: number[];
  series: ToolSeries[];
  xLabel: string;
  yLabel: string;
  yRightLabel?: string;
  height?: number;
}

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function ToolPlot({ title, x, series, xLabel, yLabel, yRightLabel, height = 230 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const coloured = useMemo(() => series.map((s, i) => ({ ...s, colour: s.colour ?? TOOL_COLOURS[i % TOOL_COLOURS.length] })), [series]);

  useEffect(() => {
    const el = host.current;
    if (!el || !x.length) return;
    const text = css('--muted', '#8b96a5'), grid = css('--line', '#2a313b');
    const axis = (scale: string, label: string, side?: 1): uPlot.Axis => ({
      scale, label, stroke: text, side, grid: side ? { show: false } : { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 },
      labelSize: 16, labelFont: '11px sans-serif', font: '11px sans-serif', size: scale === 'x' ? 40 : 52,
    });
    const hasRight = coloured.some((s) => s.right);
    const opts: uPlot.Options = {
      width: el.clientWidth || 400, height,
      legend: { show: false },
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false }, y: {}, y2: {} },
      axes: [axis('x', xLabel), axis('y', yLabel), ...(hasRight ? [axis('y2', yRightLabel ?? '', 1)] : [])],
      series: [
        {},
        ...coloured.map((s) => ({
          label: s.label, stroke: s.colour, width: 1.6, dash: s.dash, scale: s.right ? 'y2' : 'y', spanGaps: false,
          points: { show: !!s.points, size: 5, stroke: s.colour, fill: s.colour },
        })),
      ],
    };
    const data = [x, ...coloured.map((s) => s.y)] as uPlot.AlignedData;
    const u = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    const dbl = () => u.setData(data, true);
    el.addEventListener('dblclick', dbl);
    return () => { ro.disconnect(); el.removeEventListener('dblclick', dbl); u.destroy(); };
  }, [x, coloured, xLabel, yLabel, yRightLabel, height]);

  return (
    <div>
      {title && <div className="eplot-title">{title}</div>}
      <div ref={host} className="eplot-host" />
      <div className="elegend">
        {coloured.map((s, i) => (
          <span key={i} style={{ color: s.colour }}><i style={{ borderTopStyle: s.dash ? 'dashed' : 'solid', borderTopColor: s.colour }} />{s.label}</span>
        ))}
      </div>
    </div>
  );
}
