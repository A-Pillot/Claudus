// Decoder for the turbo machinery and control sections of a .sim file.
//
// DECODED FIELD MAP (reverse engineered from tutorial_8..11; "?" = best guess)
// COMPRESSORS : `n`, per item `$label`, `1` (type: full map), `inDia outDia inertia gearRatio mechEff`,
//               `1` (? update speed by time step), `nSpeeds nPoints sSpeed sFlow sPR sEff`, then
//               nSpeeds x nPoints rows `speed massflow PR efficiency` (speed lines ascending; flow ascending).
//               Scale factors in the map header: speed, mass flow, pressure ratio, efficiency (help + tutorial 8).
// TURBINES    : same as compressors without the extra `1` line. Turbine speed is rpm/sqrt(K), flow kg sqrt(K)/s/kPa.
// COOLER      : `n`, per item `$label`, `nPoints`, rows `massflow(kg/s) pressureLoss(bar) coolantT(C) effectiveness`.
// SHAFTS      : `n`, per item `$label`, `inertia(kg m2)`, `0` (crankshaft for transients; kept for reference).
// LINKS       : `n`, lines `COMPRESSOR i TURBINE j` (elements on one shaft).
// SENSORS     : `$label`, header `class sub x y code x x element x x [x]`, then wiring lines (not decoded).
//               class/sub (2,2) plenum quantity, (2,1) engine, (1,3) turbocharger, (1,2) throttle; element = header[7].
// ACTUATORS   : `$label`, header `class sub ... element(header[5])`; (1,2) = throttle area (mm2), wiring not decoded.
// CONTROLS    : `nControls nExtra`, per item `$label`, `code`, data: 5 = 1D user function (Fortran string, F1..),
//               1 = 2D user function, 2 = limit (max, min), 6 = 1D lookup (`n 1`, n x (x, y)),
//               9 = integrator (`wrt period`; wrt 2 = crank degrees), 10 = limit change (`wrt type rate`).
//               The wiring (WIRES/VLINKS/SBOUNDARIES/BUILDER) is not decoded; the solver infers the chain, see
//               solver/turbo.ts.
import type {
  Actuator,
  Compressor,
  Control,
  Cooler,
  ElementKind,
  ElementRef,
  Sensor,
  Shaft,
  Turbine,
  TurboMap,
  TurboModel,
} from '../model';
import { nums, splitBlocks, tokens } from './format';

const C2K = 273.15;

function label(block: string[] | undefined, fallback: string): string {
  const l = block?.find((x) => x.startsWith('$'));
  return l ? l.slice(1) : fallback;
}

function parseMap(b: string[], headerIdx: number): TurboMap | undefined {
  const h = nums(b[headerIdx]);
  const nS = Math.round(h[0]);
  const nP = Math.round(h[1]);
  if (!(nS > 0 && nP > 0) || h.length < 6) return undefined;
  const map: TurboMap = {
    speed: [],
    flow: [],
    pr: [],
    eff: [],
    scale: { speed: h[2], flow: h[3], pr: h[4], eff: h[5] },
  };
  let r = headerIdx + 1;
  for (let s = 0; s < nS; s++) {
    const fl: number[] = [];
    const pr: number[] = [];
    const ef: number[] = [];
    for (let p = 0; p < nP; p++) {
      const row = nums(b[r++]);
      if (row.length < 4 || row.some((x) => !Number.isFinite(x))) return undefined;
      if (p === 0) map.speed.push(row[0]);
      fl.push(row[1]);
      pr.push(row[2]);
      ef.push(row[3]);
    }
    map.flow.push(fl);
    map.pr.push(pr);
    map.eff.push(ef);
  }
  return map;
}

export function parseCompressors(lines: string[]): Compressor[] {
  return splitBlocks(lines).blocks.map((b, i) => {
    const d = nums(b[2]);
    return {
      id: i + 1,
      label: label(b, `compressor ${i + 1}`),
      inletDia: d[0], outletDia: d[1], inertia: d[2], gearRatio: d[3], mechEff: d[4],
      map: parseMap(b, 4),
    };
  });
}

export function parseTurbines(lines: string[]): Turbine[] {
  return splitBlocks(lines).blocks.map((b, i) => {
    const d = nums(b[2]);
    return {
      id: i + 1,
      label: label(b, `turbine ${i + 1}`),
      inletDia: d[0], outletDia: d[1], inertia: d[2], gearRatio: d[3], mechEff: d[4],
      map: parseMap(b, 3),
    };
  });
}

function parseCoolers(lines: string[]): Cooler[] {
  return splitBlocks(lines).blocks.map((b, i) => {
    const n = Math.round(nums(b[1])[0] ?? 0);
    const c: Cooler = { id: i + 1, label: label(b, `cooler ${i + 1}`), massFlow: [], pressureLoss: [], coolantTemp: [], effectiveness: [] };
    for (let k = 0; k < n; k++) {
      const r = nums(b[2 + k]);
      if (r.length < 4) break;
      c.massFlow.push(r[0]);
      c.pressureLoss.push(r[1]);
      c.coolantTemp.push(r[2] + C2K);
      c.effectiveness.push(r[3]);
    }
    return c;
  });
}

function parseShafts(lines: string[]): Shaft[] {
  return splitBlocks(lines).blocks.map((b, i) => ({ id: i + 1, label: label(b, `shaft ${i + 1}`), inertia: nums(b[1])[0] ?? 0 }));
}

const KINDS: Record<string, ElementKind> = { COMPRESSOR: 'compressor', TURBINE: 'turbine', COOLER: 'cooler', PLENUM: 'plenum', CYLINDER: 'cylinder' };

function parseLinks(lines: string[]): { a: ElementRef; b: ElementRef }[] {
  const n = Math.round(nums(lines[0])[0] ?? 0);
  const out: { a: ElementRef; b: ElementRef }[] = [];
  for (let i = 0; i < n; i++) {
    const t = tokens(lines[1 + i]);
    const refs: ElementRef[] = [];
    for (let k = 0; k + 1 < t.length; k += 2) {
      const kind = KINDS[t[k]];
      const id = Number(t[k + 1]);
      if (kind && Number.isFinite(id)) refs.push({ kind, id });
    }
    if (refs.length >= 2) out.push({ a: refs[0], b: refs[1] });
  }
  return out;
}

function parseSensors(lines: string[]): Sensor[] {
  return splitBlocks(lines).blocks.map((b, i) => {
    const h = nums(b[1]);
    let quantity: Sensor['quantity'] = 'unknown';
    if (h[0] === 2 && h[1] === 2) quantity = 'plenum-pressure';
    else if (h[0] === 2 && h[1] === 1) quantity = 'engine-speed';
    else if (h[0] === 1 && h[1] === 3) quantity = 'turbo-speed';
    else if (h[0] === 1 && h[1] === 2) quantity = 'throttle-area';
    return { id: i + 1, label: label(b, `sensor ${i + 1}`), quantity, element: h[7] ?? 0, header: h };
  });
}

function parseActuators(lines: string[]): Actuator[] {
  return splitBlocks(lines).blocks.map((b, i) => {
    const h = nums(b[1]);
    const target: Actuator['target'] = h[0] === 1 && h[1] === 2 ? 'throttle-area' : 'unknown';
    return { id: i + 1, label: label(b, `actuator ${i + 1}`), target, element: h[5] ?? 0, header: h };
  });
}

function parseControls(lines: string[]): Control[] {
  const { blocks } = splitBlocks(lines);
  return blocks.map((b): Control => {
    const lab = label(b, 'control');
    const code = Math.round(nums(b[1])[0] ?? 0);
    const d = nums(b[2]);
    switch (code) {
      case 5:
        return { kind: 'function', label: lab, expr: (b[2] ?? '').trim(), dim: 1 };
      case 1:
        return { kind: 'function', label: lab, expr: (b[2] ?? '').trim(), dim: 2 };
      case 2:
        return { kind: 'limit', label: lab, max: d[0], min: d[1] };
      case 6: {
        const n = Math.round(d[0] ?? 0);
        const x: number[] = [];
        const y: number[] = [];
        for (let k = 0; k < n; k++) {
          const r = nums(b[3 + k]);
          if (r.length >= 2) { x.push(r[0]); y.push(r[1]); }
        }
        return { kind: 'lookup', label: lab, x, y };
      }
      case 9:
        return { kind: 'integrator', label: lab, wrt: d[0], period: d[1] };
      case 10:
        return { kind: 'limit-change', label: lab, wrt: d[0], type: d[1], rate: d[2] };
      default:
        return { kind: 'unknown', label: lab, code };
    }
  });
}

export interface ParsedTurbo {
  compressors: Compressor[];
  turbines: Turbine[];
  turbo?: TurboModel;
}

/** Decode all turbo related sections (given a section getter). `turbo` is undefined when the model has none. */
export function parseTurboSections(get: (key: string) => string[]): ParsedTurbo {
  const compressors = parseCompressors(get('COMPRESSORS'));
  const turbines = parseTurbines(get('TURBINES'));
  const coolers = parseCoolers(get('COOLER'));
  const shafts = parseShafts(get('SHAFTS'));
  const links = parseLinks(get('LINKS'));
  const sensors = parseSensors(get('SENSORS'));
  const actuators = parseActuators(get('ACTUATORS'));
  const controls = parseControls(get('CONTROLS'));
  const any = coolers.length + shafts.length + links.length + sensors.length + actuators.length + controls.length > 0;
  return { compressors, turbines, turbo: any ? { coolers, shafts, links, sensors, actuators, controls } : undefined };
}

// ---- Fortran style expressions for user function controls ---------------------------------------

type Fn = (args: number[]) => number;

const FUNCS: Record<string, (...a: number[]) => number> = {
  SQRT: Math.sqrt, ABS: Math.abs, EXP: Math.exp, LOG: Math.log, ALOG: Math.log, LOG10: Math.log10,
  SIN: Math.sin, COS: Math.cos, TAN: Math.tan, ATAN: Math.atan, MIN: Math.min, MAX: Math.max,
  SIGN: (a, b) => (b >= 0 ? Math.abs(a) : -Math.abs(a)), MOD: (a, b) => a % b,
};

/** Compile a Fortran-style arithmetic expression in F1, F2, ... Unknown input gives a function returning NaN. */
export function compileExpression(src: string): Fn {
  const s = src.replace(/\s+/g, '').toUpperCase();
  let pos = 0;
  const peek = () => s[pos];
  const fail = (): never => { throw new Error(`Bad expression: ${src}`); };

  const num = (): Fn => {
    const m = /^(\d+\.?\d*|\.\d+)([ED][+-]?\d+)?/.exec(s.slice(pos));
    if (!m) return fail();
    pos += m[0].length;
    const v = Number(m[0].replace('D', 'E'));
    return () => v;
  };
  const primary = (): Fn => {
    const c = peek();
    if (c === '(') {
      pos++;
      const e = add();
      if (peek() !== ')') fail();
      pos++;
      return e;
    }
    if (c === '-') { pos++; const e = power(); return (a) => -e(a); }
    if (c === '+') { pos++; return power(); }
    if (c !== undefined && /[A-Z]/.test(c)) {
      const m = /^[A-Z][A-Z0-9]*/.exec(s.slice(pos))!;
      pos += m[0].length;
      const fm = /^F(\d+)$/.exec(m[0]);
      if (fm) { const k = Number(fm[1]) - 1; return (a) => a[k] ?? 0; }
      const f = FUNCS[m[0]];
      if (!f || peek() !== '(') return fail();
      pos++;
      const args: Fn[] = [add()];
      while (peek() === ',') { pos++; args.push(add()); }
      if (peek() !== ')') fail();
      pos++;
      return (a) => f(...args.map((g) => g(a)));
    }
    return num();
  };
  const power = (): Fn => {
    const base = primary();
    if (s.startsWith('**', pos) || peek() === '^') {
      pos += peek() === '^' ? 1 : 2;
      const ex = power(); // right associative
      return (a) => Math.pow(base(a), ex(a));
    }
    return base;
  };
  const mul = (): Fn => {
    let l = power();
    while (peek() === '*' && s[pos + 1] !== '*' || peek() === '/') {
      const op = s[pos++];
      const r = power();
      const ll = l;
      l = op === '*' ? (a) => ll(a) * r(a) : (a) => ll(a) / r(a);
    }
    return l;
  };
  function add(): Fn {
    let l = mul();
    while (peek() === '+' || peek() === '-') {
      const op = s[pos++];
      const r = mul();
      const ll = l;
      l = op === '+' ? (a) => ll(a) + r(a) : (a) => ll(a) - r(a);
    }
    return l;
  }
  try {
    const f = add();
    if (pos !== s.length) return () => NaN;
    return f;
  } catch {
    return () => NaN;
  }
}
