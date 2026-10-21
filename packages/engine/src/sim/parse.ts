// Lotus Engine Simulation .sim reader.
//
// DECODED FIELD MAP (reverse engineered from the 18 fixtures + LES help; "?" = best guess).
// File: 2 title lines, `name  version`, then keyword sections. Section lines follow the keyword line.
//
// CYCLE        : 4 | 2 (stroke cycle).
// CYLINDER     : `-n` (n cylinders; sign unknown), then per cylinder: `$label`,
//                `bore stroke conRod pinOffset compressionRatio phase(deg)` (F13.2 x6),
//                `0 0 1` (kept in Cylinder.extra; ? transient/scavenge flags).
// FUEL         : 1 gasoline, 2 diesel, 3 methane, 4 methanol, 5 user (? 5 per help list).
// CSYS         : 1 carburettor, 2 port injection (both SI), 3 direct injection, 4 indirect injection.
// BURN         : `1` default single Wiebe (A,M from fuel: gasoline 10/2, diesel 6.9/0.5, methane 5/2.2),
//                `2` default two-part, `-1 A M` user single, `-2 A M CP1 CP2 Fract Delay` user two-part.
//                Mapped to wiebe2 as a1=A m1=M a2=CP1 m2=CP2 premixFraction=Fract (Delay kept in raw).
// HEAT         : line 1 = open-cycle model id (1 Annand, 2 Woschni, 3 Eichelberg); line 2 = closed-cycle:
//                `id` (defaults) or `-id A B C` (user coefficients; Annand default SI 0.2/0.8/4.29e-9,
//                diesel 1.1/0.7/4.29e-9).
// TEMPERATURE  : component temperature options per cylinder (head/piston/liner materials, coolant). Not decoded;
//                model.temperatures uses fixed defaults (head 450 K, piston 520 K, liner 400 K). Kept raw,
//                only resized when the cylinder count changes.
// PORTS        : `n`, then `$label`, `kind(1 intake,2 exhaust) portType(0 default,3 user CF table) nValves
//                throatDia(mm)`, [user table: `rows`, rows x (L/D, Cf fwd, Cf rev)]. Port.diameter = throat dia,
//                Port.extra = [portType, nValves].
// VALVES       : `n`, then `$label`, `valveType(1 poppet,3 disc,4 piston port,...) kind(1 int,2 exh)`, then for
//                poppet: `liftOpt dataAction open close dwell maxLift lashOpen lashClose MOP`, and for
//                liftOpt 3: `nPoints` + (angle from opening, lift) rows.
//                Intake: open = deg BTDC (gas exchange), close = deg ABDC. Exhaust: open = deg BBDC, close =
//                deg ATDC. Converted to 0..720 deg ATDC firing: intake open 360-o, close 540+c;
//                exhaust open 180-o, close 360+c. MOP = mid-lift angle about gas exchange TDC (derived, kept
//                in extra). Valve.extra = [type, liftOpt, dataAction, dwell, lashOpen, lashClose, MOP].
//                Valve.diameter is taken from the port linked by the CONNECTIONS (VALVE n PORT m).
//                Non-poppet valves keep their raw data lines.
// PLENUMS      : `n`, then per plenum `type side` (type 1 constant volume, 2 varying volume; side 1 intake, 2
//                exhaust?), `$label`, data. Type 1: `volume(L) surfaceArea(mm2) wallTemp(C) HTC`. Type 2:
//                `bore stroke rod CR TDCangle wallTemp(C) HTC speedRatio`.
//                Plenum.extra = [type, side, ...data tokens].
// PIPES        : `n 0 ...`, per pipe `$label`, header
//                `cooling nStations thickness(mm) material diffuserLoss fricType [fric] nMeshes meshMode
//                 extCoolantT extHTC htType`, nStations x (x mm, dia mm), tail `0|1`.
//                cooling 1 air, 2 water, 3 external pipe, 4 user; fricType 0 = friction factor given,
//                2 = default roughness from material (model uses 0.005).
//                Pipe.extra = [cooling, material, thickness, diffuser, fricType, meshMode, extT, extHTC, htType, tail].
//                wallTemperature is not in the file: derived from cooling type (320/360/340 K, or user T).
// THROTTLE     : `n`, per throttle `$label`, `type 0 0`, `flowArea(mm2)`, `Cd`. Type 1 = simple area.
//                Throttle.diameter = equivalent dia of the area, kind 'area', position 1.
// INLETS/EXITS : `n` + `$label` only. Pressure/temperature come from the TESTS (first test point).
// COMPRESSORS, TURBINES : labels only are read; map data stays raw.
// CONNECTIONS  : `n`, then lines `KIND id [end]  KIND id [end]  [KIND id ...]`: two linked elements plus
//                restrictions (VALVE/PORT or THROTTLE) between them.
// TESTS        : `n`, per test: label, then lines
//                1 `speed solve`  2 heat phase `opt [value]` (SI: 50% burn deg ATDC; diesel: SOC deg BTDC)
//                3 heat period `opt [value]` (deg)  4 fuelling `opt value ...` (1 trapped AFR, 2 equivalence
//                ratio, 3 mm3/inj)  5 `ambientP(bar) ambientT(C) specificHumidity`  then one `p T(C)` per inlet,
//                one `p` per exit, then friction/solution/plot options (kept raw). A `1 before max from` line
//                gives cycle limits (max = 2nd value).
//                burnStart: SI = phase50 - duration/2; diesel = -phase. Default options (0) use built-in defaults.
// BUILDER      : canvas records, see builder.ts. Decoded into model.layout.
// Everything else (DPROPERTIES, LOSSJUNCTION, WIRES, VLINKS, SBOUNDARIES, SHAFTS, LINKS, LPOINT, TRANSIENTS,
// SENSORS, TSENSORS, ACTUATORS, TPLOTS, CONTROLS, ICENGINES, SOLVER SETTINGS, USER ARGUMENTS, COOLER): raw.
import type {
  BurnModel,
  Boundary,
  Connection,
  Cylinder,
  ElementKind,
  ElementRef,
  EngineModel,
  Fuel,
  FuelType,
  HeatTransferModel,
  Pipe,
  Plenum,
  Port,
  TestPoint,
  Throttle,
  Valve,
} from '../model';
import { builderToLayout } from './builder';
import { HEADER_KEY, isNumericLine, nums, splitBlocks, splitSections, tokens } from './format';

export interface Parsed {
  model: EngineModel;
  /** Raw line blocks per item, for sections made of items (used by the writer to keep unchanged items). */
  blocks: Record<string, string[][]>;
}

export const FUEL_CODES: FuelType[] = ['gasoline', 'diesel', 'natural-gas', 'methanol', 'user'];

const FUEL_PROPS: Record<FuelType, { lhv: number; hc: number; oc: number; rho: number }> = {
  gasoline: { lhv: 44e6, hc: 1.85, oc: 0, rho: 740 },
  diesel: { lhv: 42.5e6, hc: 1.8, oc: 0, rho: 840 },
  'natural-gas': { lhv: 50e6, hc: 4, oc: 0, rho: 0.72 },
  methanol: { lhv: 19.9e6, hc: 4, oc: 1, rho: 790 },
  ethanol: { lhv: 26.8e6, hc: 3, oc: 0.5, rho: 789 },
  lpg: { lhv: 46e6, hc: 2.67, oc: 0, rho: 540 },
  hydrogen: { lhv: 120e6, hc: 100, oc: 0, rho: 0.09 },
  user: { lhv: 44e6, hc: 1.85, oc: 0, rho: 740 },
};

export function makeFuel(type: FuelType, system: Fuel['system']): Fuel {
  const p = FUEL_PROPS[type];
  return { type, lowerHeatingValue: p.lhv, hcRatio: p.hc, ocRatio: p.oc, density: p.rho, system };
}

export function stoichAfr(f: Fuel): number {
  const x = f.hcRatio;
  const y = f.ocRatio;
  return (4.76 * (1 + x / 4 - y / 2) * 28.85) / (12.011 + 1.008 * x + 16 * y);
}

export function defaultWiebe(type: FuelType): { a: number; m: number } {
  if (type === 'diesel') return { a: 6.9, m: 0.5 };
  if (type === 'natural-gas') return { a: 5, m: 2.2 };
  return { a: 10, m: 2 };
}
export const DEFAULT_WIEBE2 = { premixFraction: 0.2, a1: 8.9, m1: 0.6, a2: 1, m2: 1 };

export function defaultAnnand(system: Fuel['system']): { a: number; b: number; c: number } {
  return system === 'spark-ignition' ? { a: 0.2, b: 0.8, c: 4.29e-9 } : { a: 1.1, b: 0.7, c: 4.29e-9 };
}

/** Default heat-release timing when the file uses option 0. */
export function defaultBurn(system: Fuel['system']): { start: number; duration: number } {
  return system === 'spark-ignition' ? { start: 10 - 45 / 2, duration: 45 } : { start: -8, duration: 50 };
}

export const DEFAULT_TEMPERATURES = { head: 450, piston: 520, liner: 400 };
export const DEFAULT_FRICTION = { a: 0.4, b: 0.005, c: 0.09, d: 0.0009 };
export const DEFAULT_PIPE_FRICTION = 0.005;
export const C2K = 273.15;

function label(block: string[] | undefined, fallback: string): string {
  const l = block?.find((x) => x.startsWith('$'));
  return l ? l.slice(1) : fallback;
}

const KEYWORD_KIND: Record<string, ElementKind> = {
  CYLINDER: 'cylinder', PIPE: 'pipe', PLENUM: 'plenum', INLET: 'inlet', EXIT: 'exit', THROTTLE: 'throttle',
  VALVE: 'valve', PORT: 'port', LOSSJUNCTION: 'junction', COMPRESSOR: 'compressor', TURBINE: 'turbine',
  COOLER: 'cooler',
};
export const KIND_KEYWORD: Record<string, string> = {};
for (const [k, v] of Object.entries(KEYWORD_KIND)) KIND_KEYWORD[v] = k;

export function parseConnectionLine(line: string): Connection | undefined {
  const t = tokens(line);
  const refs: ElementRef[] = [];
  for (let i = 0; i < t.length; ) {
    const kind = KEYWORD_KIND[t[i]];
    const id = Number(t[i + 1]);
    if (!kind || !Number.isFinite(id)) return undefined;
    if (kind === 'pipe') {
      const end = Number(t[i + 2]);
      if (end !== 1 && end !== 2) return undefined;
      refs.push({ kind, id, end });
      i += 3;
    } else {
      refs.push({ kind, id });
      i += 2;
    }
  }
  if (refs.length < 2) return undefined;
  return { a: refs[0], b: refs[1], via: refs.slice(2) };
}

function wrapAngle(a: number, cycle: number): number {
  return cycle === 360 ? ((a % 360) + 360) % 360 : a;
}

/** Piston-based volume (cc) of a varying volume plenum. */
function varyingVolume(bore: number, stroke: number, cr: number): number {
  const vs = (Math.PI / 4) * bore * bore * stroke / 1000;
  return cr > 1 ? (vs * cr) / (cr - 1) : vs;
}

export function parseSections(
  header: string[],
  order: string[],
  sec: Record<string, string[]>,
): Parsed {
  const blocks: Record<string, string[][]> = {};
  const get = (k: string) => sec[k] ?? [];
  const nameTok = tokens(header[2]);

  const cycle: 2 | 4 = nums(get('CYCLE')[0])[0] === 2 ? 2 : 4;
  const cycleLen = cycle === 4 ? 720 : 360;

  // fuel
  const fuelCode = nums(get('FUEL')[0])[0] || 1;
  const fuelType = FUEL_CODES[fuelCode - 1] ?? 'gasoline';
  const csys = nums(get('CSYS')[0])[0] || 2;
  const system: Fuel['system'] = csys === 3 ? 'direct-injection-diesel' : csys === 4 ? 'indirect-injection-diesel' : 'spark-ignition';
  const fuel = makeFuel(fuelType, system);

  // burn
  const bt = nums(get('BURN')[0]);
  let burn: BurnModel;
  const dw = defaultWiebe(fuelType);
  if (bt[0] === -1) burn = { kind: 'wiebe', a: bt[1], m: bt[2] };
  else if (bt[0] === -2)
    burn = { kind: 'wiebe2', a1: bt[1], m1: bt[2], a2: bt[3], m2: bt[4], premixFraction: bt[5] };
  else if (bt[0] === 2) burn = { kind: 'wiebe2', ...DEFAULT_WIEBE2 };
  else burn = { kind: 'wiebe', a: dw.a, m: dw.m };

  // heat transfer
  const h1 = nums(get('HEAT')[0]);
  const h2 = nums(get('HEAT')[1]);
  const hid = Math.abs(h2[0] ?? h1[0] ?? 1);
  let heatTransfer: HeatTransferModel;
  if (hid === 2) heatTransfer = { kind: 'woschni', scale: 1 };
  else if (hid === 3) heatTransfer = { kind: 'eichelberg', scale: 1 };
  else if (h2[0] !== undefined && h2[0] < 0 && h2.length >= 4) heatTransfer = { kind: 'annand', a: h2[1], b: h2[2], c: h2[3] };
  else heatTransfer = { kind: 'annand', ...defaultAnnand(system) };

  // cylinders
  const cs = splitBlocks(get('CYLINDER'));
  blocks.CYLINDER = cs.blocks;
  const cylinders: Cylinder[] = cs.blocks.map((b, i) => {
    const g = nums(b[1]);
    return {
      id: i + 1,
      label: label(b, `cylinder ${i + 1}`),
      bore: g[0], stroke: g[1], conRod: g[2], pinOffset: g[3], compressionRatio: g[4], firingAngle: g[5] ?? 0,
      extra: nums(b[2]),
    };
  });

  // ports
  const ps = splitBlocks(get('PORTS'));
  blocks.PORTS = ps.blocks;
  const ports: Port[] = ps.blocks.map((b, i) => {
    const t = nums(b[1]);
    return {
      id: i + 1, label: label(b, `port ${i + 1}`), kind: t[0] === 2 ? 'exhaust' : 'intake', diameter: t[3],
      extra: [t[1] ?? 0, t[2] ?? 1],
    };
  });

  // valves
  const vs = splitBlocks(get('VALVES'));
  blocks.VALVES = vs.blocks;
  const valves: Valve[] = vs.blocks.map((b, i) => {
    const h = nums(b[1]);
    const kind: 'intake' | 'exhaust' = h[1] === 2 ? 'exhaust' : 'intake';
    const v: Valve = {
      id: i + 1, label: label(b, `valve ${i + 1}`), kind, openAngle: 0, closeAngle: 0, maxLift: 0, diameter: 0,
      extra: [h[0]],
    };
    if (h[0] === 1) {
      const d = nums(b[2]);
      const [liftOpt, action, o, c, dwell, lift, lashO, lashC, mop] = d;
      v.maxLift = lift;
      if (kind === 'intake') {
        v.openAngle = wrapAngle(360 - o, cycleLen);
        v.closeAngle = wrapAngle(540 + c, cycleLen);
      } else {
        v.openAngle = wrapAngle(180 - o, cycleLen);
        v.closeAngle = wrapAngle(360 + c, cycleLen);
      }
      v.extra = [1, liftOpt, action, dwell, lashO, lashC, mop];
      if (liftOpt === 3) {
        const n = nums(b[3])[0];
        const angle: number[] = [];
        const l: number[] = [];
        for (let k = 0; k < n; k++) {
          const r = nums(b[4 + k]);
          angle.push(v.openAngle + r[0]);
          l.push(r[1]);
        }
        v.liftCurve = { angle, lift: l };
      }
    } else {
      // Other valve types: keep numbers of the data lines for reference.
      v.extra = [h[0], ...b.slice(2).flatMap((x) => nums(x))];
    }
    return v;
  });

  // plenums
  const pls = splitBlocks(get('PLENUMS'), 1);
  blocks.PLENUMS = pls.blocks;
  const plenums: Plenum[] = pls.blocks.map((b, i) => {
    const hd = nums(b[0]);
    const lab = b.findIndex((x) => x.startsWith('$'));
    const data = nums(b[lab + 1]);
    const type = hd[0] ?? 1;
    const p: Plenum = {
      id: i + 1, label: label(b, `plenum ${i + 1}`), volume: 0, extra: [type, hd[1] ?? 1, ...data],
    };
    if (type === 2) {
      p.volume = varyingVolume(data[0], data[1], data[3]);
      p.wallTemperature = data[5] + C2K;
    } else {
      p.volume = data[0] * 1000;
      p.wallTemperature = data[2] + C2K;
    }
    return p;
  });

  // pipes
  const pis = splitBlocks(get('PIPES'));
  blocks.PIPES = pis.blocks;
  const pipes: Pipe[] = pis.blocks.map((b, i) => {
    const h = nums(b[1]);
    const [cooling, nSt, thick, material, diffuser, fricType] = h;
    let k = 6;
    let friction = DEFAULT_PIPE_FRICTION;
    if (fricType === 0) friction = h[k++];
    const nMesh = h[k++];
    const meshMode = h[k++];
    const extT = h[k++];
    const extHtc = h[k++];
    const htType = h[k++];
    const stations: { x: number; d: number }[] = [];
    for (let s = 0; s < nSt; s++) {
      const r = nums(b[2 + s]);
      stations.push({ x: r[0], d: r[1] });
    }
    const length = stations.length ? stations[stations.length - 1].x - stations[0].x : 0;
    const wall = cooling === 4 ? extT + C2K : cooling === 2 ? 360 : cooling === 3 ? 340 : 320;
    return {
      id: i + 1, label: label(b, `pipe ${i + 1}`), length, stations,
      meshLength: nMesh > 0 ? length / nMesh : 14, wallTemperature: wall, frictionFactor: friction,
      extra: [cooling, material, thick, diffuser, fricType, meshMode, extT, extHtc, htType, nums(b[2 + nSt])[0] ?? 0],
    };
  });

  // throttles
  const ths = splitBlocks(get('THROTTLE'));
  blocks.THROTTLE = ths.blocks;
  const throttles: Throttle[] = ths.blocks.map((b, i) => {
    const h = nums(b[1]);
    const area = nums(b[2])[0] ?? 0;
    return {
      id: i + 1, label: label(b, `throttle ${i + 1}`), diameter: Math.sqrt((4 * area) / Math.PI), kind: 'area',
      position: 1, cd: nums(b[3])[0] ?? 1, extra: h,
    };
  });

  // tests (need inlet/exit counts)
  const insB = splitBlocks(get('INLETS'));
  blocks.INLETS = insB.blocks;
  const exsB = splitBlocks(get('EXITS'));
  blocks.EXITS = exsB.blocks;
  const nIn = insB.blocks.length;
  const nEx = exsB.blocks.length;
  const tests: TestPoint[] = [];
  const tl = get('TESTS');
  const nTests = nums(tl[0])[0] || 0;
  const testBlocks: string[][] = [];
  {
    let p = 1;
    for (let t = 0; t < nTests && p < tl.length; t++) {
      const s = p++;
      while (p < tl.length && isNumericLine(tl[p])) p++;
      testBlocks.push(tl.slice(s, p));
    }
  }
  blocks.TESTS = testBlocks;
  const stoich = stoichAfr(fuel);
  const db = defaultBurn(system);
  for (const b of testBlocks) {
    const body = b.slice(1);
    const sp = nums(body[0]);
    const ph = nums(body[1]);
    const pr = nums(body[2]);
    const fu = nums(body[3]);
    const bd = nums(body[4]);
    const duration = pr[0] !== 0 && pr[0] !== 2 && pr[1] !== undefined ? pr[1] : db.duration;
    let start = db.start;
    if (ph[0] !== 0 && ph[1] !== undefined) start = system === 'spark-ignition' ? ph[1] - duration / 2 : -ph[1];
    else if (system === 'spark-ignition') start = 10 - duration / 2;
    let afr = system === 'spark-ignition' ? stoich / 1.1 : 25;
    if (fu[0] === 2 && fu[1] > 0) afr = stoich / fu[1];
    else if (fu[0] === 1 && fu[1] > 0) afr = fu[1];
    const inl: { pressure: number; temperature: number }[] = [];
    const exl: { pressure: number }[] = [];
    for (let i = 0; i < nIn; i++) {
      const r = nums(body[5 + i]);
      inl.push({ pressure: r[0], temperature: r[1] + C2K });
    }
    for (let i = 0; i < nEx; i++) exl.push({ pressure: nums(body[5 + nIn + i])[0] });
    let maxCycles = 20;
    for (const l of body.slice(5 + nIn + nEx)) {
      const m = /^\s*1\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(l);
      if (m) maxCycles = Number(m[2]);
    }
    tests.push({
      label: b[0].trim(),
      speed: sp[0],
      afr,
      burnStart: start,
      burnDuration: duration,
      ambientPressure: bd[0],
      ambientTemperature: bd[1] + C2K,
      humidity: bd[2],
      maxCycles,
      tolerance: 0.01,
      boundary: { inlets: inl, exits: exl },
      extra: [sp[1] ?? 1],
    });
  }

  const inlets: Boundary[] = insB.blocks.map((b, i) => ({
    id: i + 1, label: label(b, `inlet ${i + 1}`), kind: 'inlet',
    pressure: tests[0]?.boundary?.inlets[i]?.pressure ?? 1,
    temperature: tests[0]?.boundary?.inlets[i]?.temperature ?? 293.15,
  }));
  const exits: Boundary[] = exsB.blocks.map((b, i) => ({
    id: i + 1, label: label(b, `exit ${i + 1}`), kind: 'exit',
    pressure: tests[0]?.boundary?.exits[i]?.pressure ?? 1, temperature: 900,
  }));

  const compressors = splitBlocks(get('COMPRESSORS')).blocks.map((b, i) => ({ id: i + 1, label: label(b, `compressor ${i + 1}`) }));
  const turbines = splitBlocks(get('TURBINES')).blocks.map((b, i) => ({ id: i + 1, label: label(b, `turbine ${i + 1}`) }));

  // connections
  const connections: Connection[] = [];
  const cl = get('CONNECTIONS');
  const nConn = nums(cl[0])[0] || 0;
  for (let i = 0; i < nConn; i++) {
    const c = parseConnectionLine(cl[1 + i]);
    if (c) connections.push(c);
  }
  // Valve diameter from linked port.
  for (const c of connections) {
    const v = [c.a, c.b, ...c.via].find((r) => r.kind === 'valve');
    const p = [c.a, c.b, ...c.via].find((r) => r.kind === 'port');
    if (v && p) {
      const valve = valves.find((x) => x.id === v.id);
      const port = ports.find((x) => x.id === p.id);
      if (valve && port) valve.diameter = port.diameter;
    }
  }

  const model: EngineModel = {
    title: [header[0] ?? '', header[1] ?? ''],
    name: nameTok[0] ?? '',
    cycle,
    cylinders,
    fuel,
    burn,
    heatTransfer,
    temperatures: { ...DEFAULT_TEMPERATURES },
    friction: { ...DEFAULT_FRICTION },
    valves,
    ports,
    pipes,
    plenums,
    throttles,
    inlets,
    exits,
    compressors,
    turbines,
    connections,
    tests,
    layout: builderToLayout(get('BUILDER')),
  };
  return { model, blocks };
}

/** Parse the text of a Lotus Engine Simulation .sim file. */
export function parseSim(text: string): EngineModel {
  const f = splitSections(text);
  const { model } = parseSections(f.header, f.order, f.sections);
  model.raw = { [HEADER_KEY]: f.header, ...f.sections };
  model.rawOrder = f.order;
  return model;
}
