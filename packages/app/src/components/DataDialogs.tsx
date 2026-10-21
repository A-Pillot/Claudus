import { useState } from 'react';
import {
  BODY_TYPES, BODY_USER, DatParseError, dataPoints, emptyBody, formatPolys, getTemplate, hasTemplate, internalBodyLines, parsePolys, parseStl, readDat, writeDat,
  type EndCompliance, type Model, type Vec3,
} from '@claudus/core';
import { useApp } from '../store';
import { editModel, useDataUi } from '../dataUi';
import { useViewCtl } from '../viewCtl';
import { templatesForModel } from '../templates';
import { Dlg, TextCell } from './ComplianceDialogs';
import { NumberCell } from './PointTable';
import { useUnitSettings } from '../units';

const close = () => useDataUi.getState().setDialog(null);

/** Data / Titles: free text lines that are saved in the file. */
export function TitlesDialog() {
  const titles = useApp((s) => s.model.titles);
  const set = (fn: (t: string[]) => void) => editModel((m) => { fn(m.titles); });
  return (
    <Dlg title="Titles" onClose={close}>
      <p className="muted small">Text labels saved in the data file. They do not affect the analysis.</p>
      {titles.map((t, i) => (
        <div className="row" key={i}>
          <TextCell className="grow" value={t} onCommit={(v) => set((l) => { l[i] = v; })} />
          <button aria-label={`Remove title ${i + 1}`} onClick={() => set((l) => { l.splice(i, 1); })}>✕</button>
        </div>
      ))}
      <div className="row"><button onClick={() => set((l) => { l.push(''); })}>Add title</button></div>
    </Dlg>
  );
}

/** Data / Tyre Sizes: rolling radius and width for each end, and the vertical stiffness in compliant mode. */
export function TyreDialog({ onClose = close, showRate }: { onClose?: () => void; showRate?: boolean }) {
  useUnitSettings();
  const model = useApp((s) => s.model);
  const compliant = useApp((s) => s.compliant) || !!showRate;
  const edit = useApp((s) => s.editCompliance);
  const ends = (['front', 'rear'] as const).filter((e) => model[e]);
  const widths = model.tyreWidths;
  const setWidth = (i: number, v: number) => editModel((m) => { const w = [...m.tyreWidths]; while (w.length < 4) w.push(150); w[i] = Math.max(1, v); m.tyreWidths = w; });
  const rate = (end: 'front' | 'rear') => model.compliance?.[end]?.tyreRate ?? 400;
  return (
    <Dlg title="Tyre sizes" onClose={onClose}>
      <p className="muted small">Width is for the picture only and does not change results.</p>
      <table className="grid" data-testid="tyre-table">
        <thead><tr><th /><th>Rolling radius (mm)</th><th>Width left (mm)</th><th>Width right (mm)</th>{compliant && <th>Vertical stiffness (N/mm)</th>}</tr></thead>
        <tbody>
          {ends.map((e) => {
            const o = e === 'front' ? 0 : 2;
            return (
              <tr key={e}>
                <td>{e === 'front' ? 'Front' : 'Rear'}</td>
                <td><NumberCell unit="mm" value={model[e]!.rollingRadius} onCommit={(v) => v > 0 && editModel((m) => { m[e]!.rollingRadius = v; })} /></td>
                <td><NumberCell unit="mm" value={widths[o] ?? 150} onCommit={(v) => setWidth(o, v)} /></td>
                <td><NumberCell unit="mm" value={widths[o + 1] ?? 150} onCommit={(v) => setWidth(o + 1, v)} /></td>
                {compliant && <td><NumberCell value={rate(e)} onCommit={(v) => edit((c) => { (c[e] ??= { ...emptyEnd() }).tyreRate = Math.max(0, v); })} /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!compliant && <p className="muted small">The tyre vertical stiffness is listed here in compliant mode (Solve / 3D Compliance).</p>}
    </Dlg>
  );
}

const emptyEnd = (): EndCompliance => ({ springs: [{ rate: 41.5, freeLength: 300, fittedLength: 246.5 }, { rate: 41.5, freeLength: 300, fittedLength: 246.5 }], dampers: [0.4, 0.4], rollBarRate: 2e6, tyreRate: 400, bushes: [] });

/** Data / Compliance Data / Damper Properties: all four damper rates, front and rear. */
export function DamperDialog({ onClose = close }: { onClose?: () => void }) {
  useUnitSettings();
  const model = useApp((s) => s.model);
  const edit = useApp((s) => s.editCompliance);
  const has = (end: 'front' | 'rear', k: number) => {
    const s = model[end];
    if (!s || !hasTemplate(s.templateSlot)) return false;
    const gens = k === 0 ? [4, 5] : [18, 19];
    return getTemplate(s.templateSlot).points.some((p) => gens.includes(p.gen1) || gens.includes(p.gen2));
  };
  const rate = (end: 'front' | 'rear', k: number) => model.compliance?.[end]?.dampers[k] ?? 0.4;
  return (
    <Dlg title="Damper properties" onClose={onClose}>
      <p className="muted small">
        Linear damping only. Damper 1 is the single damper of a corner model; damper 2 is the second damper of a corner or the second corner of a full axle.
        Bush damping comes from the loss angle in the general compliance data.
      </p>
      <table className="grid" data-testid="damper-table">
        <thead><tr><th /><th>Damper 1 rate (N.s/mm)</th><th>Damper 2 rate (N.s/mm)</th></tr></thead>
        <tbody>
          {(['front', 'rear'] as const).map((e) => (
            <tr key={e}>
              <td>{e === 'front' ? 'Front' : 'Rear'}{model[e] ? '' : ' (no suspension)'}</td>
              {[0, 1].map((k) => (
                <td key={k} title={has(e, k) ? '' : 'Not in this end’s template'}>
                  <NumberCell
                    digits={4}
                    value={rate(e, k)}
                    onCommit={(v) => v >= 0 && edit((c) => { (c[e] ??= emptyEnd()).dampers[k] = v; })}
                  />
                  {model[e] && !has(e, k) && <span className="muted small">none in template</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row"><button onClick={() => edit((c) => { for (const e of ['front', 'rear'] as const) (c[e] ??= emptyEnd()).dampers = [0.4, 0.4]; })}>Reset to default (0.4)</button></div>
    </Dlg>
  );
}

/** Data / Body Type and Edit User Body Data. */
export function BodyDialog() {
  const body = useApp((s) => s.model.body) ?? emptyBody();
  const show = useViewCtl((s) => s.showBodyGraphics);
  const setType = (type: number) => editModel((m) => { m.body = { ...(m.body ?? emptyBody()), type }; });
  return (
    <Dlg title="Body type" onClose={close}>
      <div className="row">
        <label className="vlabel">Body</label>
        <select aria-label="Body type" value={body.type} onChange={(e) => setType(Number(e.target.value))}>
          {BODY_TYPES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </div>
      <label className="row">
        <input type="checkbox" checked={show} onChange={(e) => useViewCtl.getState().set({ showBodyGraphics: e.target.checked })} /> Show the body in the 3D view
      </label>
      <div className="row">
        <button disabled={body.type !== BODY_USER} onClick={() => useDataUi.getState().setDialog('userBody')}>Edit user body data…</button>
        <span className="muted small">Enabled for the user defined type.</span>
      </div>
    </Dlg>
  );
}

export function UserBodyDialog() {
  const body = useApp((s) => s.model.body) ?? emptyBody();
  const [lines, setLines] = useState(() => formatPolys(body.lines));
  const [facets, setFacets] = useState(() => formatPolys(body.facets));
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const apply = () => {
    try {
      const l = parsePolys(lines, 2);
      const f = parsePolys(facets, 3);
      if (f.some((q) => q.length > 4)) throw new Error('Facets have three or four corners.');
      editModel((m) => { m.body = { type: BODY_USER, lines: l, facets: f }; });
      setError(null);
      setInfo(`Applied ${l.length} lines and ${f.length} facets.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const fromType = () => {
    const src = body.type === BODY_USER ? [] : internalBodyLines(body.type);
    setLines((l) => (formatPolys(src) || l));
    setInfo('Copied the outline of the current built-in type into the lines. Choose "User defined" and Apply to keep it.');
  };
  const importStl = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const tris = parseStl(new Uint8Array(await f.arrayBuffer()));
        setFacets(formatPolys(tris));
        setError(null);
        setInfo(`Read ${tris.length} triangles from ${f.name}. Coordinates are taken as mm in car axes (x back from the front axle, y across, z up from the ground).`);
      } catch (e) {
        setError(`Could not read ${f.name}: ${(e as Error).message}`);
      }
    };
    input.click();
  };

  return (
    <Dlg title="User body data" onClose={close} wide>
      <p className="muted small">Car axes in mm: x back from the front axle, y across the car, z up from the ground. One line or facet per row, points as "x y z" separated by commas.</p>
      <label>Lines</label>
      <textarea aria-label="Body lines" className="bodytext" rows={7} value={lines} onChange={(e) => setLines(e.target.value)} spellCheck={false} />
      <label>Facets (3 or 4 corners)</label>
      <textarea aria-label="Body facets" className="bodytext" rows={7} value={facets} onChange={(e) => setFacets(e.target.value)} spellCheck={false} />
      {error && <p className="bad">{error}</p>}
      {info && !error && <p className="ok">{info}</p>}
      <div className="row">
        <button onClick={importStl}>Import STL…</button>
        <button onClick={fromType} disabled={body.type === BODY_USER || body.type === 0}>Start from built-in outline</button>
        <span className="grow" />
        <button className="primary" onClick={apply}>Apply</button>
      </div>
    </Dlg>
  );
}

/** File / Text Edit: the raw data file, applied by reading it again. */
export function TextEditDialog() {
  const model = useApp((s) => s.model);
  const fileName = useApp((s) => s.fileName);
  const setModel = useApp((s) => s.setModel);
  const [text, setText] = useState(() => writeDat({ ...model, templates: templatesForModel(model) }));
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    try {
      const m = readDat(text);
      setModel(m, fileName);
      useApp.setState({ dirty: true });
      close();
    } catch (e) {
      setError(e instanceof DatParseError ? e.message : `Could not read the data: ${(e as Error).message}`);
    }
  };
  return (
    <Dlg title={`Text edit: ${fileName}`} onClose={close} wide>
      <p className="muted small">Edit the data file text. Apply reads it again and replaces the model.</p>
      <textarea aria-label="Data file text" className="bodytext filetext" rows={24} value={text} onChange={(e) => { setText(e.target.value); setError(null); }} spellCheck={false} />
      {error && <p className="bad" data-testid="textedit-error">{error}</p>}
      <div className="row"><span className="grow" /><button className="primary" onClick={apply}>Apply</button></div>
    </Dlg>
  );
}

// ---- Model Properties tree ----------------------------------------------------------------------------

type Leaf = { label: string; value?: number; unit?: string; digits?: number; set?: (v: number) => void; text?: string; setText?: (s: string) => void; note?: string };
type TreeNode = Leaf & { children?: TreeNode[] };

const PARAM_FIELDS: [keyof Model['params'], string, string | undefined][] = [
  ['bumpTravel', 'Bump travel', 'mm'], ['reboundTravel', 'Rebound travel', 'mm'], ['bumpIncrement', 'Bump increment', 'mm'],
  ['rollAngle', 'Roll angle', 'deg'], ['rollIncrement', 'Roll increment', 'deg'], ['steerTravel', 'Steer travel', 'mm'], ['steerIncrement', 'Steer increment', 'mm'],
  ['wheelbase', 'Wheelbase', 'mm'], ['cogHeight', 'C of G height', 'mm'], ['brakeFrontPct', 'Brake split front (%)', undefined],
  ['weightFrontPct', 'Weight on front (%)', undefined], ['driveFrontPct', 'Drive split front (%)', undefined],
];

export function modelTree(m: Model): TreeNode[] {
  const nodes: TreeNode[] = [];
  nodes.push({ label: 'Titles', children: m.titles.length ? m.titles.map((t, i) => ({ label: `Title ${i + 1}`, text: t, setText: (s: string) => editModel((x) => { x.titles[i] = s; }) })) : [{ label: '(none)' }] });
  nodes.push({
    label: 'Parameters',
    children: PARAM_FIELDS.map(([k, label, unit]) => ({ label, unit, value: m.params[k] as number, set: (v: number) => editModel((x) => { (x.params[k] as number) = v; }) })),
  });
  for (const end of ['front', 'rear'] as const) {
    const s = m[end];
    if (!s) continue;
    const t = hasTemplate(s.templateSlot) ? getTemplate(s.templateSlot) : undefined;
    const dp = t ? dataPoints(t) : [];
    nodes.push({
      label: `${end === 'front' ? 'Front' : 'Rear'} suspension${t ? `: ${t.label}` : ''}`,
      children: [
        { label: 'Template number', value: s.templateSlot, digits: 0 },
        { label: 'Rolling radius', unit: 'mm', value: s.rollingRadius, set: (v: number) => v > 0 && editModel((x) => { x[end]!.rollingRadius = v; }) },
        {
          label: 'Hard points',
          children: s.points.map((p, i) => ({
            label: `${dp[i]?.no ?? i + 1} ${dp[i]?.label ?? ''}`,
            children: ['X', 'Y', 'Z'].map((a, k) => ({ label: a, unit: 'mm', value: p[k], set: (v: number) => editModel((x) => { x[end]!.points[i] = p.map((q, j) => (j === k ? v : q)) as Vec3; }) })),
          })),
        },
      ],
    });
  }
  nodes.push({
    label: 'Tyres',
    children: ['Front left width', 'Front right width', 'Rear left width', 'Rear right width'].map((label, i) => ({
      label, unit: 'mm', value: m.tyreWidths[i] ?? 150,
      set: (v: number) => editModel((x) => { const w = [...x.tyreWidths]; while (w.length < 4) w.push(150); w[i] = Math.max(1, v); x.tyreWidths = w; }),
    })),
  });
  nodes.push({ label: 'Roll solution', value: m.rollSolution, digits: 0, set: (v: number) => editModel((x) => { x.rollSolution = Math.round(v); }) });
  nodes.push({ label: 'Tolerances', children: m.tolerances.map((v, i) => ({ label: `Tolerance ${i + 1}`, value: v, digits: 10, set: (n: number) => editModel((x) => { x.tolerances[i] = n; }) })) });
  nodes.push({ label: 'Groups', children: m.groups.length ? m.groups.map((g) => ({ label: g.label, note: `${g.members.length} points` })) : [{ label: '(none)' }] });
  if (m.compliance) {
    const c = m.compliance;
    nodes.push({
      label: 'Compliance',
      children: (['front', 'rear'] as const).filter((e) => c[e]).map((e) => ({
        label: e === 'front' ? 'Front' : 'Rear',
        children: [
          { label: 'Bushes', note: String(c[e]!.bushes.length) },
          ...[0, 1].map((k) => ({ label: `Spring ${k + 1} rate (N/mm)`, value: c[e]!.springs[k].rate, set: (v: number) => useApp.getState().editCompliance((x) => { x[e]!.springs[k].rate = v; }) })),
          ...[0, 1].map((k) => ({ label: `Damper ${k + 1} rate (N.s/mm)`, value: c[e]!.dampers[k], set: (v: number) => useApp.getState().editCompliance((x) => { x[e]!.dampers[k] = v; }) })),
          { label: 'Tyre stiffness (N/mm)', value: c[e]!.tyreRate, set: (v: number) => useApp.getState().editCompliance((x) => { x[e]!.tyreRate = v; }) },
          { label: 'Roll bar rate (N.mm/deg)', value: c[e]!.rollBarRate, set: (v: number) => useApp.getState().editCompliance((x) => { x[e]!.rollBarRate = v; }) },
        ],
      })),
    });
  }
  nodes.push({ label: 'Body', note: BODY_TYPES[m.body?.type ?? 0] });
  return nodes;
}

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  if (node.children)
    return (
      <details>
        <summary>{node.label}</summary>
        <div className="treekids">{node.children.map((c, i) => <TreeItem key={i} node={c} depth={depth + 1} />)}</div>
      </details>
    );
  return (
    <div className="treeleaf">
      <span className="treelabel">{node.label}</span>
      {node.setText ? <TextCell value={node.text ?? ''} onCommit={node.setText} />
        : node.value !== undefined ? (node.set ? <NumberCell unit={node.unit} digits={node.digits ?? 3} value={node.value} onCommit={node.set} /> : <span>{node.value}</span>)
        : node.note ? <span className="muted">{node.note}</span> : null}
    </div>
  );
}

/** Data / Model Properties: every data field in an expandable tree, edited in place. */
export function PropertiesDialog() {
  useUnitSettings();
  const model = useApp((s) => s.model);
  return (
    <Dlg title="Model properties" onClose={close}>
      <div className="tree" data-testid="model-tree">{modelTree(model).map((n, i) => <TreeItem key={i} node={n} depth={0} />)}</div>
    </Dlg>
  );
}
