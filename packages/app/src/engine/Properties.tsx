// Properties panel: data editors for the selected network element.
import type { EngineModel, Pipe, Valve } from '@claudus/engine';
import { getElement, KIND_NAMES, parseKey, refKey } from './elements';
import { NumField, Row, TextField } from './fields';
import { useEngine } from './store';

interface Spec { key: string; label: string; unit?: string; step?: number }

const SPECS: Record<string, Spec[]> = {
  cylinder: [
    { key: 'bore', label: 'Bore', unit: 'mm' }, { key: 'stroke', label: 'Stroke', unit: 'mm' }, { key: 'conRod', label: 'Con-rod length', unit: 'mm' },
    { key: 'pinOffset', label: 'Pin offset', unit: 'mm' }, { key: 'compressionRatio', label: 'Compression ratio', step: 0.1 }, { key: 'firingAngle', label: 'Firing angle', unit: 'deg' },
  ],
  pipe: [
    { key: 'length', label: 'Length', unit: 'mm' }, { key: 'meshLength', label: 'Mesh length', unit: 'mm' }, { key: 'wallTemperature', label: 'Wall temperature', unit: 'K' },
    { key: 'frictionFactor', label: 'Friction factor', step: 0.001 }, { key: 'bendAngle', label: 'Bend angle', unit: 'deg' },
  ],
  plenum: [{ key: 'volume', label: 'Volume', unit: 'cc' }, { key: 'wallTemperature', label: 'Wall temperature', unit: 'K' }],
  throttle: [{ key: 'diameter', label: 'Diameter', unit: 'mm' }, { key: 'position', label: 'Position', unit: 'deg or fraction' }, { key: 'cd', label: 'Discharge coeff.', step: 0.01 }],
  inlet: [{ key: 'pressure', label: 'Pressure', unit: 'bar', step: 0.01 }, { key: 'temperature', label: 'Temperature', unit: 'K' }],
  exit: [{ key: 'pressure', label: 'Pressure', unit: 'bar', step: 0.01 }, { key: 'temperature', label: 'Temperature', unit: 'K' }],
  valve: [
    { key: 'openAngle', label: 'Opening angle', unit: 'deg' }, { key: 'closeAngle', label: 'Closing angle', unit: 'deg' },
    { key: 'maxLift', label: 'Maximum lift', unit: 'mm', step: 0.1 }, { key: 'diameter', label: 'Seat diameter', unit: 'mm' },
  ],
  port: [{ key: 'diameter', label: 'Diameter', unit: 'mm' }, { key: 'length', label: 'Length', unit: 'mm' }],
};

export function Properties() {
  const model = useEngine((s) => s.model);
  const selection = useEngine((s) => s.selection);
  const edit = useEngine((s) => s.edit);
  if (!model) return null;
  if (selection.length === 0) return <div className="muted pad">Select an element on the network to edit its data.</div>;
  if (selection.length > 1) return <div className="muted pad">{selection.length} elements selected.</div>;
  const key = selection[0];
  const { kind, id } = parseKey(key);
  const el = getElement(model, key);
  const connections = model.connections.map((c, i) => ({ c, i })).filter(({ c }) => [c.a, c.b, ...c.via].some((r) => refKey(r) === key));

  const set = (field: string, v: unknown) =>
    edit((m) => {
      const e = getElement(m, key);
      if (e) (e as Record<string, unknown>)[field] = v;
    }, { key: `${key}.${field}` });

  if (!el) {
    return (
      <div className="props">
        <h3>{KIND_NAMES[kind]} {id}</h3>
        <p className="muted small">This element has no data of its own.</p>
        <Conns model={model} items={connections} />
      </div>
    );
  }
  return (
    <div className="props">
      <h3>{KIND_NAMES[kind]} {id}</h3>
      <Row label="Label"><TextField value={String(el.label ?? '')} onChange={(v) => set('label', v)} /></Row>
      {(SPECS[kind] ?? []).map((s) => (
        <Row key={s.key} label={s.label} unit={s.unit}><NumField value={Number(el[s.key] ?? 0)} step={s.step} onChange={(v) => set(s.key, v)} /></Row>
      ))}
      {kind === 'valve' && (
        <Row label="Type">
          <select value={(el as unknown as Valve).kind} onChange={(e) => set('kind', e.target.value)}><option value="intake">Intake</option><option value="exhaust">Exhaust</option></select>
        </Row>
      )}
      {kind === 'port' && (
        <Row label="Type">
          <select value={String(el.kind)} onChange={(e) => set('kind', e.target.value)}><option value="intake">Intake</option><option value="exhaust">Exhaust</option></select>
        </Row>
      )}
      {kind === 'throttle' && (
        <Row label="Type">
          <select value={String(el.kind)} onChange={(e) => set('kind', e.target.value)}><option value="butterfly">Butterfly (angle)</option><option value="area">Open area fraction</option></select>
        </Row>
      )}
      {kind === 'pipe' && <Stations pipe={el as unknown as Pipe} onChange={(st) => set('stations', st)} />}
      <Conns model={model} items={connections} />
    </div>
  );
}

function Stations({ pipe, onChange }: { pipe: Pipe; onChange: (s: Pipe['stations']) => void }) {
  const upd = (i: number, f: 'x' | 'd', v: number) => onChange(pipe.stations.map((s, j) => (j === i ? { ...s, [f]: v } : s)));
  return (
    <div className="stations">
      <h4>Diameter stations</h4>
      <table className="etable">
        <thead><tr><th>#</th><th>x (mm)</th><th>d (mm)</th><th /></tr></thead>
        <tbody>
          {pipe.stations.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td><NumField value={s.x} onChange={(v) => upd(i, 'x', v)} width={70} /></td>
              <td><NumField value={s.d} onChange={(v) => upd(i, 'd', v)} width={70} /></td>
              <td><button className="mini" disabled={pipe.stations.length <= 2} onClick={() => onChange(pipe.stations.filter((_, j) => j !== i))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mini" onClick={() => { const last = pipe.stations[pipe.stations.length - 1]; onChange([...pipe.stations, { x: last.x + 50, d: last.d }]); }}>Add station</button>
    </div>
  );
}

function Conns({ model, items }: { model: EngineModel; items: { c: EngineModel['connections'][number]; i: number }[] }) {
  const edit = useEngine((s) => s.edit);
  if (!items.length) return null;
  const name = (r: { kind: string; id: number; end?: number }) => `${r.kind} ${r.id}${r.end ? ` end ${r.end}` : ''}`;
  void model;
  return (
    <div className="conns">
      <h4>Connections</h4>
      {items.map(({ c, i }) => (
        <div key={i} className="conn-row">
          <span>{name(c.a)} → {name(c.b)}{c.via.length ? ` via ${c.via.map(name).join(', ')}` : ''}</span>
          <button className="mini" onClick={() => edit((m) => { m.connections.splice(i, 1); })}>Remove</button>
        </div>
      ))}
    </div>
  );
}
