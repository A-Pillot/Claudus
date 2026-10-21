// Builds the simulation network from an EngineModel: every pipe end joins a 0D node
// (cylinder, plenum, junction or ambient boundary), and nodes without a pipe between them
// are linked directly through an orifice (valve, throttle or plain opening).
import type { EngineModel, ElementRef, Pipe, Plenum, Valve } from '../model';
import { crankVolume } from './twostroke';
import { Pipe1D } from '../pipes/index';
import {
  Volume0D,
  cylinderGeometry,
  cylinderVolume,
  throttleEffectiveArea,
  valveEffectiveArea,
  fuelDefaults,
} from '../thermo/index';

export const R_AIR = 287.05;

export type NodeKind = 'cylinder' | 'plenum' | 'junction' | 'boundary';

export interface SimNode {
  key: string;
  kind: NodeKind;
  /** Element id in the model (cylinder/plenum/inlet/exit id); junction index for junctions. */
  id: number;
  label: string;
  /** Present for cylinders, plenums and junctions. */
  vol?: Volume0D;
  /** Fixed state for ambient boundaries (SI). */
  fixed?: { p: number; T: number; burnt: number };
  boundaryKind?: 'inlet' | 'exit';
  /** Varying-volume plenum (crankcase): volume follows the crank angle. */
  crank?: Plenum;
  /** Burnt fraction of gas leaving the node when it differs from the mixed state (scavenging models). */
  outBurnt?: number;
}

/** How the flow area of a link or pipe end is set. */
export type AreaSource =
  | { kind: 'open' } // full pipe area
  | { kind: 'fixed'; area: number } // m^2
  | { kind: 'valve'; valve: Valve; cylinder: number; count: number } // area follows valve lift; count = valves in the port
  | { kind: 'throttle'; throttleId: number };

export interface PipeEnd {
  pipeIndex: number;
  end: 1 | 2;
  node: number; // index into nodes, -1 = closed end
  area: AreaSource;
}

export interface NodeLink {
  a: number; // node index
  b: number;
  area: AreaSource;
  label: string;
  /** Set when the link carries a compressor, turbine or charge cooler (flow a -> b is the through-flow direction). */
  machine?: { kind: 'compressor' | 'turbine' | 'cooler'; id: number };
}

export interface SimPipe {
  model: Pipe;
  solver: Pipe1D;
  ends: [PipeEnd, PipeEnd];
}

export interface Network {
  nodes: SimNode[];
  pipes: SimPipe[];
  links: NodeLink[];
  warnings: string[];
}

const mm = (v: number) => v / 1000;

function refKey(r: ElementRef): string {
  return `${r.kind}:${r.id}`;
}

/** Diameter (m) along a pipe at x (m) from end 1, interpolating the stations. */
export function pipeDiameterAt(pipe: Pipe, xM: number): number {
  const st = pipe.stations.length > 0 ? pipe.stations : [{ x: 0, d: 40 }];
  const x = xM * 1000;
  if (x <= st[0].x) return mm(st[0].d);
  for (let i = 1; i < st.length; i++) {
    if (x <= st[i].x) {
      const t = (x - st[i - 1].x) / Math.max(st[i].x - st[i - 1].x, 1e-9);
      return mm(st[i - 1].d + t * (st[i].d - st[i - 1].d));
    }
  }
  return mm(st[st.length - 1].d);
}

export interface BuildOptions {
  ambientP: number; // Pa
  ambientT: number; // K
  /** Maximum cell length (m) when the model's mesh is coarser; speeds up nothing, refines accuracy. */
  maxCellLength?: number;
}

export function buildNetwork(model: EngineModel, opts: BuildOptions): Network {
  const warnings: string[] = [];
  const nodes: SimNode[] = [];
  const nodeIndex = new Map<string, number>();
  const fuel = model.fuel ?? fuelDefaults('gasoline');

  const addNode = (n: SimNode) => {
    nodeIndex.set(n.key, nodes.length);
    nodes.push(n);
    return nodes.length - 1;
  };

  for (const c of model.cylinders) {
    const V = cylinderVolume(c, 360); // start at gas-exchange TDC region, refined at run start
    addNode({
      key: `cylinder:${c.id}`,
      kind: 'cylinder',
      id: c.id,
      label: c.label || `Cylinder ${c.id}`,
      vol: new Volume0D({ V, p: opts.ambientP, T: opts.ambientT, burnt: 0.1, fuel }),
    });
  }
  for (const p of model.plenums) {
    addNode({
      key: `plenum:${p.id}`,
      kind: 'plenum',
      id: p.id,
      label: p.label || `Plenum ${p.id}`,
      vol: new Volume0D({ V: p.varying ? crankVolume(p, 0) : Math.max(p.volume, 1) * 1e-6, p: opts.ambientP, T: opts.ambientT, burnt: 0, fuel }),
      ...(p.varying ? { crank: p } : {}),
    });
  }
  for (const b of model.inlets) {
    addNode({
      key: `inlet:${b.id}`,
      kind: 'boundary',
      id: b.id,
      label: b.label || `Inlet ${b.id}`,
      boundaryKind: 'inlet',
      fixed: { p: b.pressure > 0 ? b.pressure * 1e5 : opts.ambientP, T: b.temperature > 0 ? b.temperature : opts.ambientT, burnt: 0 },
    });
  }
  for (const b of model.exits) {
    addNode({
      key: `exit:${b.id}`,
      kind: 'boundary',
      id: b.id,
      label: b.label || `Exit ${b.id}`,
      boundaryKind: 'exit',
      fixed: { p: b.pressure > 0 ? b.pressure * 1e5 : opts.ambientP, T: b.temperature > 0 ? b.temperature : opts.ambientT, burnt: 1 },
    });
  }

  // Pipes and their ends (closed until a connection says otherwise).
  const pipeIndex = new Map<number, number>();
  const pipes: SimPipe[] = [];
  for (const p of model.pipes) {
    const length = Math.max(mm(p.length), 0.005);
    const cell = Math.min(Math.max(mm(p.meshLength || 20), 0.004), opts.maxCellLength ?? 1);
    const solver = new Pipe1D({
      length,
      diameterAt: (x) => pipeDiameterAt(p, x),
      cellLength: Math.min(cell, length / 2),
      gamma: 1.4,
      R: R_AIR,
      wallTemperature: p.wallTemperature > 0 ? p.wallTemperature : 320,
      frictionFactor: p.frictionFactor > 0 ? p.frictionFactor : 0.005,
      heatTransfer: true,
      initial: { p: opts.ambientP, T: opts.ambientT },
    });
    pipeIndex.set(p.id, pipes.length);
    const idx = pipes.length;
    pipes.push({
      model: p,
      solver,
      ends: [
        { pipeIndex: idx, end: 1, node: -1, area: { kind: 'open' } },
        { pipeIndex: idx, end: 2, node: -1, area: { kind: 'open' } },
      ],
    });
  }

  const links: NodeLink[] = [];
  // Union-find over pipe ends joined directly to each other: each group becomes a junction node.
  const endKey = (pi: number, e: 1 | 2) => pi * 2 + (e - 1);
  const parent = new Map<number, number>();
  const find = (k: number): number => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: number, b: number) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const junctionEndArea = new Map<number, AreaSource>();

  const areaFromVia = (via: ElementRef[], cylinderId: number | null): AreaSource => {
    const valveRef = via.find((v) => v.kind === 'valve');
    if (valveRef) {
      const valve = model.valves.find((v) => v.id === valveRef.id);
      const portRef = via.find((v) => v.kind === 'port');
      const port = portRef ? model.ports.find((p) => p.id === portRef.id) : undefined;
      const count = Math.max(1, Math.round(port?.extra?.[1] ?? 1));
      if (valve) return { kind: 'valve', valve, cylinder: cylinderId ?? model.cylinders[0]?.id ?? 1, count };
    }
    const thr = via.find((v) => v.kind === 'throttle');
    if (thr) return { kind: 'throttle', throttleId: thr.id };
    return { kind: 'open' };
  };

  const isNodeKind = (r: ElementRef) => r.kind === 'cylinder' || r.kind === 'plenum' || r.kind === 'inlet' || r.kind === 'exit';

  for (const conn of model.connections) {
    const { a, b, via } = conn;
    const cylId = a.kind === 'cylinder' ? a.id : b.kind === 'cylinder' ? b.id : null;
    const area = areaFromVia(via, cylId);
    if (a.kind === 'pipe' && b.kind === 'pipe') {
      const pa = pipeIndex.get(a.id);
      const pb = pipeIndex.get(b.id);
      if (pa === undefined || pb === undefined) {
        warnings.push(`Connection refers to a missing pipe (${a.id} or ${b.id}).`);
        continue;
      }
      const ka = endKey(pa, a.end ?? 1);
      const kb = endKey(pb, b.end ?? 1);
      union(ka, kb);
      if (area.kind !== 'open') junctionEndArea.set(kb, area);
      continue;
    }
    const pipeRef = a.kind === 'pipe' ? a : b.kind === 'pipe' ? b : null;
    const other = pipeRef === a ? b : a;
    if (pipeRef) {
      const pi = pipeIndex.get(pipeRef.id);
      const ni = nodeIndex.get(refKey(other));
      if (pi === undefined || ni === undefined) {
        if (other.kind === 'compressor' || other.kind === 'turbine' || other.kind === 'cooler') {
          warnings.push(`${other.kind} ${other.id} is not simulated yet; pipe ${pipeRef.id} end ${pipeRef.end ?? 1} is treated as closed.`);
        } else {
          warnings.push(`Connection ${refKey(a)} - ${refKey(b)} could not be resolved.`);
        }
        continue;
      }
      const pe = pipes[pi].ends[(pipeRef.end ?? 1) - 1];
      pe.node = ni;
      pe.area = area;
      continue;
    }
    if (isNodeKind(a) && isNodeKind(b)) {
      const na = nodeIndex.get(refKey(a));
      const nb = nodeIndex.get(refKey(b));
      if (na === undefined || nb === undefined) {
        warnings.push(`Connection ${refKey(a)} - ${refKey(b)} could not be resolved.`);
        continue;
      }
      let la = area;
      if (la.kind === 'open') la = { kind: 'fixed', area: Math.PI * 0.025 * 0.025 };
      const mach = via.find((v) => v.kind === 'compressor' || v.kind === 'turbine' || v.kind === 'cooler');
      links.push({
        a: na, b: nb, area: la, label: `${nodes[na].label} - ${nodes[nb].label}`,
        ...(mach ? { machine: { kind: mach.kind as 'compressor' | 'turbine' | 'cooler', id: mach.id } } : {}),
      });
      continue;
    }
    warnings.push(`Connection ${refKey(a)} - ${refKey(b)} involves elements that are not simulated yet.`);
  }

  // Create junction nodes for groups of directly connected pipe ends.
  const groups = new Map<number, number[]>();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(k);
  }
  let jid = 0;
  for (const members of groups.values()) {
    jid++;
    let volume = 0;
    let T = opts.ambientT;
    for (const k of members) {
      const pi = Math.floor(k / 2);
      const e = ((k % 2) + 1) as 1 | 2;
      const sp = pipes[pi];
      const area = sp.solver.endArea(e);
      const cell = sp.solver.length / sp.solver.nCells;
      volume += area * cell;
    }
    const ni = addNode({
      key: `junction:${jid}`,
      kind: 'junction',
      id: jid,
      label: `Junction ${jid}`,
      vol: new Volume0D({ V: Math.max(volume, 1e-7), p: opts.ambientP, T, burnt: 0, fuel }),
    });
    for (const k of members) {
      const pi = Math.floor(k / 2);
      const e = ((k % 2) + 1) as 1 | 2;
      const pe = pipes[pi].ends[e - 1];
      pe.node = ni;
      pe.area = junctionEndArea.get(k) ?? { kind: 'open' };
    }
  }

  for (const sp of pipes) {
    for (const pe of sp.ends) {
      if (pe.node < 0) warnings.push(`Pipe ${sp.model.id} end ${pe.end} is not connected (treated as closed).`);
    }
  }
  for (const kind of ['compressor', 'turbine'] as const) {
    const list = kind === 'compressor' ? model.compressors : model.turbines;
    for (const e of list) {
      if (!links.some((l) => l.machine?.kind === kind && l.machine.id === e.id)) {
        warnings.push(`${kind} ${e.id} is not connected between two nodes; ignored.`);
      }
    }
  }
  return { nodes, pipes, links, warnings };
}
