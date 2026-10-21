import { useEffect, useMemo, useRef, useState } from 'react';
import {
  autoscaleBars, barSum, COEFFICIENTS, coefficientBars, Corner, complianceCoefficients, defaultCompliance, limitsToCurrent, unityBars,
  type CoefficientBar, type CoefficientSet,
} from '@claudus/core';
import { useApp } from '../store';
import { Dlg, fmt } from './ComplianceDialogs';
import { NumberCell } from './PointTable';
import { unitText, useUnitSettings } from '../units';

const SHORT: Record<string, string> = { toe: 'Toe', camber: 'Camber', castor: 'Castor', kingpin: 'KPI', wcX: 'WC X', wcY: 'WC Y', wcZ: 'WC Z', tcpX: 'TCP X', tcpY: 'TCP Y' };
const ROW = (key: string) => COEFFICIENTS.find((c) => c.key === key) ?? COEFFICIENTS[0];

interface Menu { x: number; y: number; bar?: number }

/** The compliance coefficient charts: one per force set, with a limit, scale and weight for every bar. */
export function CoefficientsDialog({ onClose }: { onClose: () => void }) {
  useUnitSettings();
  const end = useApp((s) => s.end);
  const data = useApp((s) => s.model[s.end]);
  const compliance = useApp((s) => s.model.compliance);
  const templatesRev = useApp((s) => s.templatesRev);
  const edit = useApp((s) => s.editCompliance);
  const setDialog = useApp((s) => s.setDialog);
  const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [all, setAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const result = useMemo(() => {
    if (!data) return { error: `This model has no ${end} suspension.` };
    try {
      return { sets: complianceCoefficients(new Corner(data, end), compliance ?? defaultCompliance()) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [data, end, compliance, templatesRev]);
  useEffect(() => {
    if (!menu) return;
    const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener('mousedown', c);
    return () => window.removeEventListener('mousedown', c);
  }, [menu]);

  const sets: CoefficientSet[] = result.sets ?? [];
  const active = compliance?.activeSet ?? 0;
  const includeSpring = compliance?.settings.includeSpring ?? true;
  const barsOf = (set: number) => coefficientBars(compliance, set);
  /** Replace the bars of one set (or of every set). */
  const setBars = (set: number | 'all', fn: (bars: CoefficientBar[], s: CoefficientSet) => CoefficientBar[]) =>
    edit((c) => {
      c.bars ??= [];
      for (const s of sets) if (set === 'all' || set === s.set) c.bars[s.set] = fn(structuredClone(coefficientBars(c, s.set)), s);
    });
  const editBar = (set: number, k: number, patch: Partial<CoefficientBar>) =>
    setBars(set, (bars) => bars.map((b, i) => {
      if (i !== k) return b;
      const n = { ...b, ...patch };
      for (const key of ['limit', 'scale'] as const) if (n[key] === undefined) delete n[key];
      return n;
    }));
  // A bar with no scale of its own uses the largest value of that variable over the sets, so the bars compare between load cases.
  const autoScale = (key: string) => Math.max(1e-9, ...sets.map((s) => Math.abs(s.values[key as keyof typeof s.values] ?? 0)));
  const act = {
    makeActive: () => edit((c) => { c.activeSet = sel; }),
    toggleSet: () => edit((c) => { c.forceSets[sel].on = !c.forceSets[sel].on; }),
    allOn: () => edit((c) => { c.forceSets.forEach((f) => { f.on = true; }); }),
    spring: () => edit((c) => { c.settings.includeSpring = !c.settings.includeSpring; }),
    forces: () => setDialog('forces'),
    limits: () => setBars('all', (bars, s) => limitsToCurrent(bars, s.values)),
    autoscale: () => setBars('all', (bars, s) => autoscaleBars(bars, s.values)),
    unity: () => setBars('all', (bars) => unityBars(bars)),
    remove: (k: number) => setBars(sel, (bars) => bars.filter((_, i) => i !== k)),
    add: () => setBars(sel, (bars) => [...bars, { key: COEFFICIENTS.find((c) => !bars.some((b) => b.key === c.key))?.key ?? 'toe', weight: 1 }]),
    reset: () => edit((c) => { delete c.bars; }),
  };
  const run = (f: () => void) => () => { f(); setMenu(null); };
  const selOn = sets[sel]?.on ?? true;
  const H = 150, mid = 70, bw = 22;
  const mb = menu?.bar !== undefined ? barsOf(sel)[menu.bar] : undefined;

  return (
    <Dlg title={`Compliance coefficients (${end})`} onClose={onClose} wide>
      <p className="muted small">Compliant minus kinematic value at the static position, per force set. The red outline marks the active set (the one shown in 3D and the graphs). Right-click a bar or chart for more; the dashed line is a bar's limit.</p>
      <div className="row coefbar">
        <button onClick={act.makeActive} disabled={sel === active}>Make set {sel} active</button>
        <button onClick={act.toggleSet}>{selOn ? 'Turn set off' : 'Turn set on'}</button>
        <button onClick={act.allOn}>Turn all on</button>
        <label className="check"><input type="checkbox" checked={includeSpring} onChange={act.spring} /> Include spring force</label>
        <button onClick={() => setAll(true)}>Edit limits, scales and weights…</button>
      </div>
      {result.error && <p className="error">{result.error}</p>}
      <div className="coefgrid">
        {sets.map((s) => {
          const bars = barsOf(s.set);
          const W = Math.max(120, 16 + bars.length * 36);
          return (
            <div
              key={s.set}
              className={'coefchart' + (s.set === active ? ' active' : '') + (s.set === sel ? ' picked' : '') + (s.on ? '' : ' off')}
              data-set={s.set}
              onClick={() => setSel(s.set)}
              onContextMenu={(e) => { e.preventDefault(); setSel(s.set); setMenu({ x: e.clientX, y: e.clientY }); }}
            >
              <div className="coeftitle"><b>{s.set}</b> {s.label}{s.on ? '' : ' (off)'} <span className="muted small" data-testid={`coef-sum-${s.set}`}>sum {fmt(barSum(s.values, bars), 3)}</span></div>
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Coefficients for ${s.label}`}>
                <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--line)" />
                {bars.map((b, k) => {
                  const c = ROW(b.key);
                  const v = s.values[b.key as keyof typeof s.values] ?? 0;
                  const sc = b.scale ?? autoScale(b.key);
                  const clip = (n: number) => Math.max(-58, Math.min(58, n));
                  const h = clip((v / sc) * 50);
                  const x = 8 + k * 36;
                  return (
                    <g
                      key={k}
                      data-bar={k}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSel(s.set); setMenu({ x: e.clientX, y: e.clientY, bar: k }); }}
                    >
                      <title>{`${c.label}: ${fmt(v, 4, c.unit)} ${unitText(c.unit)}${b.limit !== undefined ? `, limit ${fmt(b.limit, 4, c.unit)}` : ''}, weight ${b.weight}`}</title>
                      <rect x={x - 4} width={bw + 8} y={0} height={H - 30} fill="transparent" />
                      <rect x={x} width={bw} y={h >= 0 ? mid - h : mid} height={Math.abs(h)} fill={v >= 0 ? 'var(--accent)' : '#f28e2b'} opacity={s.on ? 1 : 0.35} />
                      {b.limit !== undefined && <line className="barlimit" x1={x - 3} x2={x + bw + 3} y1={mid - clip((b.limit / sc) * 50)} y2={mid - clip((b.limit / sc) * 50)} stroke="#e15759" strokeDasharray="3 2" strokeWidth={1.5} />}
                      <text x={x + bw / 2} y={H - 22} textAnchor="middle" fontSize="9" fill="var(--muted)">{SHORT[b.key] ?? b.key}</text>
                      <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--text)">{Math.abs(v) < 0.0005 ? '0' : fmt(v, Math.abs(v) >= 10 ? 1 : 3, c.unit)}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>
      {menu && (
        <div className="menulist ctxmenu" ref={ref} style={{ position: 'fixed', left: menu.x, top: menu.y }} data-testid="coef-menu">
          {mb && menu.bar !== undefined && (
            <>
              <div className="menuhead">Bar {menu.bar + 1}</div>
              <div className="menurow">
                <span>Y variable</span>
                <select aria-label="Y variable" value={mb.key} onChange={(e) => editBar(sel, menu.bar!, { key: e.target.value })}>
                  {COEFFICIENTS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <BarFields bar={mb} onChange={(p) => editBar(sel, menu.bar!, p)} />
              <button onClick={run(() => act.remove(menu.bar!))}>Remove selected variable</button>
              <hr />
            </>
          )}
          <button onClick={run(act.add)}>Add extra variable</button>
          <button onClick={run(act.limits)}>Set all limit values to current</button>
          <button onClick={run(act.autoscale)}>Autoscale all visible lines</button>
          <button onClick={run(act.unity)}>Set all visible line scales to unity</button>
          <button onClick={run(() => setAll(true))}>Edit all line limits, scales and weights…</button>
          <button onClick={run(act.reset)}>Back to the default bars</button>
          <hr />
          <button disabled={sel === active} onClick={run(act.makeActive)}>Make force set {sel} the default</button>
          <button onClick={run(act.toggleSet)}>{selOn ? `Turn force set ${sel} off` : `Turn force set ${sel} on`}</button>
          <button onClick={run(act.allOn)}>Turn all force sets on</button>
          <button onClick={run(act.spring)}><span className="tick">{includeSpring ? '✓' : ''}</span>Include spring force in set</button>
          <button onClick={run(act.forces)}>Open external force edit</button>
        </div>
      )}
      {all && (
        <Dlg title={`Bars of force set ${sel}`} onClose={() => setAll(false)}>
          <table className="grid" data-testid="coef-bars-table">
            <thead><tr><th>Variable</th><th>Limit</th><th>Scale</th><th>Weight</th><th /></tr></thead>
            <tbody>
              {barsOf(sel).map((b, k) => (
                <tr key={k}>
                  <td>
                    <select aria-label={`Bar ${k + 1} variable`} value={b.key} onChange={(e) => editBar(sel, k, { key: e.target.value })}>
                      {COEFFICIENTS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </td>
                  <td colSpan={3}><BarFields bar={b} onChange={(p) => editBar(sel, k, p)} inline /></td>
                  <td><button aria-label={`Remove bar ${k + 1}`} onClick={() => act.remove(k)}>✕</button></td>
                </tr>
              ))}
              <tr><td colSpan={5}><button onClick={act.add}>Add variable</button></td></tr>
            </tbody>
          </table>
        </Dlg>
      )}
    </Dlg>
  );
}

/** Limit, scale and weight of one bar. An empty limit means none; an empty scale means automatic. */
function BarFields({ bar, onChange, inline }: { bar: CoefficientBar; onChange: (p: Partial<CoefficientBar>) => void; inline?: boolean }) {
  const field = (label: string, value: number | undefined, key: 'limit' | 'scale' | 'weight') => (
    <label className={inline ? 'barfield' : 'menurow'}>
      <span>{label}</span>
      <NumberCell value={value ?? NaN} digits={4} onCommit={(v) => onChange({ [key]: v })} />
      {key !== 'weight' && value !== undefined && <button title={key === 'limit' ? 'No limit' : 'Automatic scale'} onClick={() => onChange({ [key]: undefined })}>✕</button>}
    </label>
  );
  return (
    <div className={inline ? 'row' : undefined}>
      {field('Limit', bar.limit, 'limit')}
      {field('Scale', bar.scale, 'scale')}
      {field('Weight', bar.weight, 'weight')}
    </div>
  );
}
