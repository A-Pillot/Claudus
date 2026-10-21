import { fmtUnit, unitText, useUnitSettings } from '../units';
import { elementShape, isMeasure, optionOf, type AxleState, type Corner, type WheelGeometry } from '@claudus/core';

const rows: { label: string; key: keyof WheelGeometry; unit: string; d: number }[] = [
  { label: 'Camber', key: 'camber', unit: '°', d: 3 },
  { label: 'Toe (SAE, +in)', key: 'toeSae', unit: '°', d: 3 },
  { label: 'Castor', key: 'castor', unit: '°', d: 3 },
  { label: 'Kingpin', key: 'kingpin', unit: '°', d: 3 },
  { label: 'Castor trail', key: 'castorTrail', unit: 'mm', d: 2 },
  { label: 'Mechanical trail', key: 'mechanicalTrail', unit: 'mm', d: 2 },
  { label: 'KP offset at ground', key: 'kingpinOffsetGround', unit: 'mm', d: 2 },
  { label: 'KP offset at wheel', key: 'kingpinOffsetWheel', unit: 'mm', d: 2 },
];

const fmt = (v: number, d: number, unit: string) => fmtUnit(unit, v, d);

export function Readouts({ corner, state }: { corner: Corner; state: AxleState }) {
  useUnitSettings();
  const L = state.geometryLeft;
  const R = state.geometryRight;
  const rc = state.rollCentre;
  const damper = corner.damperLength(state.right.points);
  const spring = corner.springLength(state.right.points);
  const at = (no: number) => {
    const i = corner.mech.index.get(no);
    return i === undefined ? undefined : state.right.points[i];
  };
  // Live values of the distance, components and angle elements.
  const measures = corner.template.graphics.flatMap((g, i) => {
    const s = isMeasure(g) ? elementShape(g, at) : undefined;
    return s?.type === 'measure' ? [{ i, g, s }] : [];
  });
  return (
    <div className="readouts">
      <table>
        <thead>
          <tr><th /><th>Left</th><th>Right</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="num">{fmt(L[r.key] as number, r.d, r.unit)}</td>
              <td className="num">{fmt(R[r.key] as number, r.d, r.unit)}</td>
              <td className="unit">{unitText(r.unit)}</td>
            </tr>
          ))}
          <tr>
            <td>Contact point Y</td>
            <td className="num">{fmt(-L.tcp[1], 1, 'mm')}</td>
            <td className="num">{fmt(R.tcp[1], 1, 'mm')}</td>
            <td className="unit">{unitText('mm')}</td>
          </tr>
        </tbody>
      </table>
      <table>
        <tbody>
          <tr><td>Roll centre height (to ground)</td><td className="num">{fmt(rc[2] - state.right.groundZ, 2, 'mm')}</td><td className="unit">{unitText('mm')}</td></tr>
          <tr><td>Roll centre lateral (Y)</td><td className="num">{fmt(rc[1], 2, 'mm')}</td><td className="unit">{unitText('mm')}</td></tr>
          <tr><td>Damper length (right)</td><td className="num">{fmt(damper, 2, 'mm')}</td><td className="unit">{unitText('mm')}</td></tr>
          <tr><td>Spring length (right)</td><td className="num">{fmt(spring, 2, 'mm')}</td><td className="unit">{unitText('mm')}</td></tr>
          <tr><td>Track</td><td className="num">{fmt(R.tcp[1] + L.tcp[1], 1, 'mm')}</td><td className="unit">{unitText('mm')}</td></tr>
        </tbody>
      </table>
      {measures.length > 0 && (
        <table className="measures">
          <thead><tr><th colSpan={3}>Measurements</th></tr></thead>
          <tbody>
            {measures.map(({ i, g, s }) => (
              <tr key={i}>
                <td>{optionOf(g)?.name ?? g.kind} {g.points.join('-')}</td>
                <td className="num">
                  {fmt(s.value, s.kind === 'angle' ? 3 : 2, s.kind === 'angle' ? 'deg' : 'mm')}
                  {s.comps && <div className="comps">{s.comps.map((v) => fmt(v, 2, 'mm')).join(' / ')}</div>}
                </td>
                <td className="unit">{unitText(s.kind === 'angle' ? '°' : 'mm')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
