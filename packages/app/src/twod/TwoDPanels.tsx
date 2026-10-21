import type { FreeMode, Model2D, P2 } from '@claudus/core';
import { NumberCell } from '../components/PointTable';
import { useTwoD, type Point2DId } from './store2d';
import type { Solution2D } from './useSolution';

const FREE_FOR: Partial<Record<Point2DId, FreeMode>> = { lowerInner: 'lowerInner', upperInner: 'upperInner', lowerOuter: 'lowerOuter', upperOuter: 'upperOuter' };

/** The hard points of the corner, with the Y and Z of each. Y of an outer joint follows from the kingpin data. */
export function PointTable2D({ sol }: { sol: Solution2D }) {
  const m = useTwoD((s) => s.model);
  const freeMode = useTwoD((s) => s.freeMode);
  const selected = useTwoD((s) => s.selected);
  const select = useTwoD((s) => s.select);
  const edit = useTwoD((s) => s.edit);
  const g = sol.geo;
  const strut = m.type === 2;

  interface Row { id: Point2DId; no: number; label: string; at: P2; editY?: (v: number) => void; editZ?: (v: number) => void }
  const rows: Row[] = [
    { id: 'lowerInner', no: 1, label: 'Lower inner ball joint', at: g.lowerInner, editY: (v) => edit({ lowerInner: [v, m.lowerInner[1]] }), editZ: (v) => edit({ lowerInner: [m.lowerInner[0], v] }) },
    ...(strut ? [] : [{ id: 'upperInner' as const, no: 2, label: 'Upper inner ball joint', at: g.upperInner, editY: (v: number) => edit({ upperInner: [v, m.upperInner[1]] }), editZ: (v: number) => edit({ upperInner: [m.upperInner[0], v] }) }]),
    { id: 'lowerOuter', no: 3, label: 'Lower outer ball joint', at: g.lowerOuter, editZ: (v) => edit({ lowerOuterZ: v }) },
    { id: 'upperOuter', no: 4, label: strut ? 'Strut top' : 'Upper outer ball joint', at: g.upperOuter, editZ: (v) => edit({ upperOuterZ: v }) },
    { id: 'ground', no: 5, label: 'Kingpin axis at ground', at: g.ground, editY: (v) => edit({ kingpinOffset: m.track / 2 - v }) },
    { id: 'contact', no: 6, label: 'Tyre contact patch', at: g.contact, editY: (v) => edit({ track: 2 * v }) },
  ];

  return (
    <div className="points">
      <div className="tplname">2D {strut ? 'Macpherson strut' : 'double wishbone'}, right-hand corner</div>
      <table>
        <thead><tr><th>No</th><th>Point</th><th>Y</th><th>Z</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const free = FREE_FOR[r.id] === freeMode && freeMode !== 'fixAll';
            return (
              <tr key={r.id} className={selected === r.id ? 'sel' : ''} onClick={() => select(r.id)}>
                <td className="no">{r.no}</td>
                <td className="label" title={r.label}>{r.label}{free && <span className="tag">free</span>}</td>
                <td>{r.editY && !free ? <NumberCell value={r.at[0]} onCommit={r.editY} /> : <span className="ro">{r.at[0].toFixed(3)}</span>}</td>
                <td>{r.editZ && !free ? <NumberCell value={r.at[1]} onCommit={r.editZ} /> : <span className="ro">{r.at[1].toFixed(3)}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small pad">Outer joint Y values follow from the track, kingpin angle and offset (set in General data) and are not edited directly. Dragging an outer joint changes its height and the kingpin angle.</p>
    </div>
  );
}

interface Field { key: keyof Model2D; label: string; unit: string; strutOnly?: boolean }

const fields: { title: string; items: Field[] }[] = [
  {
    title: 'Geometry',
    items: [
      { key: 'track', label: 'Vehicle track', unit: 'mm' },
      { key: 'kingpinAngle', label: 'Kingpin angle', unit: 'deg' },
      { key: 'kingpinOffset', label: 'Kingpin offset at ground', unit: 'mm' },
      { key: 'damperAngle', label: 'Damper angle', unit: 'deg', strutOnly: true },
    ],
  },
  {
    title: 'Targets',
    items: [
      { key: 'camberBump', label: 'Camber change in bump', unit: 'deg/mm' },
      { key: 'camberRebound', label: 'Camber change in rebound', unit: 'deg/mm' },
      { key: 'camberRoll', label: 'Camber change in roll', unit: 'deg/deg' },
      { key: 'rcStatic', label: 'Static roll centre height', unit: 'mm' },
      { key: 'rcBump', label: 'RC height change in bump', unit: 'mm/mm' },
      { key: 'rcRebound', label: 'RC height change in rebound', unit: 'mm/mm' },
      { key: 'rcRoll', label: 'RC height change in roll', unit: 'mm/deg' },
      { key: 'rcLateralRoll', label: 'RC lateral change in roll', unit: 'mm/deg' },
    ],
  },
];

export function Params2D() {
  const m = useTwoD((s) => s.model);
  const sweep = useTwoD((s) => s.sweep);
  const edit = useTwoD((s) => s.edit);
  const setSweep = useTwoD((s) => s.setSweep);
  const steps = (v: number) => Math.max(1, Math.min(40, Math.round(v)));
  return (
    <div className="params">
      <table>
        <tbody>
          {fields.map((grp) => [
            <tr key={grp.title}><th colSpan={3} className="grp">{grp.title}</th></tr>,
            ...grp.items.filter((f) => !f.strutOnly || m.type === 2).map((f) => (
              <tr key={f.key}>
                <td>{f.label}</td>
                <td><NumberCell value={m[f.key] as number} digits={4} onCommit={(v) => edit({ [f.key]: v })} /></td>
                <td className="unit">{f.unit}</td>
              </tr>
            )),
          ])}
          <tr><th colSpan={3} className="grp">Articulation</th></tr>
          <tr><td>Bump travel</td><td><NumberCell value={sweep.bumpTravel} onCommit={(v) => v > 0 && setSweep({ bumpTravel: v })} /></td><td className="unit">mm</td></tr>
          <tr><td>Bump solution steps</td><td><NumberCell value={sweep.bumpSteps} onCommit={(v) => setSweep({ bumpSteps: steps(v) })} /></td><td className="unit" /></tr>
          <tr><td>Rebound travel</td><td><NumberCell value={sweep.reboundTravel} onCommit={(v) => v > 0 && setSweep({ reboundTravel: v })} /></td><td className="unit">mm</td></tr>
          <tr><td>Rebound solution steps</td><td><NumberCell value={sweep.reboundSteps} onCommit={(v) => setSweep({ reboundSteps: steps(v) })} /></td><td className="unit" /></tr>
          <tr><td>Roll travel</td><td><NumberCell value={m.rollTravel} onCommit={(v) => v > 0 && edit({ rollTravel: v })} /></td><td className="unit">deg</td></tr>
          <tr><td>Roll solution steps</td><td><NumberCell value={sweep.rollSteps} onCommit={(v) => setSweep({ rollSteps: steps(v) })} /></td><td className="unit" /></tr>
        </tbody>
      </table>
      <p className="muted small pad">Bump and roll ranges and step counts are not stored in the 2D data file (only the roll travel is).</p>
    </div>
  );
}
