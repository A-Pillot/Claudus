// Results produced by the engine solver for one test point and for a speed sweep.

/** Crank-angle traces for one cylinder over the last (converged) cycle. */
export interface CylinderTrace {
  id: number;
  angle: number[]; // deg, 0..720 (4-stroke) or 0..360 (2-stroke), firing TDC of this cylinder = 0
  pressure: number[]; // bar
  temperature: number[]; // K
  volume: number[]; // cc
  massFractionBurned: number[];
  heatRelease: number[]; // J/deg
  heatTransfer: number[]; // W, positive into gas
  intakeMassFlow: number[]; // kg/s, positive into cylinder
  exhaustMassFlow: number[]; // kg/s, positive out of cylinder
  intakeLift: number[]; // mm
  exhaustLift: number[]; // mm
}

/** Crank-angle traces at a pipe location (start, middle, end). */
export interface PipeTrace {
  id: number;
  angle: number[];
  pressure: { start: number[]; mid: number[]; end: number[] }; // bar
  velocity: { start: number[]; mid: number[]; end: number[] }; // m/s
  temperature: { start: number[]; mid: number[]; end: number[] }; // K
}

export interface PlenumTrace {
  id: number;
  angle: number[];
  pressure: number[];
  temperature: number[];
}

export interface CylinderSummary {
  id: number;
  imep: number; // bar
  pmep: number; // bar (pumping, negative = loss)
  peakPressure: number; // bar
  peakPressureAngle: number; // deg ATDC
  trappedMass: number; // kg
  volumetricEfficiency: number; // fraction, ref ambient
  residualFraction: number;
  fuelMass: number; // kg/cycle
}

export interface TestPointResult {
  speed: number; // rpm
  cycles: number; // cycles run
  converged: boolean;
  imep: number; // bar, net
  fmep: number; // bar
  bmep: number; // bar
  power: number; // kW, brake
  torque: number; // Nm, brake
  bsfc: number; // g/kWh
  volumetricEfficiency: number;
  airMassFlow: number; // kg/s
  fuelMassFlow: number; // kg/s
  thermalEfficiency: number; // brake
  cylinders: CylinderSummary[];
  traces: {
    cylinders: CylinderTrace[];
    pipes: PipeTrace[];
    plenums: PlenumTrace[];
  };
  warnings: string[];
  /** Optional full pipe profiles (pressure bar, velocity m/s, temperature K) per crank angle sample, for the pipe display. */
  profiles?: { angle: number[]; pipes: { id: number; x: number[]; p: number[][]; u: number[][]; T: number[][] }[] };
}

export interface SweepResult {
  modelName: string;
  points: TestPointResult[];
}
