import type { VehicleParams } from '@claudus/core';
import { useApp } from '../store';
import { NumberCell } from './PointTable';

const fields: { key: keyof VehicleParams; label: string; unit: string }[] = [
  { key: 'bumpTravel', label: 'Bump travel', unit: 'mm' },
  { key: 'reboundTravel', label: 'Rebound travel', unit: 'mm' },
  { key: 'bumpIncrement', label: 'Bump increment', unit: 'mm' },
  { key: 'rollAngle', label: 'Roll angle', unit: 'deg' },
  { key: 'rollIncrement', label: 'Roll increment', unit: 'deg' },
  { key: 'steerTravel', label: 'Steer travel', unit: 'mm' },
  { key: 'steerIncrement', label: 'Steer increment', unit: 'mm' },
  { key: 'wheelbase', label: 'Wheelbase', unit: 'mm' },
  { key: 'cogHeight', label: 'C of G height', unit: 'mm' },
  { key: 'brakeFrontPct', label: 'Braking on front', unit: '%' },
  { key: 'driveFrontPct', label: 'Drive on front', unit: '%' },
  { key: 'weightFrontPct', label: 'Weight on front', unit: '%' },
];

const choices: { key: keyof VehicleParams; label: string; options: [number, string][] }[] = [
  { key: 'frontBrakeType', label: 'Front brakes', options: [[1, 'Inboard'], [2, 'Outboard']] },
  { key: 'rearBrakeType', label: 'Rear brakes', options: [[1, 'Inboard'], [2, 'Outboard']] },
  { key: 'frontSuspensionType', label: 'Front suspension', options: [[1, 'Independent'], [2, 'Rigid']] },
  { key: 'rearSuspensionType', label: 'Rear suspension', options: [[1, 'Independent'], [2, 'Rigid']] },
];

export function ParamsPanel() {
  const p = useApp((s) => s.model.params);
  const setParam = useApp((s) => s.setParam);
  return (
    <div className="params">
      <table>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td><NumberCell value={p[f.key] as number} onCommit={(v) => setParam(f.key, v as never)} /></td>
              <td className="unit">{f.unit}</td>
            </tr>
          ))}
          {choices.map((c) => (
            <tr key={c.key}>
              <td>{c.label}</td>
              <td colSpan={2}>
                <select value={p[c.key] as number} onChange={(e) => setParam(c.key, Number(e.target.value) as never)}>
                  {c.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
