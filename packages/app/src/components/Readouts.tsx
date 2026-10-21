import type { AxleState, Corner, WheelGeometry } from '@claudus/core';

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

const fmt = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '–');

export function Readouts({ corner, state }: { corner: Corner; state: AxleState }) {
  const L = state.geometryLeft;
  const R = state.geometryRight;
  const rc = state.rollCentre;
  const damper = corner.damperLength(state.right.points);
  const spring = corner.springLength(state.right.points);
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
              <td className="num">{fmt(L[r.key] as number, r.d)}</td>
              <td className="num">{fmt(R[r.key] as number, r.d)}</td>
              <td className="unit">{r.unit}</td>
            </tr>
          ))}
          <tr>
            <td>Contact point Y</td>
            <td className="num">{fmt(-L.tcp[1], 1)}</td>
            <td className="num">{fmt(R.tcp[1], 1)}</td>
            <td className="unit">mm</td>
          </tr>
        </tbody>
      </table>
      <table>
        <tbody>
          <tr><td>Roll centre height (to ground)</td><td className="num">{fmt(rc[2] - state.right.groundZ, 2)}</td><td className="unit">mm</td></tr>
          <tr><td>Roll centre lateral (Y)</td><td className="num">{fmt(rc[1], 2)}</td><td className="unit">mm</td></tr>
          <tr><td>Damper length (right)</td><td className="num">{fmt(damper, 2)}</td><td className="unit">mm</td></tr>
          <tr><td>Spring length (right)</td><td className="num">{fmt(spring, 2)}</td><td className="unit">mm</td></tr>
          <tr><td>Track</td><td className="num">{fmt(R.tcp[1] + L.tcp[1], 1)}</td><td className="unit">mm</td></tr>
        </tbody>
      </table>
    </div>
  );
}
