// Default (naturally aspirated) engine model generator, modelled on tutorial_4.
import type { Connection, EngineModel, Pipe, Plenum, Port, TestPoint, Throttle, Valve } from '../model';
import {
  C2K, DEFAULT_FRICTION, DEFAULT_TEMPERATURES, defaultAnnand, defaultBurn, defaultWiebe, makeFuel, stoichAfr,
} from './parse';

export interface DefaultModelOptions {
  cylinders?: number;
  cycle?: 2 | 4;
  bore?: number;
  stroke?: number;
}

const FIRING_4: Record<number, number[]> = {
  1: [0],
  2: [0, 360],
  3: [0, 480, 240],
  4: [0, 540, 180, 360], // 1-3-4-2
  5: [0, 144, 576, 288, 432], // 1-2-4-5-3
  6: [0, 480, 240, 600, 120, 360], // 1-5-3-6-2-4
  8: [0, 630, 270, 180, 450, 360, 540, 90], // 1-8-4-3-6-5-7-2
};

function firingAngles(n: number, cycle: 2 | 4): number[] {
  if (cycle === 4 && FIRING_4[n]) return FIRING_4[n];
  const span = cycle === 4 ? 720 : 360;
  return Array.from({ length: n }, (_, i) => (i * span) / n);
}

function pipe(id: number, label: string, length: number, d0: number, d1: number, exhaust: boolean, port: boolean): Pipe {
  const nMesh = Math.max(1, Math.round(length / 14));
  return {
    id, label, length, stations: [{ x: 0, d: d0 }, { x: length, d: d1 }], meshLength: length / nMesh,
    wallTemperature: exhaust ? 360 : 320, frictionFactor: 0.005,
    extra: [exhaust ? 2 : 1, 2, port ? 4 : 1, port ? 1 : 0, 2, 0, 0, 0, 1, 1],
  };
}

export function createDefaultModel(opts: DefaultModelOptions = {}): EngineModel {
  const n = Math.max(1, Math.round(opts.cylinders ?? 4));
  const cycle = opts.cycle ?? 4;
  const bore = opts.bore ?? 87;
  const stroke = opts.stroke ?? 84;
  const phases = firingAngles(n, cycle);
  const fuel = makeFuel('gasoline', 'spark-ignition');
  const dw = defaultWiebe('gasoline');
  const swept = (n * Math.PI * bore * bore * stroke) / 4 / 1e6; // litres

  const cylinders = phases.map((ph, i) => ({
    id: i + 1, label: i === 0 ? 'default cylinder' : 'default cylinder (copied)', bore, stroke,
    conRod: Math.round(stroke * 1.55 * 100) / 100, pinOffset: 0, compressionRatio: 11, firingAngle: ph,
    extra: [0, 0, 1],
  }));

  const ports: Port[] = [];
  const valves: Valve[] = [];
  const pipes: Pipe[] = [];
  const connections: Connection[] = [];
  const layout: EngineModel['layout'] = {};
  const dIn = Math.round(bore * 0.32 * 1000) / 1000;
  const dEx = Math.round(bore * 0.26 * 1000) / 1000;
  const pipeIn = Math.round(bore * 0.45);
  const pipeEx = Math.round(bore * 0.37);
  const pipeCol = Math.round(bore * 0.6);
  const intakeRunners: number[] = [];
  const exhaustPrimaries: number[] = [];

  for (let i = 0; i < n; i++) {
    const cid = i + 1;
    const y = 4 * (n - i);
    // intake: port, valve, port pipe, runner
    const pIn = ports.length + 1;
    ports.push({ id: pIn, label: 'default intake port', kind: 'intake', diameter: dIn, extra: [0, 2] });
    const vIn = valves.length + 1;
    const wrap = (a: number) => (cycle === 4 ? a : a % 360);
    valves.push({
      id: vIn, label: 'default intake valve', kind: 'intake', openAngle: wrap(345), closeAngle: wrap(600), maxLift: 8.5,
      diameter: dIn, extra: [1, 0, 0, 0, 0, 0, 112.48],
    });
    const pEx = ports.length + 1;
    ports.push({ id: pEx, label: 'default exhaust port', kind: 'exhaust', diameter: dEx, extra: [0, 2] });
    const vEx = valves.length + 1;
    valves.push({
      id: vEx, label: 'default exhaust valve', kind: 'exhaust', openAngle: wrap(140), closeAngle: wrap(380), maxLift: 8,
      diameter: dEx, extra: [1, 0, 0, 0, 0, 0, -100],
    });
    const portPipeIn = pipes.length + 1;
    pipes.push(pipe(portPipeIn, 'default pipe t1', 100, pipeIn, pipeIn, false, true));
    const runner = pipes.length + 1;
    pipes.push(pipe(runner, 'default pipe t1', 350, pipeIn, pipeIn, false, false));
    const portPipeEx = pipes.length + 1;
    pipes.push(pipe(portPipeEx, 'default pipe t1', 100, pipeEx, pipeEx, true, true));
    const prim = pipes.length + 1;
    pipes.push(pipe(prim, 'default pipe t1', 400, pipeEx, pipeEx, true, false));
    intakeRunners.push(runner);
    exhaustPrimaries.push(prim);

    connections.push({ a: { kind: 'cylinder', id: cid }, b: { kind: 'pipe', id: portPipeIn, end: 2 }, via: [{ kind: 'valve', id: vIn }, { kind: 'port', id: pIn }] });
    connections.push({ a: { kind: 'cylinder', id: cid }, b: { kind: 'pipe', id: portPipeEx, end: 1 }, via: [{ kind: 'valve', id: vEx }, { kind: 'port', id: pEx }] });

    layout[`cylinder:${cid}`] = { x: 18, y: y + 0 };
    layout[`valve:${vIn}`] = { x: 16, y: y + 1 };
    layout[`valve:${vEx}`] = { x: 21, y: y + 1 };
    layout[`port:${pIn}`] = { x: 14, y: y + 1 };
    layout[`port:${pEx}`] = { x: 23, y: y + 1 };
    layout[`pipe:${portPipeIn}`] = { x: 12, y: y + 1 };
    layout[`pipe:${runner}`] = { x: 10, y: y + 1 };
    layout[`pipe:${portPipeEx}`] = { x: 25, y: y + 1 };
    layout[`pipe:${prim}`] = { x: 28, y: y + 1 };
  }
  const collector = pipes.length + 1;
  pipes.push(pipe(collector, 'default pipe t1', 300, pipeCol, pipeCol, true, false));
  layout[`pipe:${collector}`] = { x: 31, y: 12 };

  // intake plenum, exhaust plenum, throttles, boundaries
  const plenums: Plenum[] = [
    { id: 1, label: 'default intake plenum', volume: Math.round(swept * 1250) , wallTemperature: 20 + C2K, extra: [1, 1, 0, 1000, 20, 0] },
    { id: 2, label: 'default exhaust plenum', volume: Math.round(swept * 1500), wallTemperature: 100 + C2K, extra: [1, 2, 0, 1500, 100, 0] },
  ];
  const tDia = (a: number) => Math.round(Math.sqrt((4 * a) / Math.PI) * 1000) / 1000;
  const scale = Math.sqrt(n / 4) * (bore / 87);
  const throttles: Throttle[] = [
    { id: 1, label: 'default intake throttle', diameter: tDia(1590.43 * scale * scale), kind: 'area', position: 1, cd: 1, extra: [1, 0, 0] },
    { id: 2, label: 'default exhaust throttle', diameter: tDia(1385 * scale * scale), kind: 'area', position: 1, cd: 1, extra: [1, 0, 0] },
  ];
  const inlets = [{ id: 1, label: 'default inlet', kind: 'inlet' as const, pressure: 1, temperature: 20 + C2K }];
  const exits = [{ id: 1, label: 'default exit', kind: 'exit' as const, pressure: 1, temperature: 900 }];

  connections.push({ a: { kind: 'inlet', id: 1 }, b: { kind: 'plenum', id: 1 }, via: [{ kind: 'throttle', id: 1 }] });
  connections.push({ a: { kind: 'plenum', id: 2 }, b: { kind: 'exit', id: 1 }, via: [{ kind: 'throttle', id: 2 }] });
  for (const r of intakeRunners) {
    connections.push({ a: { kind: 'plenum', id: 1 }, b: { kind: 'pipe', id: r, end: 1 }, via: [] });
    connections.push({ a: { kind: 'pipe', id: r, end: 2 }, b: { kind: 'pipe', id: r - 1, end: 1 }, via: [] });
  }
  // exhaust: port pipe end 2 -> primary end 1, primaries end 2 + collector end 1 form a junction
  for (const p of exhaustPrimaries) {
    connections.push({ a: { kind: 'pipe', id: p - 1, end: 2 }, b: { kind: 'pipe', id: p, end: 1 }, via: [] });
  }
  const junction = [...exhaustPrimaries.map((p) => ({ kind: 'pipe' as const, id: p, end: 2 as const })), { kind: 'pipe' as const, id: collector, end: 1 as const }];
  for (let i = 0; i < junction.length; i++)
    for (let j = i + 1; j < junction.length; j++) connections.push({ a: junction[i], b: junction[j], via: [] });
  connections.push({ a: { kind: 'pipe', id: collector, end: 2 }, b: { kind: 'plenum', id: 2 }, via: [] });

  layout['plenum:1'] = { x: 8, y: 3 };
  layout['throttle:1'] = { x: 8, y: 0 };
  layout['inlet:1'] = { x: 8, y: -1 };
  layout['plenum:2'] = { x: 31, y: 14 };
  layout['throttle:2'] = { x: 31, y: 17 };
  layout['exit:1'] = { x: 31, y: 18 };

  const bd = defaultBurn('spark-ignition');
  const stoich = stoichAfr(fuel);
  const tests: TestPoint[] = [];
  for (let k = 1; k <= 7; k++) {
    tests.push({
      label: `Load Case ${k} - ( Created by Test Wizard )`,
      speed: 1000 * k,
      afr: stoich / 1.1,
      burnStart: bd.start,
      burnDuration: bd.duration,
      ambientPressure: 1,
      ambientTemperature: 20 + C2K,
      humidity: 0.013,
      maxCycles: 20,
      tolerance: 0.01,
      boundary: { inlets: [{ pressure: 1, temperature: 20 + C2K }], exits: [{ pressure: 1 }] },
      extra: [1],
    });
  }
  void defaultAnnand;

  return {
    title: ['Default engine model', 'Created by Claudus'],
    name: 'default',
    cycle,
    cylinders,
    fuel,
    burn: { kind: 'wiebe', a: dw.a, m: dw.m },
    heatTransfer: { kind: 'annand', ...defaultAnnand('spark-ignition') },
    temperatures: { ...DEFAULT_TEMPERATURES },
    friction: { ...DEFAULT_FRICTION },
    valves,
    ports,
    pipes,
    plenums,
    throttles,
    inlets,
    exits,
    compressors: [],
    turbines: [],
    connections,
    tests,
    layout,
  };
}
