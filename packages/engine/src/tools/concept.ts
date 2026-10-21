// Concept builder: sizes an engine from a few inputs, applies the Helmholtz / wave tuning equations and
// generates a complete EngineModel network.
import type { Connection, EngineModel, ElementRef, Pipe, TestPoint } from '../model';

export interface ConceptInput {
  cylinders: number;
  /** Total swept volume in cc; ignored when both bore and stroke are given. */
  sweptVolume: number;
  /** Speed of maximum power, rpm. */
  maxPowerRpm: number;
  cycle?: 2 | 4;
  boost?: number; // intake pressure bar abs (1.013 = naturally aspirated)
  bore?: number; // mm (fixes the geometry)
  stroke?: number; // mm
  compressionRatio?: number;
  intakeValves?: number; // per cylinder
  exhaustValves?: number;
  /** Helmholtz (peak torque) tuning speed; default maxPowerRpm - 1500. */
  helmholtzRpm?: number;
  intakeTemperature?: number; // K
  exhaustTemperature?: number; // K
  intakePressure?: number; // bar
  exhaustPressure?: number; // bar
  /** Fix the runner / primary length (mm) instead of computing it from the tuning equation. */
  runnerLength?: number;
  primaryLength?: number;
  plenumFactor?: number; // plenum volume / total swept volume (default 1.5)
  firingOrder?: number[];
  name?: string;
}

export interface ConceptResult {
  bore: number;
  stroke: number;
  conRod: number;
  compressionRatio: number;
  sweptPerCylinder: number; // cc
  clearanceVolume: number; // cc
  meanPistonSpeed: number; // m/s at max power
  inletThroatDiameter: number; // mm per valve
  exhaustThroatDiameter: number;
  inletPortDiameter: number; // mm, equivalent single port
  exhaustPortDiameter: number;
  inletThroatVelocity: number; // m/s (mean)
  inletPortVelocity: number;
  valveLift: { inlet: number; exhaust: number };
  timing: { ivo: number; ivc: number; evo: number; evc: number }; // deg BTDC, ABDC, BBDC, ATDC
  helmholtzRpm: number;
  /** Harmonic order of the intake tuning (2 = basic Helmholtz equation; higher orders give shorter runners). */
  intakeOrder: number;
  runnerLength: number; // mm, plenum to valve seat incl. port
  runnerDiameter: number;
  primaryLength: number;
  primaryDiameter: number;
  collectorDiameter: number;
  collectorLength: number;
  plenumVolume: number; // cc
  throttleDiameter: number;
  soundSpeedIntake: number;
  soundSpeedExhaust: number;
  exhaustTuningRpm: number;
  /** Exhaust tuning speed for the (possibly user fixed) primary length. */
  mach: number; // Mach index
  gulpFactor: number;
}

const R = 287;
const sound = (gamma: number, T: number) => Math.sqrt(gamma * R * T);

/** Helmholtz tuning speed (rpm) for a pipe: N = (30 a / pi) sqrt(A / (L Vc)); A m2, L m, Vc m3. */
export function helmholtzSpeed(a: number, area: number, length: number, vc: number): number {
  return ((30 * a) / Math.PI) * Math.sqrt(area / (length * vc));
}
/** Pipe length (m) that tunes the Helmholtz resonance to speed N, for harmonic order i (2 = the basic equation). */
export function helmholtzLength(a: number, area: number, vc: number, rpm: number, order = 2): number {
  const k = (60 * a) / (Math.PI * order * rpm);
  return (area * k * k) / vc;
}
/** Exhaust primary length (m): the blow-down pulse returns as a rarefaction within 120 deg of crank rotation. */
export function exhaustTuningLength(a: number, rpm: number): number {
  const t = 120 / (6 * rpm); // s for 120 deg
  return t * a * 0.5;
}
export function exhaustTuningSpeed(a: number, length: number): number {
  return (a * 20) / (2 * length) / 1; // N = 120 / (6 t) with t = 2 L / a
}

function defaultFiringOrder(n: number): number[] {
  const known: Record<number, number[]> = {
    1: [1], 2: [1, 2], 3: [1, 2, 3], 4: [1, 3, 4, 2], 5: [1, 2, 4, 5, 3], 6: [1, 5, 3, 6, 2, 4], 8: [1, 8, 4, 3, 6, 5, 7, 2],
  };
  return known[n] ?? Array.from({ length: n }, (_, i) => i + 1);
}

/** Size the engine and its breathing systems. */
export function sizeConcept(inp: ConceptInput): ConceptResult {
  const nc = Math.max(1, Math.round(inp.cylinders));
  const N = inp.maxPowerRpm;
  const vs = inp.sweptVolume / nc; // cc per cylinder
  const cr = inp.compressionRatio ?? 10.5;
  // Bore / stroke: B = S first, then stroke limited by a 20 m/s piston speed.
  let bore: number, stroke: number;
  if (inp.bore && inp.stroke) { bore = inp.bore; stroke = inp.stroke; } else {
    const b1 = Math.cbrt((4 * vs * 1000) / Math.PI); // mm, from V = pi/4 B^2 S with S = B
    const sMax = (20 * 30 / N) * 1000; // mm
    stroke = inp.stroke ?? Math.min(b1, sMax);
    bore = inp.bore ?? Math.sqrt((4 * vs * 1000) / (Math.PI * stroke));
    if (inp.stroke && !inp.bore) bore = Math.sqrt((4 * vs * 1000) / (Math.PI * stroke));
  }
  const swept = (Math.PI / 4) * bore * bore * stroke / 1000; // cc
  const clearance = swept / (cr - 1);
  const boreArea = (Math.PI / 4) * bore * bore; // mm2
  const sp = (2 * stroke * N) / 60000;
  const nIv = inp.intakeValves ?? 2, nEv = inp.exhaustValves ?? 2;
  const tIn = inp.intakeTemperature ?? 300, tEx = inp.exhaustTemperature ?? 900;
  const aIn = sound(1.4, tIn), aEx = sound(1.33, tEx);
  // Throats: 23 % of bore area; limit mean velocity to 80 m/s.
  let inletArea = 0.23 * boreArea;
  const vThroat = (sp * boreArea) / inletArea;
  if (vThroat > 80) inletArea = (sp * boreArea) / 80;
  const exhaustArea = 0.7 * inletArea;
  const portAreaIn0 = inletArea / 0.8;
  const portAreaIn = Math.max(portAreaIn0, (sp * boreArea) / 110);
  const portAreaEx = exhaustArea / 0.9;
  const dOf = (a: number) => Math.sqrt((4 * a) / Math.PI);
  const dThroatIn = dOf(inletArea / nIv), dThroatEx = dOf(exhaustArea / nEv);
  const timing = {
    ivo: 10 + N / 600, ivc: 40 + N / 200, evo: 45 + N / 300, evc: 8 + N / 800,
  };
  // Intake: Helmholtz. Runner area equals the port area.
  const helm = inp.helmholtzRpm ?? Math.max(N - 1500, 1000);
  const vc = (0.5 * swept + clearance) * 1e-6; // m3
  const runnerArea = portAreaIn;
  // Use the lowest harmonic order whose runner is not longer than 0.75 m (packaging limit).
  let intakeOrder = 2;
  let runnerLenM = helmholtzLength(aIn, runnerArea * 1e-6, vc, helm, intakeOrder);
  while (runnerLenM > 0.75 && intakeOrder < 6) { intakeOrder++; runnerLenM = helmholtzLength(aIn, runnerArea * 1e-6, vc, helm, intakeOrder); }
  if (inp.runnerLength !== undefined) runnerLenM = inp.runnerLength / 1000;
  const runnerLength = runnerLenM * 1000;
  // Exhaust: wave return in 120 deg.
  const primaryLenM = inp.primaryLength !== undefined ? inp.primaryLength / 1000 : exhaustTuningLength(aEx, N);
  const primaryArea = portAreaEx;
  const collectorArea = primaryArea * Math.pow(nc, 0.75);
  const lift = { inlet: 0.28 * dThroatIn, exhaust: 0.28 * dThroatEx };
  const plenumFactor = inp.plenumFactor ?? 1.5;
  const totalSwept = swept * nc;
  const throttle = 40 * Math.sqrt(totalSwept / 1000) * (nc === 1 ? 0.8 : 1);
  // Mach index with a mean valve area from a half-sine lift (mean lift ~ 0.64 peak) and Cd 0.6.
  const meanArea = 0.64 * 0.6 * nIv * Math.PI * dThroatIn * lift.inlet * 0.64;
  const mach = (sp * boreArea) / (aIn * Math.max(meanArea, 1e-9));
  return {
    bore, stroke, conRod: 1.7 * stroke, compressionRatio: cr, sweptPerCylinder: swept, clearanceVolume: clearance,
    meanPistonSpeed: sp,
    inletThroatDiameter: dThroatIn, exhaustThroatDiameter: dThroatEx,
    inletPortDiameter: dOf(portAreaIn), exhaustPortDiameter: dOf(portAreaEx),
    inletThroatVelocity: (sp * boreArea) / inletArea, inletPortVelocity: (sp * boreArea) / portAreaIn,
    valveLift: lift, timing, helmholtzRpm: helm, intakeOrder,
    runnerLength, runnerDiameter: dOf(runnerArea), primaryLength: primaryLenM * 1000, primaryDiameter: dOf(primaryArea),
    collectorDiameter: dOf(collectorArea), collectorLength: Math.max(250, 3 * dOf(collectorArea)),
    plenumVolume: totalSwept * plenumFactor, throttleDiameter: throttle,
    soundSpeedIntake: aIn, soundSpeedExhaust: aEx,
    exhaustTuningRpm: exhaustTuningSpeed(aEx, primaryLenM),
    mach, gulpFactor: mach / 0.6,
  };
}

const ref = (kind: ElementRef['kind'], id: number, end?: 1 | 2): ElementRef => (end ? { kind, id, end } : { kind, id });

function pipe(id: number, label: string, length: number, d0: number, d1: number, mesh: number, wallT: number, fric = 0.01): Pipe {
  return { id, label, length, stations: [{ x: 0, d: d0 }, { x: length, d: d1 }], meshLength: mesh, wallTemperature: wallT, frictionFactor: fric };
}

/** Build a full EngineModel network from the concept inputs (and sizing result). */
export function buildConceptModel(inp: ConceptInput, sizing: ConceptResult = sizeConcept(inp)): EngineModel {
  const nc = Math.max(1, Math.round(inp.cylinders));
  const cycle = inp.cycle ?? 4;
  const order = inp.firingOrder && inp.firingOrder.length === nc ? inp.firingOrder : defaultFiringOrder(nc);
  const interval = (cycle === 4 ? 720 : 360) / nc;
  const pAmb = inp.intakePressure ?? inp.boost ?? 1.013;
  const nIv = inp.intakeValves ?? 2, nEv = inp.exhaustValves ?? 2;
  const s = sizing;
  const wallIn = inp.intakeTemperature ?? 300, wallEx = 750;
  // Valve angles: firing TDC = 0, 720 cycle. Gas exchange TDC at 360.
  const ivo = 360 - s.timing.ivo, ivc = 540 + s.timing.ivc, evo = 180 - s.timing.evo, evc = 360 + s.timing.evc;

  const cylinders: EngineModel['cylinders'] = [];
  const valves: EngineModel['valves'] = [];
  const ports: EngineModel['ports'] = [];
  const pipes: Pipe[] = [];
  const connections: Connection[] = [];
  const layout: EngineModel['layout'] = {};
  const rowH = 130;
  const portLen = Math.max(0.5 * s.bore, 20);

  const equivD = (d: number, n: number) => d * Math.sqrt(n); // single-valve diameter with the same total area
  const runnerPipeLen = Math.max(s.runnerLength - portLen, 60);
  const primaryPipeLen = Math.max(s.primaryLength - portLen, 60);

  for (let i = 0; i < nc; i++) {
    const id = i + 1;
    const pos = order.indexOf(id);
    cylinders.push({
      id, label: `Cylinder ${id}`, bore: round(s.bore), stroke: round(s.stroke), conRod: round(s.conRod), pinOffset: 0,
      compressionRatio: s.compressionRatio, firingAngle: pos * interval,
    });
    const iv = i * 2 + 1, ev = i * 2 + 2;
    valves.push({
      id: iv, label: `Inlet valve ${id}`, kind: 'intake', openAngle: round(ivo), closeAngle: round(ivc), maxLift: round(s.valveLift.inlet),
      diameter: round(equivD(s.inletThroatDiameter, nIv)),
    });
    valves.push({
      id: ev, label: `Exhaust valve ${id}`, kind: 'exhaust', openAngle: round(evo), closeAngle: round(evc), maxLift: round(s.valveLift.exhaust),
      diameter: round(equivD(s.exhaustThroatDiameter, nEv)),
    });
    ports.push({ id: iv, label: `Inlet port ${id}`, kind: 'intake', diameter: round(s.inletPortDiameter), length: round(portLen) });
    ports.push({ id: ev, label: `Exhaust port ${id}`, kind: 'exhaust', diameter: round(s.exhaustPortDiameter), length: round(portLen) });
    // Pipes: runner id = i+1, primary id = nc + i + 1.
    pipes.push(pipe(id, `Intake runner ${id}`, round(runnerPipeLen), round(s.runnerDiameter * 1.05), round(s.runnerDiameter), 25, wallIn));
    pipes.push(pipe(nc + id, `Exhaust primary ${id}`, round(primaryPipeLen), round(s.primaryDiameter), round(s.primaryDiameter), 25, wallEx));
    layout[`cylinder:${id}`] = { x: 520, y: 80 + i * rowH };
    layout[`pipe:${id}`] = { x: 330, y: 80 + i * rowH };
    layout[`pipe:${nc + id}`] = { x: 720, y: 80 + i * rowH };
    layout[`valve:${iv}`] = { x: 440, y: 55 + i * rowH };
    layout[`valve:${ev}`] = { x: 600, y: 55 + i * rowH };
    layout[`port:${iv}`] = { x: 440, y: 105 + i * rowH };
    layout[`port:${ev}`] = { x: 600, y: 105 + i * rowH };
    connections.push({ a: ref('plenum', 1), b: ref('pipe', id, 1), via: [] });
    connections.push({ a: ref('cylinder', id), b: ref('pipe', id, 2), via: [ref('valve', iv), ref('port', iv)] });
    connections.push({ a: ref('cylinder', id), b: ref('pipe', nc + id, 1), via: [ref('valve', ev), ref('port', ev)] });
  }
  const collId = 2 * nc + 1;
  pipes.push(pipe(collId, 'Exhaust collector', round(s.collectorLength), round(s.collectorDiameter), round(s.collectorDiameter * 1.1), 25, wallEx));
  for (let i = 0; i < nc; i++) connections.push({ a: ref('pipe', nc + i + 1, 2), b: ref('pipe', collId, 1), via: [] });
  connections.push({ a: ref('pipe', collId, 2), b: ref('exit', 1), via: [] });
  connections.unshift({ a: ref('inlet', 1), b: ref('plenum', 1), via: [ref('throttle', 1)] });

  const mid = 80 + ((nc - 1) * rowH) / 2;
  layout['inlet:1'] = { x: 40, y: mid };
  layout['throttle:1'] = { x: 120, y: mid };
  layout['plenum:1'] = { x: 220, y: mid };
  layout[`pipe:${collId}`] = { x: 860, y: mid };
  layout['exit:1'] = { x: 980, y: mid };

  const tests: TestPoint[] = [];
  const top = Math.ceil((inp.maxPowerRpm + 500) / 500) * 500;
  const low = Math.max(1000, Math.round((inp.maxPowerRpm * 0.2) / 500) * 500);
  for (let r = low; r <= top; r += 500) {
    tests.push({
      label: `${r} rpm`, speed: r, afr: 13, burnStart: -round(10 + r / 400), burnDuration: 50,
      ambientPressure: pAmb, ambientTemperature: inp.intakeTemperature ?? 293, maxCycles: 12, tolerance: 0.01,
    });
  }

  return {
    title: [inp.name ?? `Concept ${nc} cylinder ${Math.round(inp.sweptVolume)} cc`, 'Generated by the Concept Builder', ''],
    name: inp.name ?? 'concept',
    cycle,
    cylinders,
    fuel: { type: 'gasoline', lowerHeatingValue: 44.0e6, hcRatio: 1.87, ocRatio: 0, density: 740, system: 'spark-ignition' },
    burn: { kind: 'wiebe', a: 6.908, m: 2 },
    heatTransfer: { kind: 'woschni', scale: 1 },
    temperatures: { head: 520, piston: 560, liner: 420 },
    friction: { a: 0.4, b: 0.005, c: 0.09, d: 0.0009 },
    valves, ports, pipes,
    plenums: [{ id: 1, label: 'Intake plenum', volume: round(s.plenumVolume), wallTemperature: wallIn }],
    throttles: [{ id: 1, label: 'Throttle', diameter: round(s.throttleDiameter), kind: 'butterfly', position: 90, cd: 0.8 }],
    inlets: [{ id: 1, label: 'Inlet', kind: 'inlet', pressure: pAmb, temperature: inp.intakeTemperature ?? 293 }],
    exits: [{ id: 1, label: 'Exit', kind: 'exit', pressure: inp.exhaustPressure ?? 1.013, temperature: 300 }],
    compressors: [], turbines: [],
    connections, tests, layout,
  };
}

function round(x: number): number { return Math.round(x * 100) / 100; }
