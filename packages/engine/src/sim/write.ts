// Lotus Engine Simulation .sim writer.
//
// Strategy: the model carries the raw text of the file it was parsed from (model.raw). On write, the
// baseline model is re-derived from that raw text. A section whose modelled data equals the baseline is
// written back verbatim; a changed section is regenerated item by item, where unchanged items keep their
// raw lines and changed items are re-emitted in the fixed-column format (using the old lines as a
// template for fields that are not modelled). Sections that are not modelled stay raw.
import type {
  Connection,
  Cylinder,
  ElementRef,
  EngineModel,
  Pipe,
  Plenum,
  Port,
  TestPoint,
  Throttle,
  Valve,
} from '../model';
import { builderSlice, writeBuilder } from './builder';
import {
  deepEqual, fE, fF, fG6, fI, fLoose, HEADER_KEY, nums, pad, splitBlocks, tokens,
} from './format';
import {
  C2K, DEFAULT_PIPE_FRICTION, DEFAULT_WIEBE2, defaultAnnand, defaultBurn, defaultWiebe, FUEL_CODES,
  KIND_KEYWORD, parseSections, stoichAfr,
} from './parse';

const CANONICAL = [
  'CYCLE', 'CYLINDER', 'FUEL', 'CSYS', 'BURN', 'HEAT', 'TEMPERATURE', 'PORTS', 'VALVES', 'PLENUMS', 'PIPES',
  'THROTTLE', 'COMPRESSORS', 'TURBINES', 'COOLER', 'INLETS', 'EXITS', 'LOSSJUNCTION', 'WIRES', 'VLINKS',
  'SBOUNDARIES', 'SHAFTS', 'DPROPERTIES', 'CONNECTIONS', 'LINKS', 'TESTS', 'LPOINT', 'TRANSIENTS', 'SENSORS',
  'TSENSORS', 'ACTUATORS', 'TPLOTS', 'CONTROLS', 'ICENGINES', 'SOLVER SETTINGS', 'USER ARGUMENTS', 'BUILDER',
];
const ALWAYS = new Set([
  'CYCLE', 'CYLINDER', 'FUEL', 'CSYS', 'BURN', 'HEAT', 'TEMPERATURE', 'INLETS', 'EXITS', 'DPROPERTIES',
  'CONNECTIONS', 'TESTS', 'ICENGINES', 'SOLVER SETTINGS', 'USER ARGUMENTS', 'BUILDER',
]);

const zeroRow = (n: number) => '     0.000000E+00' + '    0.000000E+00'.repeat(n - 1);
const TEMPLATES: Record<string, string[]> = {
  ICENGINES: ['    1', '$Default Detailed Eng', '    1'],
  'SOLVER SETTINGS': ['    2', '    1', '    0', '     0.5000     2.5000     0.2000     1.2000'],
  'USER ARGUMENTS': [
    '            6          20',
    ...[0, 1, 2, 3, 4, 5].flatMap(() => [zeroRow(7), zeroRow(7), zeroRow(6)]),
    ...Array(9).fill(' '),
  ],
};

/** Body of a test point block (after the label), used when there is no template. */
const TEST_TAIL = [
  '    0', '    0', '    0', '    1    2    2    2    1    0', '    0    1       0.0000    0    0',
  '    5    3       0.0000       0.0000', '    0    0    0    0',
];

interface Ctx {
  m: EngineModel;
  base?: EngineModel;
  blocks: Record<string, string[][]>;
  raw: Record<string, string[]>;
}

function emitItems<T>(
  items: T[],
  baseItems: T[] | undefined,
  blocks: string[][] | undefined,
  mk: (item: T, i: number, tmpl: string[] | undefined, base: T | undefined) => string[],
): string[] {
  const out: string[] = [];
  items.forEach((it, i) => {
    const bi = baseItems?.[i];
    const blk = blocks?.[i];
    if (bi !== undefined && blk && deepEqual(it, bi)) out.push(...blk);
    else out.push(...mk(it, i, blk, bi));
  });
  return out;
}

/** Count line (kept from the raw section when available, so extra header tokens survive). */
function head(ctx: Ctx, key: string, count: number, pre = 0, defaultRest: number[] = []): string[] {
  const rawHead = ctx.raw[key] ? splitBlocks(ctx.raw[key], pre).head : [];
  if (rawHead.length) {
    const rest = tokens(rawHead[0]).slice(1).map(Number);
    return [fI(count) + rest.map((v) => fI(v)).join(''), ...rawHead.slice(1)];
  }
  return [fI(count) + defaultRest.map((v) => fI(v)).join('')];
}

const lab = (s: string) => '$' + s;

// ---- item writers ------------------------------------------------------------------------------

function mkCylinder(c: Cylinder, _i: number, tmpl?: string[]): string[] {
  const g = [c.bore, c.stroke, c.conRod, c.pinOffset, c.compressionRatio, c.firingAngle].map((v) => fF(v, 13, 2)).join('');
  const ex = (c.extra ?? [0, 0, 1]).map((v) => fI(v)).join('');
  return [lab(c.label), g, ex, ...(tmpl ? tmpl.slice(3) : [])];
}

function mkPort(p: Port, _i: number, tmpl?: string[]): string[] {
  let type = p.extra?.[0] ?? 0;
  if (type !== 0 && !tmpl) type = 0;
  const nv = p.extra?.[1] ?? 1;
  const kind = p.kind === 'exhaust' ? 2 : 1;
  const tail = tmpl && nums(tmpl[1])[1] === type ? tmpl.slice(2) : [];
  return [lab(p.label), fI(kind) + fI(type) + fI(nv) + fF(p.diameter, 13, 3), ...tail];
}

function mkValve(m: EngineModel) {
  return (v: Valve, _i: number, tmpl?: string[], base?: Valve): string[] => {
    const type = v.extra?.[0] ?? 1;
    const kind = v.kind === 'exhaust' ? 2 : 1;
    if (type !== 1 && tmpl) return [lab(v.label), ...tmpl.slice(1)];
    const ex = v.extra ?? [];
    const curve = v.liftCurve && v.liftCurve.angle.length > 0 ? v.liftCurve : undefined;
    const liftOpt = curve ? 3 : ex[1] === 3 ? 0 : ex[1] ?? 0;
    const intake = v.kind === 'intake';
    const o = intake ? 360 - v.openAngle : 180 - v.openAngle;
    const c = intake ? v.closeAngle - 540 : v.closeAngle - 360;
    const computed = intake ? (-o + 180 + c) / 2 : (-180 - o + c) / 2;
    const same = base && base.openAngle === v.openAngle && base.closeAngle === v.closeAngle;
    const mop = same && ex[6] !== undefined ? ex[6] : curve ? 0 : computed;
    const line =
      fI(liftOpt) + fI(ex[2] ?? 0) + fF(o, 13, 1) + fF(c, 13, 1) + fF(ex[3] ?? 0, 13, 1) + fF(v.maxLift, 13, 3) +
      fF(ex[4] ?? 0, 13, 5) + fF(ex[5] ?? 0, 13, 5) + fF(mop, 13, 3);
    const out = [lab(v.label), fI(1) + fI(kind), line];
    if (curve) {
      out.push(fI(curve.angle.length));
      curve.angle.forEach((a, k) => out.push(fF(a - v.openAngle, 13, 1) + fF(curve.lift[k], 13, 6)));
    }
    void m;
    return out;
  };
}

function mkPlenum(p: Plenum, _i: number, tmpl?: string[]): string[] {
  const ex = p.extra ?? [1, 1, 0, 0, 0, 0];
  const type = ex[0];
  const data = ex.slice(2);
  let line: string;
  if (type === 2) {
    if (p.wallTemperature !== undefined) data[5] = p.wallTemperature - C2K;
    line = data.map((v) => fLoose(v)).join('');
  } else {
    while (data.length < 4) data.push(0);
    data[0] = p.volume / 1000;
    if (p.wallTemperature !== undefined) data[2] = p.wallTemperature - C2K;
    line = fF(data[0], 13, 4) + fF(data[1], 13, 2) + fF(data[2], 13, 4) + fE(data[3], 13, 6);
  }
  return [fI(type) + fI(ex[1] ?? 1), lab(p.label), line, ...(tmpl ? tmpl.slice(3) : [])];
}

function mkPipe(p: Pipe): string[] {
  const e = p.extra ?? [1, 2, 1, 0, 2, 0, 0, 0, 1, 1];
  const [cooling, material, thick, diffuser, fric0, meshMode, extT, extHtc, htType, tail] = e;
  let fricType = fric0;
  if (fricType !== 0 && Math.abs(p.frictionFactor - DEFAULT_PIPE_FRICTION) > 1e-9) fricType = 0;
  const nMesh = Math.max(1, Math.round(p.length / (p.meshLength > 0 ? p.meshLength : 14)));
  let h = fI(cooling) + fI(p.stations.length) + fF(thick, 13, 2) + fI(material) + fI(diffuser) + fI(fricType);
  if (fricType === 0) h += fF(p.frictionFactor, 13, 5);
  h += fI(nMesh) + fI(meshMode) + fF(extT, 13, 2) + fF(extHtc, 13, 2) + fI(htType, 9);
  return [
    lab(p.label), h, ...p.stations.map((s) => fF(s.x, 13, 2) + fF(s.d, 13, 2)), fI(tail),
  ];
}

function mkThrottle(t: Throttle, _i: number, tmpl?: string[]): string[] {
  const ex = t.extra ?? [1, 0, 0];
  if (ex[0] !== 1 && tmpl) return [lab(t.label), ...tmpl.slice(1)];
  const area = ((Math.PI / 4) * t.diameter * t.diameter) * (t.kind === 'area' ? t.position : 1);
  return [lab(t.label), ex.map((v) => fI(v)).join(''), fF(area, 13, 2), fF(t.cd, 13, 3)];
}

export function formatRef(r: ElementRef): string {
  const w = KIND_KEYWORD[r.kind] ?? r.kind.toUpperCase();
  return `${w} ${pad(String(r.id), 2)}` + (r.kind === 'pipe' ? `  ${r.end ?? 1}` : '');
}
export function formatConnection(c: Connection): string {
  return [c.a, c.b, ...c.via].map(formatRef).join('      ');
}

// ---- tests -------------------------------------------------------------------------------------

function mkTest(ctx: Ctx) {
  const { m, base } = ctx;
  const si = m.fuel.system === 'spark-ignition';
  const stoich = stoichAfr(m.fuel);
  const def = defaultBurn(m.fuel.system);
  const defPhase = si ? 10 : -def.start;
  const nIn0 = base?.inlets.length ?? 1;
  const nEx0 = base?.exits.length ?? 1;
  return (t: TestPoint, _i: number, tmpl?: string[], bt?: TestPoint): string[] => {
    const body = (tmpl ? tmpl.slice(1) : defaultTestBody(nIn0, nEx0)).slice();
    const labelLine = bt && bt.label === t.label && tmpl ? tmpl[0] : t.label === '' ? ' ' : t.label;
    const solve = t.extra?.[0] ?? 1;
    if (!bt || bt.speed !== t.speed) body[0] = fF(t.speed, 9, 2) + fI(solve, 7);
    if (!bt || bt.burnStart !== t.burnStart || bt.burnDuration !== t.burnDuration) {
      const value = si ? t.burnStart + t.burnDuration / 2 : -t.burnStart;
      if (Math.abs(value - defPhase) < 1e-9 && Math.abs(t.burnDuration - def.duration) < 1e-9) {
        body[1] = fI(0);
        body[2] = fI(0);
      } else {
        body[1] = fI(1) + fG6(value);
        body[2] = fI(1) + fG6(t.burnDuration);
      }
    }
    if (!bt || bt.afr !== t.afr) {
      const orig = body[3];
      const m2 = /^(\s*\d+)(\s+\S+)(.*)$/.exec(orig);
      const opt = si ? 2 : 1;
      const val = si ? stoich / t.afr : t.afr;
      body[3] = m2 ? fI(opt) + fG6(val) + m2[3] : fI(opt) + fG6(val) + fF(1, 13, 5) + fE(0.01, 17, 6);
    }
    const bd = t.boundary;
    const inl = bd?.inlets ?? m.inlets.map((b) => ({ pressure: b.pressure, temperature: b.temperature }));
    const exl = bd?.exits ?? m.exits.map((b) => ({ pressure: b.pressure }));
    const ambChanged =
      !bt || bt.ambientPressure !== t.ambientPressure || bt.ambientTemperature !== t.ambientTemperature ||
      bt.humidity !== t.humidity;
    const rest = body.slice(5 + nIn0 + nEx0);
    let b4 = body[4];
    if (ambChanged) {
      const hum = t.humidity ?? 0.013;
      b4 = fG6(t.ambientPressure) + fG6(t.ambientTemperature - C2K, 13) + fE(hum, 17, 6);
      if (bt && bt.humidity === t.humidity) {
        const mm = /^(\s*\S+\s+\S+)(.*)$/.exec(body[4]);
        if (mm) b4 = fG6(t.ambientPressure) + fG6(t.ambientTemperature - C2K, 13) + mm[2];
      }
    }
    const inLines = inl.map((r) => fG6(r.pressure) + fG6(r.temperature - C2K, 13));
    const exLines = exl.map((r) => fG6(r.pressure));
    const out = [labelLine, body[0], body[1], body[2], body[3], b4, ...inLines, ...exLines, ...rest];
    if (!bt || bt.maxCycles !== t.maxCycles) {
      const k = out.findIndex((l, idx) => idx > 5 && /^\s*1\s+\d+\s+\d+\s+\d+\s*$/.test(l));
      if (k >= 0) {
        const n = nums(out[k]);
        out[k] = fI(1) + fI(n[1]) + fI(t.maxCycles) + fI(Math.max(n[3], t.maxCycles), 5);
      }
    }
    return out;
  };
}

function defaultTestBody(nIn: number, nEx: number): string[] {
  return [
    '  1000.00      1', '    0', '    0', '    2  1.10000      1.00000     0.100000E-01',
    '  1.00000      20.0000     0.130000E-01',
    ...Array(nIn).fill('  1.00000      20.0000'),
    ...Array(nEx).fill('  1.00000'),
    ...TEST_TAIL,
  ];
}

// ---- section generators ------------------------------------------------------------------------

function resizeRows(rows: string[], n: number): string[] {
  if (!rows.length) return rows;
  const out = rows.slice(0, n);
  while (out.length < n) out.push(rows[rows.length - 1]);
  return out;
}

function resizeTemperature(lines: string[], nOld: number, nNew: number): string[] {
  const starts = lines.map((l, i) => (l.trim() === '-1' ? i : -1)).filter((i) => i >= 0);
  if (!starts.length) return lines;
  const out = lines.slice(0, starts[0]);
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const seg = lines.slice(s + 1, end);
    out.push(lines[s], ...resizeRows(seg.slice(0, nOld), nNew), ...seg.slice(nOld));
  });
  return out;
}

function defaultTemperature(n: number): string[] {
  const row = (a: string) => Array(n).fill(a);
  return [
    '    1        1.100        1.050         1.00   20',
    '   -1', ...row('    2    2    1'),
    '   -1', ...row('    1    1    1'),
    '   -1', ...row('    1    1    1'),
    '   -1', ...row('    1    1    1'),
  ];
}

function genSection(key: string, ctx: Ctx): string[] | undefined {
  const { m, base, blocks, raw } = ctx;
  switch (key) {
    case 'CYCLE':
      return [fI(m.cycle)];
    case 'CYLINDER': {
      const rawFirst = nums(raw.CYLINDER?.[0])[0];
      const sign = rawFirst > 0 ? 1 : -1;
      return [
        fI(sign * m.cylinders.length),
        ...emitItems(m.cylinders, base?.cylinders, blocks.CYLINDER, mkCylinder),
      ];
    }
    case 'FUEL': {
      const i = FUEL_CODES.indexOf(m.fuel.type);
      return [fI(i >= 0 ? i + 1 : m.fuel.type === 'user' ? 5 : 5)];
    }
    case 'CSYS':
      return [fI(m.fuel.system === 'direct-injection-diesel' ? 3 : m.fuel.system === 'indirect-injection-diesel' ? 4 : 2)];
    case 'BURN': {
      const b = m.burn;
      if (b.kind === 'wiebe2') {
        if (deepEqual({ ...b, kind: undefined }, { ...DEFAULT_WIEBE2, kind: undefined })) return [fI(2)];
        const delay = nums(raw.BURN?.[0])[6] ?? 0;
        return [
          fI(-2) + fF(b.a1, 13, 3) + fF(b.m1, 13, 3) + fF(b.a2, 13, 2) + fF(b.m2, 13, 1) +
            fF(b.premixFraction, 13, 2) + fF(delay, 13, 1),
        ];
      }
      const d = defaultWiebe(m.fuel.type);
      if (b.kind === 'wiebe' && (b.a !== d.a || b.m !== d.m)) return [fI(-1) + fF(b.a, 13, 3) + fF(b.m, 13, 3)];
      return [fI(1)];
    }
    case 'HEAT': {
      const h = m.heatTransfer;
      if (h.kind === 'woschni') return [fI(2), fI(2)];
      if (h.kind === 'eichelberg') return [fI(3), fI(3)];
      const d = defaultAnnand(m.fuel.system);
      if (h.kind === 'annand' && (h.a !== d.a || h.b !== d.b || h.c !== d.c))
        return [fI(1), fI(-1) + fF(h.a, 13, 3) + fF(h.b, 13, 3) + ' ' + fE(h.c, 12, 6)];
      return [fI(1), fI(1)];
    }
    case 'TEMPERATURE': {
      const nNew = m.cylinders.length;
      if (raw.TEMPERATURE) return resizeTemperature(raw.TEMPERATURE, base?.cylinders.length ?? nNew, nNew);
      return defaultTemperature(nNew);
    }
    case 'DPROPERTIES': {
      const nNew = m.cylinders.length;
      const row = '       0.00      0.00000      0.00000      0.00000      0.00000      0.00000';
      const r = raw.DPROPERTIES;
      if (!r) return ['    0', ...Array(nNew).fill(row)];
      const nOld = base?.cylinders.length ?? nNew;
      return [r[0], ...resizeRows(r.slice(1, 1 + nOld), nNew), ...r.slice(1 + nOld)];
    }
    case 'PORTS':
      return [
        ...head(ctx, key, m.ports.length),
        ...emitItems(m.ports, base?.ports, blocks.PORTS, mkPort),
      ];
    case 'VALVES':
      return [
        ...head(ctx, key, m.valves.length),
        ...emitItems(m.valves, base?.valves, blocks.VALVES, mkValve(m)),
      ];
    case 'PLENUMS':
      return [
        ...head(ctx, key, m.plenums.length, 1),
        ...emitItems(m.plenums, base?.plenums, blocks.PLENUMS, mkPlenum),
      ];
    case 'PIPES':
      return [
        ...head(ctx, key, m.pipes.length, 0, [0]),
        ...emitItems(m.pipes, base?.pipes, blocks.PIPES, mkPipe),
      ];
    case 'THROTTLE':
      return [
        ...head(ctx, key, m.throttles.length),
        ...emitItems(m.throttles, base?.throttles, blocks.THROTTLE, mkThrottle),
      ];
    case 'INLETS':
    case 'EXITS': {
      const items = key === 'INLETS' ? m.inlets : m.exits;
      const bItems = key === 'INLETS' ? base?.inlets : base?.exits;
      return [
        ...head(ctx, key, items.length),
        ...emitItems(items, bItems, blocks[key], (b, _i, tmpl) => [lab(b.label), ...(tmpl ? tmpl.slice(1) : [])]),
      ];
    }
    case 'CONNECTIONS':
      return [fI(m.connections.length), ...m.connections.map(formatConnection)];
    case 'TESTS':
      return [
        fI(m.tests.length),
        ...emitItems(m.tests, base?.tests, blocks.TESTS, mkTest(ctx)),
      ];
    case 'BUILDER':
      return writeBuilder(m, raw.BUILDER);
    default:
      return undefined;
  }
}

/** Model data that a section depends on; unchanged data means the raw section is reused. */
function sliceOf(key: string, m: EngineModel): unknown {
  switch (key) {
    case 'CYCLE': return m.cycle;
    case 'CYLINDER': return m.cylinders;
    case 'FUEL': return m.fuel.type;
    case 'CSYS': return m.fuel.system;
    case 'BURN': return [m.burn, m.fuel.type];
    case 'HEAT': return [m.heatTransfer, m.fuel.system];
    case 'TEMPERATURE':
    case 'DPROPERTIES': return m.cylinders.length;
    case 'PORTS': return m.ports;
    case 'VALVES': return [m.valves, m.cycle];
    case 'PLENUMS': return m.plenums;
    case 'PIPES': return m.pipes;
    case 'THROTTLE': return m.throttles;
    case 'INLETS': return m.inlets.map((b) => b.label);
    case 'EXITS': return m.exits.map((b) => b.label);
    case 'CONNECTIONS': return m.connections;
    case 'TESTS': return [m.tests, m.inlets.length, m.exits.length, m.fuel.type, m.fuel.system];
    case 'BUILDER': return builderSlice(m);
    default: return undefined;
  }
}

function sectionOrder(m: EngineModel): string[] {
  const order = (m.rawOrder ?? []).slice();
  const wanted = (k: string) =>
    ALWAYS.has(k) ||
    (k === 'PORTS' && m.ports.length > 0) || (k === 'VALVES' && m.valves.length > 0) ||
    (k === 'PLENUMS' && m.plenums.length > 0) || (k === 'PIPES' && m.pipes.length > 0) ||
    (k === 'THROTTLE' && m.throttles.length > 0);
  for (const k of CANONICAL) {
    if (order.includes(k) || !wanted(k)) continue;
    const ci = CANONICAL.indexOf(k);
    const at = order.findIndex((o) => CANONICAL.indexOf(o) > ci);
    if (at < 0) order.push(k);
    else order.splice(at, 0, k);
  }
  return order;
}

/** Serialise an engine model to .sim text (CRLF line endings). */
export function writeSim(model: EngineModel): string {
  const raw = model.raw ?? {};
  const hasRaw = !!raw[HEADER_KEY];
  const baseParsed = hasRaw ? parseSections(raw[HEADER_KEY], model.rawOrder ?? [], raw) : undefined;
  const base = baseParsed?.model;

  // Keep valve diameter and port throat diameter in step (valve edits win when the port is untouched).
  let m = model;
  if (base) {
    const ports = model.ports.map((p) => ({ ...p }));
    for (const c of model.connections) {
      const refs = [c.a, c.b, ...c.via];
      const vr = refs.find((r) => r.kind === 'valve');
      const pr = refs.find((r) => r.kind === 'port');
      if (!vr || !pr) continue;
      const v = model.valves.find((x) => x.id === vr.id);
      const bv = base.valves.find((x) => x.id === vr.id);
      const p = ports.find((x) => x.id === pr.id);
      const bp = base.ports.find((x) => x.id === pr.id);
      if (v && bv && p && bp && v.diameter !== bv.diameter && p.diameter === bp.diameter) p.diameter = v.diameter;
    }
    m = { ...model, ports };
  }

  const ctx: Ctx = { m, base, blocks: baseParsed?.blocks ?? {}, raw };
  const lines: string[] = [];

  // header: titles + name/version
  const bh = base;
  if (raw[HEADER_KEY] && bh && deepEqual([bh.title, bh.name], [m.title, m.name])) lines.push(...raw[HEADER_KEY]);
  else {
    const ver = tokens(raw[HEADER_KEY]?.[2])[1] ?? '515';
    lines.push(m.title[0] ?? '', m.title[1] ?? '', m.name.padEnd(16) + pad(ver, 4));
  }

  for (const key of sectionOrder(m)) {
    lines.push(key);
    const rawLines = raw[key];
    const slice = sliceOf(key, m);
    if (rawLines && base && (slice === undefined || deepEqual(slice, sliceOf(key, base)))) {
      lines.push(...rawLines);
      continue;
    }
    const gen = genSection(key, ctx);
    if (gen) lines.push(...gen);
    else if (rawLines) lines.push(...rawLines);
    else if (TEMPLATES[key]) lines.push(...TEMPLATES[key]);
    else lines.push(fI(0));
  }
  return lines.join('\r\n');
}
