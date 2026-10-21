/**
 * Running SHARK's analyses in compliant mode, and the compliance coefficients display.
 */
import { sub, type Vec3 } from '../math/vec3.js';
import type { Corner } from '../solver/corner.js';
import { wheelGeometry, type WheelGeometry } from '../results/derivatives.js';
import { complianceAt } from './apply.js';
import type { CoefficientBar, ComplianceData } from './types.js';

export interface CoefficientRow {
  key: keyof CoefficientValues;
  label: string;
  unit: string;
}

export interface CoefficientValues {
  toe: number;
  camber: number;
  castor: number;
  kingpin: number;
  wcX: number;
  wcY: number;
  wcZ: number;
  tcpX: number;
  tcpY: number;
}

export const COEFFICIENTS: CoefficientRow[] = [
  { key: 'toe', label: 'Toe', unit: 'deg' },
  { key: 'camber', label: 'Camber', unit: 'deg' },
  { key: 'castor', label: 'Castor', unit: 'deg' },
  { key: 'kingpin', label: 'Kingpin', unit: 'deg' },
  { key: 'wcX', label: 'Wheel centre X', unit: 'mm' },
  { key: 'wcY', label: 'Wheel centre Y', unit: 'mm' },
  { key: 'wcZ', label: 'Wheel centre Z', unit: 'mm' },
  { key: 'tcpX', label: 'Contact point X', unit: 'mm' },
  { key: 'tcpY', label: 'Contact point Y', unit: 'mm' },
];

export interface CoefficientSet {
  set: number;
  label: string;
  on: boolean;
  /** Compliant minus kinematic at the static position, right-hand wheel. */
  values: CoefficientValues;
}

const values = (g: WheelGeometry): CoefficientValues => ({
  toe: g.toeSae, camber: g.camber, castor: g.castor, kingpin: g.kingpin,
  wcX: g.wc[0], wcY: g.wc[1], wcZ: g.wc[2], tcpX: g.tcp[0], tcpY: g.tcp[1],
});

/**
 * SHARK's compliance coefficients: for each force set, how much each variable changes between the
 * kinematic and the compliant static position. The spring preload is included when the settings say so.
 */
export function complianceCoefficients(c: Corner, data: ComplianceData): CoefficientSet[] {
  const st = c.solve({});
  const kin = values(wheelGeometry(c, st.points, st.groundZ));
  return data.forceSets.map((fs, set) => {
    const res = complianceAt(c, st, data, set);
    const comp = values(wheelGeometry(c, res.points, st.groundZ));
    const d = Object.fromEntries(Object.keys(kin).map((k) => [k, comp[k as keyof CoefficientValues] - kin[k as keyof CoefficientValues]])) as unknown as CoefficientValues;
    return { set, label: fs.label, on: fs.on, values: d };
  });
}

/** How far each point moved from its kinematic position, mm. */
export const deflections = (kinematic: Vec3[], compliant: Vec3[]): Vec3[] => compliant.map((p, i) => sub(p, kinematic[i]));

/** The bars of one force set's chart: its own list, or every variable with default limit, scale and weight. */
export const coefficientBars = (data: ComplianceData | undefined, set: number): CoefficientBar[] =>
  data?.bars?.[set] ?? COEFFICIENTS.map((c) => ({ key: c.key, weight: 1 }));

/** Weighted sum of the bar values (absolute values, so deflections in either direction add). */
export const barSum = (values: CoefficientValues, bars: CoefficientBar[]): number =>
  bars.reduce((s, b) => s + b.weight * Math.abs(values[b.key as keyof CoefficientValues] ?? 0), 0);

/** Set every bar's limit to the current value of its variable. */
export const limitsToCurrent = (bars: CoefficientBar[], values: CoefficientValues): CoefficientBar[] =>
  bars.map((b) => ({ ...b, limit: values[b.key as keyof CoefficientValues] ?? 0 }));

/** Set every bar's scale to cover its value with a margin (a bar with no deflection keeps a scale of 1). */
export const autoscaleBars = (bars: CoefficientBar[], values: CoefficientValues, margin = 1.2): CoefficientBar[] =>
  bars.map((b) => {
    const v = Math.max(Math.abs(values[b.key as keyof CoefficientValues] ?? 0), Math.abs(b.limit ?? 0));
    return { ...b, scale: v > 1e-9 ? v * margin : 1 };
  });

/** Set every bar's scale to one. */
export const unityBars = (bars: CoefficientBar[]): CoefficientBar[] => bars.map((b) => ({ ...b, scale: 1 }));
