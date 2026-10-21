// Crank-angle traces (.PRS style): element/variable pickers, overlays across speeds, P-V diagram, user function, sound level.
import { useMemo, useState } from 'react';
import { useEngine } from '../store';
import { Plot, PALETTE, type PlotSeries } from './Plot';
import { combineChannels, nearestPoint, splAnalysis, traceChannels, type Channel, type Op } from './vars';
import type { TestPointResult } from '@claudus/engine';

type Kind = 'crank' | 'pv' | 'spl';
interface Spec { a: string; op?: Op; b?: string }
interface GraphCfg { id: number; kind: Kind; specs: Spec[]; logPV: boolean; cyl: number; splX: 'freq' | 'order'; weighted: boolean }

const DASHES: (number[] | undefined)[] = [undefined, [6, 4], [2, 3], [10, 3, 2, 3], [4, 2]];

function ChannelSelect({ channels, value, onChange }: { channels: Channel[]; value: string; onChange: (k: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Channel[]>();
    for (const c of channels) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m];
  }, [channels]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">select...</option>
      {groups.map(([g, cs]) => (
        <optgroup key={g} label={g}>{cs.map((c) => <option key={c.key} value={c.key}>{c.label}{c.unit ? ` (${c.unit})` : ''}</option>)}</optgroup>
      ))}
    </select>
  );
}

function TraceGraph({ cfg, onChange, onRemove, points, speeds, overlayPoints }: {
  cfg: GraphCfg; onChange: (c: GraphCfg) => void; onRemove: () => void;
  points: TestPointResult[]; speeds: number[]; overlayPoints: TestPointResult[];
}) {
  const [fn, setFn] = useState<Spec>({ a: '', op: '-', b: '' });
  const primary = points[0];
  const channels = useMemo(() => (primary ? traceChannels(primary) : []), [primary]);
  const set = (p: Partial<GraphCfg>) => onChange({ ...cfg, ...p });

  const series = useMemo<PlotSeries[]>(() => {
    const out: PlotSeries[] = [];
    const all = [...points.map((p) => ({ p, ov: false })), ...overlayPoints.map((p) => ({ p, ov: true }))];
    if (cfg.kind === 'pv') {
      all.forEach(({ p, ov }, pi) => {
        const c = p.traces.cylinders.find((x) => x.id === cfg.cyl) ?? p.traces.cylinders[0];
        if (!c) return;
        out.push({ label: `Cyl ${c.id} ${Math.round(p.speed)} rpm${ov ? ' (overlay)' : ''}`, x: c.volume, y: c.pressure, color: PALETTE[pi % PALETTE.length], dash: ov ? [6, 4] : undefined });
      });
      return out;
    }
    if (cfg.kind === 'spl') {
      all.forEach(({ p, ov }, pi) => {
        const ch = traceChannels(p).find((c) => c.key === cfg.specs[0]?.a);
        const r = ch && splAnalysis(ch, p.speed, cfg.weighted);
        if (!r) return;
        out.push({ label: `${ch!.group} ${Math.round(p.speed)} rpm${ov ? ' (overlay)' : ''}`, x: cfg.splX === 'order' ? r.order : r.frequency, y: r.spl, color: PALETTE[pi % PALETTE.length], dash: ov ? [6, 4] : undefined });
      });
      return out;
    }
    all.forEach(({ p, ov }, pi) => {
      const chs = traceChannels(p);
      const find = (k: string) => chs.find((c) => c.key === k);
      cfg.specs.forEach((s, si) => {
        const a = find(s.a);
        if (!a) return;
        const b = s.op && s.b ? find(s.b) : undefined;
        const ch = b && s.op ? combineChannels(a, b, s.op) : a;
        const multi = all.length > 1;
        out.push({
          label: `${ch.group} ${ch.label}${multi ? ` @${Math.round(p.speed)}` : ''}${ov ? ' (ov)' : ''}`,
          x: ch.angle, y: ch.values,
          color: PALETTE[(multi ? pi : si) % PALETTE.length], dash: multi ? DASHES[si % DASHES.length] : ov ? [6, 4] : undefined,
        });
      });
    });
    return out;
  }, [cfg, points, overlayPoints]);

  const units = useMemo(() => [...new Set(cfg.specs.map((s) => channels.find((c) => c.key === s.a)?.unit ?? ''))], [cfg.specs, channels]);
  const cyls = primary?.traces.cylinders ?? [];
  const pipeEnds = channels.filter((c) => /^pipe:\d+:(end|start):p$/.test(c.key));

  return (
    <div className="er-card">
      <div className="er-bar">
        <label>Graph <select value={cfg.kind} onChange={(e) => set({ kind: e.target.value as Kind, specs: e.target.value === 'spl' ? [{ a: pipeEnds[pipeEnds.length - 1]?.key ?? '' }] : cfg.specs })}>
          <option value="crank">Crank angle traces</option><option value="pv">P-V diagram</option><option value="spl">Sound pressure level</option>
        </select></label>
        {cfg.kind === 'pv' && (
          <>
            <label>Cylinder <select value={cfg.cyl} onChange={(e) => set({ cyl: Number(e.target.value) })}>{cyls.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}</select></label>
            <label><input type="checkbox" checked={cfg.logPV} onChange={(e) => set({ logPV: e.target.checked })} /> log-log</label>
          </>
        )}
        {cfg.kind === 'spl' && (
          <>
            <label>Pipe end <ChannelSelect channels={pipeEnds} value={cfg.specs[0]?.a ?? ''} onChange={(k) => set({ specs: [{ a: k }] })} /></label>
            <label>X <select value={cfg.splX} onChange={(e) => set({ splX: e.target.value as 'freq' | 'order' })}><option value="freq">Frequency (Hz)</option><option value="order">Engine order</option></select></label>
            <label><input type="checkbox" checked={cfg.weighted} onChange={(e) => set({ weighted: e.target.checked })} /> A-weighted</label>
          </>
        )}
        {cfg.kind === 'crank' && (
          <>
            <label>Add trace <ChannelSelect channels={channels} value="" onChange={(k) => k && set({ specs: [...cfg.specs, { a: k }] })} /></label>
          </>
        )}
        <button className="er-mini" onClick={onRemove}>Remove graph</button>
      </div>
      {cfg.kind === 'crank' && (
        <>
          <div className="er-chips">
            {cfg.specs.map((s, i) => {
              const a = channels.find((c) => c.key === s.a);
              const b = channels.find((c) => c.key === s.b);
              return (
                <span key={i} className="er-chip" style={{ borderColor: PALETTE[i % PALETTE.length] }}>
                  {a ? `${a.group} ${a.label}` : s.a}{s.op && b ? ` ${s.op} ${b.group} ${b.label}` : ''}
                  <button onClick={() => set({ specs: cfg.specs.filter((_, j) => j !== i) })} aria-label="Remove trace">x</button>
                </span>
              );
            })}
          </div>
          <div className="er-bar er-fn">
            <span>User function:</span>
            <ChannelSelect channels={channels} value={fn.a} onChange={(k) => setFn({ ...fn, a: k })} />
            <select value={fn.op} onChange={(e) => setFn({ ...fn, op: e.target.value as Op })}>{['+', '-', '*', '/'].map((o) => <option key={o}>{o}</option>)}</select>
            <ChannelSelect channels={channels} value={fn.b ?? ''} onChange={(k) => setFn({ ...fn, b: k })} />
            <button className="er-mini" disabled={!fn.a || !fn.b} onClick={() => set({ specs: [...cfg.specs, { ...fn }] })}>Add function</button>
          </div>
        </>
      )}
      {cfg.kind === 'crank' && <Plot series={series} xLabel="Crank angle (deg)" yLabel={units.length === 1 ? units[0] || 'value' : 'value'} />}
      {cfg.kind === 'pv' && <Plot series={series} xLabel="Volume (cc)" yLabel="Pressure (bar)" logX={cfg.logPV} logY={cfg.logPV} xy />}
      {cfg.kind === 'spl' && <Plot series={series} xLabel={cfg.splX === 'order' ? 'Engine order' : 'Frequency (Hz)'} yLabel={cfg.weighted ? 'SPL (dBA)' : 'SPL (dB)'} logX={cfg.splX === 'freq' || undefined} />}
      {cfg.kind === 'spl' && speeds.length === 0 && <div className="er-dim">Select a speed.</div>}
    </div>
  );
}

export function TracesView() {
  const results = useEngine((s) => s.results);
  const overlays = useEngine((s) => s.overlays);
  const [selected, setSelected] = useState<number[]>([]);
  const [useOverlays, setUseOverlays] = useState(false);
  const [graphs, setGraphs] = useState<GraphCfg[]>([
    { id: 1, kind: 'crank', specs: [{ a: 'cyl:1:pressure' }], logPV: false, cyl: 1, splX: 'freq', weighted: false },
    { id: 2, kind: 'crank', specs: [{ a: 'cyl:1:intakeLift' }, { a: 'cyl:1:exhaustLift' }], logPV: false, cyl: 1, splX: 'freq', weighted: false },
    { id: 3, kind: 'pv', specs: [], logPV: false, cyl: 1, splX: 'freq', weighted: false },
  ]);
  const speeds = useMemo(() => (results?.points ?? []).map((p) => p.speed).sort((a, b) => a - b), [results]);
  if (!results) return <div className="er-empty">No results yet. Run the simulation to see crank-angle traces.</div>;
  const sel = (selected.length ? selected : speeds.slice(0, 1)).filter((s) => speeds.includes(s));
  const points = sel.map((s) => results.points.find((p) => p.speed === s)).filter((p): p is TestPointResult => !!p);
  const overlayPoints = useOverlays ? overlays.flatMap((o) => (points[0] ? [nearestPoint(o, points[0].speed)].filter((p): p is TestPointResult => !!p) : [])) : [];
  return (
    <div className="er-view">
      <div className="er-bar">
        <span>Test points (select several to overlay):</span>
        {speeds.map((s) => (
          <label key={s} className="er-pill">
            <input type="checkbox" checked={sel.includes(s)} onChange={(e) => setSelected(e.target.checked ? [...sel, s] : sel.filter((x) => x !== s))} /> {Math.round(s)} rpm
          </label>
        ))}
        <label><input type="checkbox" checked={useOverlays} onChange={(e) => setUseOverlays(e.target.checked)} /> Overlay earlier results ({overlays.length})</label>
        <button onClick={() => setGraphs((g) => [...g, { id: Math.max(0, ...g.map((x) => x.id)) + 1, kind: 'crank', specs: [{ a: 'cyl:1:pressure' }], logPV: false, cyl: 1, splX: 'freq', weighted: false }])}>Add graph</button>
      </div>
      <div className="er-grid">
        {graphs.map((g) => (
          <TraceGraph key={g.id} cfg={g} points={points} speeds={sel} overlayPoints={overlayPoints}
            onChange={(c) => setGraphs((all) => all.map((x) => (x.id === c.id ? c : x)))}
            onRemove={() => setGraphs((all) => all.filter((x) => x.id !== g.id))} />
        ))}
      </div>
      {points[0]?.warnings.length ? <ul className="er-warn">{points[0].warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
    </div>
  );
}
