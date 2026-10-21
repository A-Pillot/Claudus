// Cycle-averaged results versus speed (LES "Results Graph Viewer"): selectable axes, several graphs, overlays, list, cross-plot.
import { useMemo, useState } from 'react';
import { useEngine } from '../store';
import { Plot, PALETTE, type PlotSeries } from './Plot';
import { performanceVars, type PerfVar } from './vars';
import type { SweepResult } from '@claudus/engine';

interface GraphCfg { id: number; x: string; ys: string[] }

const DASHES: (number[] | undefined)[] = [undefined, [6, 4], [2, 3], [10, 3, 2, 3]];

function PerfGraph({ cfg, vars, results, overlays, showOverlays, onChange, onRemove }: {
  cfg: GraphCfg; vars: PerfVar[]; results: SweepResult; overlays: SweepResult[]; showOverlays: boolean;
  onChange: (c: GraphCfg) => void; onRemove: () => void;
}) {
  const xv = vars.find((v) => v.key === cfg.x) ?? vars[0];
  const yvs = cfg.ys.map((k) => vars.find((v) => v.key === k)).filter((v): v is PerfVar => !!v);
  const [list, setList] = useState(false);
  const [logY, setLogY] = useState(false);
  const series = useMemo<PlotSeries[]>(() => {
    const out: PlotSeries[] = [];
    const sets = [results, ...(showOverlays ? overlays : [])];
    yvs.forEach((yv, yi) =>
      sets.forEach((set, si) => {
        // Sort by x so speed curves stay monotonic; cross-plots keep speed order instead.
        const pts = [...set.points].sort((a, b) => a.speed - b.speed);
        out.push({
          label: `${yv.label} (${yv.unit})${si ? ` [${set.modelName || 'overlay ' + si}]` : ''}`,
          x: pts.map(xv.get), y: pts.map(yv.get),
          color: PALETTE[yi % PALETTE.length], dash: DASHES[si % DASHES.length], points: true,
        });
      }),
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, overlays, showOverlays, cfg.x, cfg.ys.join(',')]);
  const cross = xv.key !== 'speed';
  return (
    <div className="er-card">
      <div className="er-bar">
        <label>X <select value={cfg.x} onChange={(e) => onChange({ ...cfg, x: e.target.value })}>{vars.map((v) => <option key={v.key} value={v.key}>{v.label} ({v.unit})</option>)}</select></label>
        <label>Add Y <select value="" onChange={(e) => e.target.value && onChange({ ...cfg, ys: [...new Set([...cfg.ys, e.target.value])] })}>
          <option value="">curve...</option>
          {vars.map((v) => <option key={v.key} value={v.key}>{v.label} ({v.unit})</option>)}
        </select></label>
        <label><input type="checkbox" checked={logY} onChange={(e) => setLogY(e.target.checked)} /> log Y</label>
        <label><input type="checkbox" checked={list} onChange={(e) => setList(e.target.checked)} /> list points</label>
        <button className="er-mini" onClick={onRemove}>Remove graph</button>
      </div>
      <div className="er-chips">
        {yvs.map((v, i) => (
          <span key={v.key} className="er-chip" style={{ borderColor: PALETTE[i % PALETTE.length] }}>
            {v.label}
            <button onClick={() => onChange({ ...cfg, ys: cfg.ys.filter((k) => k !== v.key) })} aria-label={`Remove ${v.label}`}>x</button>
          </span>
        ))}
      </div>
      <Plot series={series} xLabel={`${xv.label} (${xv.unit})`} yLabel={yvs.length === 1 ? `${yvs[0].label} (${yvs[0].unit})` : 'value'} logY={logY} xy={cross} />
      {list && (
        <div className="er-table-wrap">
          <table className="er-table">
            <thead><tr><th>{xv.label}</th>{yvs.map((v) => <th key={v.key}>{v.label} ({v.unit})</th>)}</tr></thead>
            <tbody>
              {[...results.points].sort((a, b) => a.speed - b.speed).map((p, i) => (
                <tr key={i}><td>{xv.get(p).toFixed(2)}</td>{yvs.map((v) => <td key={v.key}>{v.get(p).toPrecision(5)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PerformanceView() {
  const results = useEngine((s) => s.results);
  const overlays = useEngine((s) => s.overlays);
  const clearOverlays = useEngine((s) => s.clearOverlays);
  const addOverlay = useEngine((s) => s.addOverlay);
  const vars = useMemo(() => performanceVars(results), [results]);
  const [graphs, setGraphs] = useState<GraphCfg[]>([
    { id: 1, x: 'speed', ys: ['power', 'torque'] },
    { id: 2, x: 'speed', ys: ['bmep', 'imep', 'fmep'] },
    { id: 3, x: 'speed', ys: ['bsfc'] },
    { id: 4, x: 'speed', ys: ['ve'] },
  ]);
  const [showOverlays, setShowOverlays] = useState(true);
  if (!results) return <div className="er-empty">No results yet. Run the simulation to see performance curves.</div>;
  return (
    <div className="er-view">
      <div className="er-bar">
        <button onClick={() => setGraphs((g) => [...g, { id: Math.max(0, ...g.map((x) => x.id)) + 1, x: 'speed', ys: ['power'] }])}>Add graph</button>
        <label><input type="checkbox" checked={showOverlays} onChange={(e) => setShowOverlays(e.target.checked)} /> Show overlays ({overlays.length})</label>
        <button onClick={() => addOverlay(results)} title="Keep the current results as an overlay for later runs">Keep as overlay</button>
        <button onClick={clearOverlays} disabled={!overlays.length}>Clear overlays</button>
      </div>
      <div className="er-grid">
        {graphs.map((g) => (
          <PerfGraph key={g.id} cfg={g} vars={vars} results={results} overlays={overlays} showOverlays={showOverlays}
            onChange={(c) => setGraphs((all) => all.map((x) => (x.id === c.id ? c : x)))}
            onRemove={() => setGraphs((all) => all.filter((x) => x.id !== g.id))} />
        ))}
      </div>
    </div>
  );
}
