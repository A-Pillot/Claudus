// Engine cycle simulation: steps pipes and 0D nodes together in time, cycle after cycle,
// until the indicated work converges, then summarises the last cycle.
import type { Cylinder, EngineModel, TestPoint, Valve } from '../model';
import type { CylinderSummary, CylinderTrace, PipeTrace, PlenumTrace, SweepResult, TestPointResult } from '../results';
import type { NodeBoundary } from '../pipes/index';
import {
  burnFraction,
  chenFlynnFmep,
  cylinderGeometry,
  cylinderVolume,
  defaultFriction,
  enthalpy,
  flowBetween,
  fuelDefaults,
  gasProps,
  heatTransferCoeff,
  linerArea,
  meanPistonSpeed,
  stoichAfr,
  throttleEffectiveArea,
  valveEffectiveArea,
  valveLift,
  type GasProps,
} from '../thermo/index';
import { buildNetwork, type AreaSource, type Network, type SimNode } from './network';
import { createTurbo, type TurboSystem } from './turbo';
import { crankVolume, isTwoStrokeValve, scavengeOutBurnt, stepReed, twoStrokeArea, twoStrokeLift, type ReedState } from './twostroke';

export interface SimulateOptions {
  /** Indices of model.tests to run; default all. */
  points?: number[];
  onProgress?: (fraction: number, message: string) => void;
  /** Override cycle limits. */
  maxCycles?: number;
  minCycles?: number;
  /** Store pipe profiles every N degrees for the pipe display (0 = off). */
  profileEvery?: number;
}

interface CylState {
  cyl: Cylinder;
  node: SimNode;
  Vd: number;
  bore: number;
  pistonArea: number;
  fuelMass: number; // kg this cycle
  freshAtStart: number; // fresh charge mass when combustion starts
  burnedSoFar: number;
  combusting: boolean;
  ivcState: { p: number; V: number; T: number } | null;
  workTotal: number; // J over current cycle (p dV)
  workPumping: number;
  peakP: number;
  peakAngle: number;
  airIn: number; // kg delivered through intake valves this cycle (net, fresh)
  trapped: number;
  residual: number;
  intakeClose: number;
}

const DEG_GRID = 1;

function wrap(a: number, cyc: number): number {
  const r = a % cyc;
  return r < 0 ? r + cyc : r;
}

function inWindow(theta: number, open: number, close: number, cyc: number): boolean {
  const t = wrap(theta - open, cyc);
  const w = wrap(close - open, cyc);
  return t <= w;
}

function nodeGas(n: SimNode, fuelGas: (T: number, b: number) => GasProps): { p: number; T: number; gas: GasProps; burnt: number } {
  if (n.fixed) return { p: n.fixed.p, T: n.fixed.T, gas: fuelGas(n.fixed.T, n.fixed.burnt), burnt: n.fixed.burnt };
  const v = n.vol!;
  return { p: v.p, T: v.T, gas: fuelGas(v.T, v.burnt), burnt: n.outBurnt ?? v.burnt };
}

export function simulatePoint(model: EngineModel, test: TestPoint, opts: SimulateOptions = {}, progress?: (f: number) => void): TestPointResult {
  const cycleDeg = model.cycle === 2 ? 360 : 720;
  const fuel = model.fuel ?? fuelDefaults('gasoline');
  const ambientP = (test.ambientPressure > 0 ? test.ambientPressure : 1.01325) * 1e5;
  const ambientT = test.ambientTemperature > 0 ? test.ambientTemperature : 298;
  const net: Network = buildNetwork(model, { ambientP, ambientT });
  const warnings = [...net.warnings];
  const rpm = Math.max(test.speed, 100);
  const degPerSec = rpm * 6;
  const afr = test.afr > 0 ? test.afr : stoichAfr(fuel);
  const lhv = fuel.lowerHeatingValue > 0 ? fuel.lowerHeatingValue : 43e6;
  const combEff = afr >= stoichAfr(fuel) ? 0.98 : Math.max(0.5, 0.98 * (afr / stoichAfr(fuel)));
  const burnDuration = test.burnDuration > 0 ? test.burnDuration : 50;
  const burnStart = Number.isFinite(test.burnStart) ? test.burnStart : -20;
  const temps = model.temperatures;
  const friction = model.friction ?? defaultFriction();
  const maxCycles = opts.maxCycles ?? (test.maxCycles > 0 ? test.maxCycles : 12);
  const minCycles = Math.min(opts.minCycles ?? 3, maxCycles);
  const tol = test.tolerance > 0 ? test.tolerance : 0.01;
  const profileEvery = opts.profileEvery ?? 5;
  const fuelGas = (T: number, b: number) => gasProps(T, b, fuel);

  let turbo: TurboSystem | undefined; // turbo machinery, created once the grid size is known
  const throttleArea = (id: number): number => {
    const t = model.throttles.find((x) => x.id === id);
    if (!t) return 0;
    const forced = turbo?.throttleArea(id);
    if (forced !== undefined) return forced;
    const pos = test.throttle?.[id];
    return throttleEffectiveArea(pos === undefined ? t : { ...t, position: pos });
  };

  // Cylinder bookkeeping.
  const cyls: CylState[] = [];
  for (const n of net.nodes) {
    if (n.kind !== 'cylinder') continue;
    const cyl = model.cylinders.find((c) => c.id === n.id)!;
    const g = cylinderGeometry(cyl);
    const intakeValves = model.valves.filter((v) => v.kind === 'intake');
    cyls.push({
      cyl,
      node: n,
      Vd: g.displacement,
      bore: cyl.bore / 1000,
      pistonArea: g.area,
      fuelMass: 0,
      freshAtStart: 0,
      burnedSoFar: 0,
      combusting: false,
      ivcState: null,
      workTotal: 0,
      workPumping: 0,
      peakP: 0,
      peakAngle: 0,
      airIn: 0,
      trapped: 0,
      residual: 0,
      intakeClose: intakeValves[0]?.closeAngle ?? 580,
    });
  }
  const cylByNode = new Map<SimNode, CylState>();
  for (const c of cyls) cylByNode.set(c.node, c);
  // Exact intake close angle per cylinder from its own valves.
  const cylValves = new Map<number, Valve[]>();
  const addValve = (cylId: number, v: Valve) => {
    const list = cylValves.get(cylId) ?? [];
    if (!list.includes(v)) list.push(v);
    cylValves.set(cylId, list);
  };
  for (const sp of net.pipes) for (const pe of sp.ends) if (pe.area.kind === 'valve') addValve(pe.area.cylinder, pe.area.valve);
  for (const l of net.links) if (l.area.kind === 'valve') addValve(l.area.cylinder, l.area.valve);
  for (const c of cyls) {
    const iv = (cylValves.get(c.cyl.id) ?? []).find((v) => v.kind === 'intake');
    if (iv) c.intakeClose = iv.closeAngle;
    // Two-stroke: the charge is trapped when the last port closes (normally the exhaust port).
    if (model.cycle === 2) {
      for (const v of cylValves.get(c.cyl.id) ?? []) if (v.closeAngle > c.intakeClose && v.closeAngle < cycleDeg) c.intakeClose = v.closeAngle;
    }
  }

  const thetaOf = (c: Cylinder, g: number) => wrap(g - c.firingAngle, cycleDeg);

  // Start each cylinder at the right volume.
  for (const c of cyls) {
    const v = c.node.vol!;
    v.V = cylinderVolume(c.cyl, thetaOf(c.cyl, 0));
    v.m = (v.p * v.V) / (fuelGas(v.T, v.burnt).R * v.T);
  }
  // Two-stroke state: crankcase volumes, reed petals, scavenge ratio and delivered mass.
  for (const n of net.nodes) {
    if (!n.crank) continue;
    n.vol!.V = crankVolume(n.crank, 0);
    n.vol!.m = (n.vol!.p * n.vol!.V) / (fuelGas(n.vol!.T, n.vol!.burnt).R * n.vol!.T);
  }
  const reeds = new Map<Valve, ReedState>();
  const reedBinds: { valve: Valve; intake: boolean; pipe?: { sp: (typeof net.pipes)[number]; end: 1 | 2; node: number }; a?: number; b?: number }[] = [];
  for (const sp of net.pipes) for (const pe of sp.ends) {
    if (pe.area.kind === 'valve' && pe.area.valve.type === 'reed' && pe.node >= 0) {
      reeds.set(pe.area.valve, { x: 0, v: 0 });
      reedBinds.push({ valve: pe.area.valve, intake: pe.area.valve.kind === 'intake', pipe: { sp, end: pe.end, node: pe.node } });
    }
  }
  for (const l of net.links) {
    if (l.area.kind === 'valve' && l.area.valve.type === 'reed') {
      reeds.set(l.area.valve, { x: 0, v: 0 });
      const flip = l.area.valve.kind === 'intake' && net.nodes[l.a].kind === 'cylinder';
      reedBinds.push({ valve: l.area.valve, intake: true, a: flip ? l.b : l.a, b: flip ? l.a : l.b });
    }
  }
  const updateReeds = (dt: number) => {
    for (const rb of reedBinds) {
      let dp: number;
      if (rb.pipe) {
        const pp = rb.pipe.sp.solver.sample(rb.pipe.end === 1 ? 0 : 1).p;
        const pn = net.nodes[rb.pipe.node].vol!.p;
        dp = rb.intake ? pp - pn : pn - pp;
      } else dp = nodeGas(net.nodes[rb.a!], fuelGas).p - nodeGas(net.nodes[rb.b!], fuelGas).p;
      stepReed(rb.valve.reed!, reeds.get(rb.valve)!, dp, dt);
    }
  };
  const liftOf = (v: Valve, th: number) => (isTwoStrokeValve(v) ? twoStrokeLift(v, th, reeds.get(v)) : valveLift(v, th, cycleDeg));
  const scavIn = new Float64Array(cyls.length); // fresh mass delivered to each cylinder since its TDC, kg
  let delivered = 0; // net mass into crankcases this cycle, kg
  let lastDelivered = 0;

  const areaOf = (src: AreaSource, pipeArea: number, gAngle: number): number => {
    switch (src.kind) {
      case 'open':
        return pipeArea;
      case 'fixed':
        return src.area;
      case 'throttle':
        return Math.min(throttleArea(src.throttleId), pipeArea || Infinity);
      case 'valve': {
        const c = model.cylinders.find((x) => x.id === src.cylinder);
        const th = c ? thetaOf(c, gAngle) : gAngle;
        if (isTwoStrokeValve(src.valve)) return src.count * twoStrokeArea(src.valve, th, reeds.get(src.valve));
        return src.count * valveEffectiveArea(src.valve, th, cycleDeg);
      }
    }
  };

  // Per-node flow accumulators for one step.
  const nNodes = net.nodes.length;
  const flowStreams: { mdot: number; h: number; burnt: number }[][] = Array.from({ length: nNodes }, () => []);
  const lastNet = new Float64Array(nNodes);

  // Trace recorders for the last cycle.
  const nGrid = Math.round(cycleDeg / DEG_GRID);
  const mkArr = () => new Array<number>(nGrid).fill(NaN);
  turbo = createTurbo(model, net, { rpm, cycleDeg, fuel, nodeState: (n) => nodeGas(n, fuelGas), nGrid });
  if (turbo) warnings.push(...turbo.warnings);
  interface CylRec {
    p: number[]; T: number[]; V: number[]; mfb: number[]; hr: number[]; ht: number[]; mi: number[]; me: number[]; li: number[]; le: number[];
  }
  let cylRec: CylRec[] = [];
  let pipeRec: { ps: number[]; pm: number[]; pe: number[]; us: number[]; um: number[]; ue: number[]; ts: number[]; tm: number[]; te: number[] }[] = [];
  let plenRec: { p: number[]; T: number[] }[] = [];
  let profiles = undefined as TestPointResult['profiles'];
  const resetRecorders = () => {
    cylRec = cyls.map(() => ({ p: mkArr(), T: mkArr(), V: mkArr(), mfb: mkArr(), hr: mkArr(), ht: mkArr(), mi: mkArr(), me: mkArr(), li: mkArr(), le: mkArr() }));
    pipeRec = net.pipes.map(() => ({ ps: mkArr(), pm: mkArr(), pe: mkArr(), us: mkArr(), um: mkArr(), ue: mkArr(), ts: mkArr(), tm: mkArr(), te: mkArr() }));
    plenRec = net.nodes.filter((n) => n.kind === 'plenum').map(() => ({ p: mkArr(), T: mkArr() }));
    turbo?.resetTraces();
    profiles = profileEvery > 0 ? { angle: [], pipes: net.pipes.map((sp) => ({ id: sp.model.id, x: [] as number[], p: [] as number[][], u: [] as number[][], T: [] as number[][] })) } : undefined;
  };
  resetRecorders();

  // Per-cylinder step quantities (for traces).
  const stepHR = new Float64Array(cyls.length);
  const stepHT = new Float64Array(cyls.length);
  const stepMI = new Float64Array(cyls.length);
  const stepME = new Float64Array(cyls.length);

  let gAngle = 0;
  let cycle = 0;
  let prevImep = NaN;
  let converged = false;
  let recording = false;
  let lastSummary: { imepCyl: number[]; pmepCyl: number[]; peak: { p: number; a: number }[]; airIn: number[]; trapped: number[]; residual: number[]; fuel: number[] } | null = null;
  const totalVd = cyls.reduce((s, c) => s + c.Vd, 0);
  const rhoAmb = ambientP / (287.05 * ambientT);
  let steps = 0;
  const maxSteps = 4e6;
  let nextGrid = 0;
  let nextProfile = 0;

  // Re-tune pipe gas properties from their current mean state once per cycle.
  const pipeCp = new Map<(typeof net.pipes)[number], number>();
  const retunePipes = () => {
    for (const sp of net.pipes) {
      const s = sp.solver.sample(0.5);
      const g = fuelGas(s.T, s.burnt);
      sp.solver.setGas(g.gamma, g.R);
      pipeCp.set(sp, (g.gamma * g.R) / (g.gamma - 1));
    }
  };
  retunePipes();

  while (cycle < maxCycles && steps < maxSteps) {
    // Time step: pipe CFL, at most 1 deg crank, and the 25 % node mass rule.
    let dt = 1 / degPerSec;
    for (const sp of net.pipes) dt = Math.min(dt, sp.solver.maxStableDt(0.7));
    for (let i = 0; i < nNodes; i++) {
      const v = net.nodes[i].vol;
      if (v && Math.abs(lastNet[i]) > 0) dt = Math.min(dt, (0.25 * v.m) / Math.abs(lastNet[i]));
    }
    dt = Math.max(dt, 1e-8);
    const dTheta = dt * degPerSec;
    const gNew = gAngle + dTheta;

    for (let i = 0; i < nNodes; i++) flowStreams[i].length = 0;
    updateReeds(dt);
    if (model.scavenge && model.scavenge.kind !== 'perfect-mixing') {
      cyls.forEach((cs, ci) => {
        cs.node.outBurnt = scavengeOutBurnt(model.scavenge, cs.node.vol!.burnt, scavIn[ci] / Math.max(rhoAmb * cs.Vd, 1e-12));
      });
    }
    stepMI.fill(0);
    stepME.fill(0);

    // Pipes.
    for (const sp of net.pipes) {
      const bcs: NodeBoundary[] = [];
      for (const pe of sp.ends) {
        const pipeArea = sp.solver.endArea(pe.end);
        if (pe.node < 0) {
          bcs.push({ p0: ambientP, T0: ambientT, gamma: 1.4, R: 287.05, burnt: 0, effArea: 0 });
          continue;
        }
        const ng = nodeGas(net.nodes[pe.node], fuelGas);
        bcs.push({ p0: ng.p, T0: ng.T, gamma: ng.gas.gamma, R: ng.gas.R, burnt: ng.burnt, effArea: Math.max(0, areaOf(pe.area, pipeArea, gAngle)) });
      }
      const flux = sp.solver.step(dt, bcs[0], bcs[1]);
      const fl = [flux.end1, flux.end2];
      for (let k = 0; k < 2; k++) {
        const pe = sp.ends[k];
        if (pe.node < 0) continue;
        const f = fl[k];
        if (f.mdot === 0) continue;
        // Into the node is the negative of into the pipe.
        const mdot = -f.mdot;
        if (net.nodes[pe.node].crank) delivered += mdot * dt;
        const burntS = Math.min(1, Math.max(0, f.burntFlux / f.mdot));
        // The pipe's energy is cp*T based (zero at 0 K); convert via the stream's stagnation temperature.
        const T0s = f.hFlux / f.mdot / (pipeCp.get(sp) ?? 1005);
        flowStreams[pe.node].push({ mdot, h: enthalpy(T0s, burntS, fuel), burnt: burntS });
        const cs = cylByNode.get(net.nodes[pe.node]);
        if (cs && pe.area.kind === 'valve') {
          const ci = cyls.indexOf(cs);
          if (pe.area.valve.kind === 'intake') {
            stepMI[ci] += mdot;
            const fresh = mdot > 0 ? 1 - Math.min(1, Math.max(0, f.burntFlux / f.mdot)) : 1 - cs.node.vol!.burnt;
            cs.airIn += mdot * dt * fresh;
            if (mdot > 0) scavIn[ci] += mdot * dt * fresh;
          } else stepME[ci] += -mdot;
        }
      }
    }

    // Direct node-to-node links.
    for (const l of net.links) {
      if (l.machine && turbo) {
        const mf = turbo.flow(l, net.nodes[l.a], net.nodes[l.b], dt);
        if (mf && mf.mdot !== 0) {
          flowStreams[l.a].push({ mdot: -mf.mdot, h: mf.hA, burnt: mf.burnt });
          flowStreams[l.b].push({ mdot: mf.mdot, h: mf.hB, burnt: mf.burnt });
        }
        if (mf) continue;
      }
      const A = Math.max(0, areaOf(l.area, 0, gAngle));
      if (A <= 0) continue;
      const na = nodeGas(net.nodes[l.a], fuelGas);
      const nb = nodeGas(net.nodes[l.b], fuelGas);
      const f = flowBetween(na.p, na.T, na.gas, nb.p, nb.T, nb.gas, A);
      if (f.mdot === 0) continue;
      const up = f.mdot > 0 ? na : nb;
      const h = f.hFlux / f.mdot;
      flowStreams[l.a].push({ mdot: -f.mdot, h, burnt: up.burnt });
      flowStreams[l.b].push({ mdot: f.mdot, h, burnt: up.burnt });
      for (const [ni, sign] of [[l.a, -1], [l.b, 1]] as const) {
        const cs = cylByNode.get(net.nodes[ni]);
        if (cs && l.area.kind === 'valve') {
          const ci = cyls.indexOf(cs);
          const into = sign * f.mdot;
          if (l.area.valve.kind === 'intake') {
            stepMI[ci] += into;
            cs.airIn += into * dt * (1 - up.burnt);
            if (into > 0) scavIn[ci] += into * dt * (1 - up.burnt);
          } else stepME[ci] += -into;
        }
      }
    }

    // Advance 0D nodes.
    for (let i = 0; i < nNodes; i++) {
      const n = net.nodes[i];
      const v = n.vol;
      let netFlow = 0;
      for (const s of flowStreams[i]) netFlow += s.mdot;
      lastNet[i] = netFlow;
      if (!v) continue;
      const cs = cylByNode.get(n);
      if (!cs) {
        const Vc = n.crank ? crankVolume(n.crank, gNew) : v.V;
        v.advance(dt, { Vnew: Vc, dV: Vc - v.V, qCombustion: 0, qWall: 0, flows: flowStreams[i] });
        continue;
      }
      const ci = cyls.indexOf(cs);
      const th0 = thetaOf(cs.cyl, gAngle);
      const th1 = th0 + dTheta;
      const Vnew = cylinderVolume(cs.cyl, wrap(th1, cycleDeg));
      const dV = Vnew - v.V;
      const pOld = v.p;

      // Intake valve closing: remember state for heat transfer and trapped mass.
      if (inWindow(cs.intakeClose, th0, th1, cycleDeg) && wrap(cs.intakeClose - th0, cycleDeg) < dTheta + 1e-9) {
        cs.ivcState = { p: v.p, V: v.V, T: v.T };
        cs.trapped = v.m;
        cs.residual = v.burnt;
      }

      // Combustion: Wiebe from start of combustion, angles relative to firing TDC on -cycle/2..cycle/2.
      const rel0 = th0 > cycleDeg / 2 ? th0 - cycleDeg : th0;
      const rel1 = rel0 + dTheta;
      let qComb = 0;
      let burnFlows: { mdot: number; h: number; burnt: number } | null = null;
      if (!cs.combusting && rel0 <= burnStart && rel1 > burnStart) {
        cs.combusting = true;
        cs.freshAtStart = v.m * (1 - v.burnt);
        cs.fuelMass =
          test.fuelPerInjection !== undefined
            ? Math.min(test.fuelPerInjection * 1e-9 * (fuel.density > 0 ? fuel.density : 830), cs.freshAtStart / (stoichAfr(fuel) * 0.95))
            : cs.freshAtStart / afr;
        cs.burnedSoFar = 0;
      }
      if (cs.combusting) {
        const x0 = burnFraction(model.burn, rel0, burnStart, burnDuration);
        const x1 = burnFraction(model.burn, rel1, burnStart, burnDuration);
        const dx = Math.max(0, x1 - x0);
        if (dx > 0) {
          const dmFuel = cs.fuelMass * dx;
          qComb = dmFuel * lhv * combEff;
          // Fuel enters the gas as burnt products at the gas enthalpy (its energy is in qComb).
          burnFlows = { mdot: dmFuel / dt, h: enthalpy(v.T, 1, fuel), burnt: 1 };
          cs.burnedSoFar += dx;
        }
        if (rel1 >= burnStart + burnDuration * 1.5 || x1 >= 0.9999) cs.combusting = false;
      }

      // Wall heat transfer (Woschni etc.), head + piston + exposed liner.
      const Sp = meanPistonSpeed(cs.cyl, rpm);
      const ivc = cs.ivcState ?? { p: v.p, V: v.V, T: v.T };
      const closed = !inWindow(th0, 0, 0, cycleDeg) && rel0 > -180 && rel0 < 180;
      const pMot = ivc.p * Math.pow(ivc.V / Math.max(v.V, 1e-9), 1.35);
      const hc = heatTransferCoeff(model.heatTransfer, {
        p: v.p, T: v.T, bore: cs.bore, meanPistonSpeed: Sp, V: v.V, Vd: cs.Vd,
        pMotored: pMot, T1: ivc.T, p1: ivc.p, V1: ivc.V, combustion: closed && rel0 > burnStart,
      });
      const aHead = cs.pistonArea * 1.1;
      const aPist = cs.pistonArea;
      const aLin = linerArea(cs.cyl, th0);
      const qWallRate = hc * (aHead * (temps.head - v.T) + aPist * (temps.piston - v.T) + aLin * (temps.liner - v.T));
      const qWall = qWallRate * dt;

      const flows = burnFlows ? [...flowStreams[i], burnFlows] : flowStreams[i];
      // Combustion converts fresh charge to products.
      const dBurntMass = burnFlows ? (cs.freshAtStart * (burnFlows.mdot * dt)) / Math.max(cs.fuelMass, 1e-12) : 0;
      v.advance(dt, { Vnew, dV, qCombustion: qComb, qWall, flows, dBurntMass, outBurnt: n.outBurnt });
      if (th1 >= cycleDeg) scavIn[ci] = 0;

      const pAvg = 0.5 * (pOld + v.p);
      cs.workTotal += pAvg * dV;
      if (model.cycle === 4 && th0 >= 180 && th0 < 540) cs.workPumping += pAvg * dV;
      if (v.p > cs.peakP) {
        cs.peakP = v.p;
        cs.peakAngle = rel0;
      }
      stepHR[ci] = qComb / Math.max(dTheta, 1e-9);
      stepHT[ci] = qWallRate;
    }

    turbo?.update(dt, dTheta, gNew, rpm);

    // Record traces on a 1-degree grid during the last cycle.
    if (recording) {
      const cycPos = wrap(gNew, cycleDeg);
      while (nextGrid < nGrid && (nextGrid * DEG_GRID <= cycPos || gNew - (cycle * cycleDeg) >= cycleDeg)) {
        const gGrid = nextGrid * DEG_GRID;
        cyls.forEach((cs, ci) => {
          const th = thetaOf(cs.cyl, gGrid);
          const k = Math.min(nGrid - 1, Math.round(th / DEG_GRID) % nGrid);
          const v = cs.node.vol!;
          const r = cylRec[ci];
          r.p[k] = v.p / 1e5;
          r.T[k] = v.T;
          r.V[k] = v.V * 1e6;
          const rel = th > cycleDeg / 2 ? th - cycleDeg : th;
          r.mfb[k] = burnFraction(model.burn, rel, burnStart, burnDuration);
          r.hr[k] = stepHR[ci];
          r.ht[k] = stepHT[ci];
          r.mi[k] = stepMI[ci];
          r.me[k] = stepME[ci];
          const vs = cylValves.get(cs.cyl.id) ?? [];
          const iv = vs.find((x) => x.kind === 'intake');
          const ev = vs.find((x) => x.kind === 'exhaust');
          r.li[k] = iv ? liftOf(iv, th) : 0;
          r.le[k] = ev ? liftOf(ev, th) : 0;
        });
        net.pipes.forEach((sp, pi) => {
          const r = pipeRec[pi];
          const s0 = sp.solver.sample(0);
          const s1 = sp.solver.sample(0.5);
          const s2 = sp.solver.sample(1);
          r.ps[nextGrid] = s0.p / 1e5; r.pm[nextGrid] = s1.p / 1e5; r.pe[nextGrid] = s2.p / 1e5;
          r.us[nextGrid] = s0.u; r.um[nextGrid] = s1.u; r.ue[nextGrid] = s2.u;
          r.ts[nextGrid] = s0.T; r.tm[nextGrid] = s1.T; r.te[nextGrid] = s2.T;
        });
        let pl = 0;
        for (const n of net.nodes) {
          if (n.kind !== 'plenum') continue;
          plenRec[pl].p[nextGrid] = n.vol!.p / 1e5;
          plenRec[pl].T[nextGrid] = n.vol!.T;
          pl++;
        }
        if (profiles && gGrid >= nextProfile) {
          profiles.angle.push(gGrid);
          net.pipes.forEach((sp, pi) => {
            const pr = sp.solver.profile();
            const target = profiles!.pipes[pi];
            if (target.x.length === 0) target.x = pr.x.map((x) => x * 1000);
            target.p.push(pr.p.map((p) => p / 1e5));
            target.u.push([...pr.u]);
            target.T.push([...pr.T]);
          });
          nextProfile += profileEvery;
        }
        turbo?.record(nextGrid);
        nextGrid++;
      }
    }

    gAngle = gNew;
    steps++;

    // End of cycle?
    if (gAngle >= (cycle + 1) * cycleDeg) {
      cycle++;
      const imepCyl = cyls.map((c) => c.workTotal / c.Vd / 1e5);
      const pmepCyl = cyls.map((c) => c.workPumping / c.Vd / 1e5);
      const imep = imepCyl.reduce((s, x) => s + x, 0) / Math.max(1, imepCyl.length);
      lastSummary = {
        imepCyl,
        pmepCyl,
        peak: cyls.map((c) => ({ p: c.peakP / 1e5, a: c.peakAngle })),
        airIn: cyls.map((c) => c.airIn),
        trapped: cyls.map((c) => c.trapped),
        residual: cyls.map((c) => c.residual),
        fuel: cyls.map((c) => c.fuelMass),
      };
      for (const c of cyls) {
        c.workTotal = 0;
        c.workPumping = 0;
        c.peakP = 0;
        c.airIn = 0;
      }
      lastDelivered = delivered;
      delivered = 0;
      const turboSettled = turbo ? turbo.endCycle() : true;
      progress?.(cycle / maxCycles);
      if (recording) break;
      const change = Math.abs(imep - prevImep) / Math.max(Math.abs(imep), 0.1);
      const done = cycle >= minCycles && change < tol && turboSettled;
      prevImep = imep;
      if (done || cycle >= maxCycles - 1) {
        converged = done;
        recording = true;
        nextGrid = 0;
        nextProfile = 0;
        resetRecorders();
      }
      retunePipes();
    }
  }
  if (steps >= maxSteps) warnings.push('Step limit reached; results may be incomplete.');
  if (!converged) warnings.push(`Not converged after ${cycle} cycles.`);

  const s = lastSummary ?? { imepCyl: [], pmepCyl: [], peak: [], airIn: [], trapped: [], residual: [], fuel: [] };
  const nCyl = Math.max(1, cyls.length);
  const imep = s.imepCyl.reduce((a, b) => a + b, 0) / nCyl;
  const pmep = s.pmepCyl.reduce((a, b) => a + b, 0) / nCyl;
  const pmax = Math.max(0, ...s.peak.map((x) => x.p));
  const fmep = test.fmep !== undefined ? test.fmep : chenFlynnFmep(friction, pmax, cyls.length ? meanPistonSpeed(cyls[0].cyl, rpm) : 0);
  const cyclesPerSecT = rpm / 60 / (model.cycle === 2 ? 1 : 2);
  const turboLoadKW = turbo ? turbo.crankPowerKW() : 0; // crank driven compressors / superchargers
  const bmep = imep - fmep - (totalVd > 0 ? (turboLoadKW * 1000) / (totalVd * cyclesPerSecT * 1e5) : 0);
  const cyclesPerSec = rpm / 60 / (model.cycle === 2 ? 1 : 2);
  const power = (bmep * 1e5 * totalVd * cyclesPerSec) / 1000; // kW
  const torque = power > -1e9 ? (power * 1000) / (rpm * 2 * Math.PI / 60) : 0;
  const airPerCycle = s.airIn.reduce((a, b) => a + b, 0);
  const fuelPerCycle = s.fuel.reduce((a, b) => a + b, 0);
  const twoStroke = model.cycle === 2;
  const deliveredPerCycle = lastDelivered > 0 ? lastDelivered : airPerCycle;
  const airMassFlow = (twoStroke ? deliveredPerCycle : airPerCycle) * cyclesPerSec;
  const freshTrapped = s.trapped.reduce((a, m, i) => a + m * (1 - (s.residual[i] ?? 0)), 0);
  const totalTrapped = s.trapped.reduce((a, m) => a + m, 0);
  const fuelMassFlow = fuelPerCycle * cyclesPerSec;
  const bsfc = power > 0 ? (fuelMassFlow * 3600 * 1000) / power : 0;
  const ve = totalVd > 0 ? airPerCycle / (rhoAmb * totalVd) : 0;
  const eff = fuelMassFlow > 0 ? (power * 1000) / (fuelMassFlow * lhv) : 0;

  const cylinders: CylinderSummary[] = cyls.map((c, i) => ({
    id: c.cyl.id,
    imep: s.imepCyl[i] ?? 0,
    pmep: s.pmepCyl[i] ?? 0,
    peakPressure: s.peak[i]?.p ?? 0,
    peakPressureAngle: s.peak[i]?.a ?? 0,
    trappedMass: s.trapped[i] ?? 0,
    volumetricEfficiency: c.Vd > 0 ? (s.airIn[i] ?? 0) / (rhoAmb * c.Vd) : 0,
    residualFraction: s.residual[i] ?? 0,
    fuelMass: s.fuel[i] ?? 0,
  }));

  const angles = Array.from({ length: nGrid }, (_, k) => k * DEG_GRID);
  const fill = (a: number[]) => {
    // Fill any grid gaps by carrying the previous value.
    let last = a.find((x) => !Number.isNaN(x)) ?? 0;
    return a.map((x) => (Number.isNaN(x) ? last : (last = x)));
  };
  const cylTraces: CylinderTrace[] = cyls.map((c, i) => {
    const r = cylRec[i];
    return {
      id: c.cyl.id,
      angle: angles,
      pressure: fill(r.p), temperature: fill(r.T), volume: fill(r.V), massFractionBurned: fill(r.mfb),
      heatRelease: fill(r.hr), heatTransfer: fill(r.ht), intakeMassFlow: fill(r.mi), exhaustMassFlow: fill(r.me),
      intakeLift: fill(r.li), exhaustLift: fill(r.le),
    };
  });
  const pipeTraces: PipeTrace[] = net.pipes.map((sp, i) => {
    const r = pipeRec[i];
    return {
      id: sp.model.id,
      angle: angles,
      pressure: { start: fill(r.ps), mid: fill(r.pm), end: fill(r.pe) },
      velocity: { start: fill(r.us), mid: fill(r.um), end: fill(r.ue) },
      temperature: { start: fill(r.ts), mid: fill(r.tm), end: fill(r.te) },
    };
  });
  const plenTraces: PlenumTrace[] = net.nodes
    .filter((n) => n.kind === 'plenum')
    .map((n, i) => ({ id: n.id, angle: angles, pressure: fill(plenRec[i].p), temperature: fill(plenRec[i].T) }));

  return {
    speed: test.speed,
    cycles: cycle,
    converged,
    imep,
    fmep,
    bmep,
    power,
    torque,
    bsfc,
    volumetricEfficiency: ve,
    ...(twoStroke
      ? {
          scavenging: {
            deliveryRatio: totalVd > 0 ? deliveredPerCycle / (rhoAmb * totalVd) : 0,
            trappingEfficiency: deliveredPerCycle > 0 ? freshTrapped / deliveredPerCycle : 0,
            scavengingEfficiency: totalTrapped > 0 ? freshTrapped / totalTrapped : 0,
            chargingEfficiency: totalVd > 0 ? freshTrapped / (rhoAmb * totalVd) : 0,
          },
        }
      : {}),
    airMassFlow,
    fuelMassFlow,
    thermalEfficiency: eff,
    cylinders,
    traces: { cylinders: cylTraces, pipes: pipeTraces, plenums: plenTraces, ...(turbo ? { turbos: turbo.traces(angles) } : {}) },
    ...(turbo ? { turbos: turbo.summary() } : {}),
    warnings,
    profiles,
  };
}

/** Run all (or selected) test points of a model. */
export async function simulate(model: EngineModel, opts: SimulateOptions = {}): Promise<SweepResult> {
  const idx = opts.points ?? model.tests.map((_, i) => i);
  const points: TestPointResult[] = [];
  for (let k = 0; k < idx.length; k++) {
    const test = model.tests[idx[k]];
    if (!test) continue;
    const base = k / idx.length;
    opts.onProgress?.(base, `Test point ${k + 1} of ${idx.length}: ${test.speed} rpm`);
    points.push(simulatePoint(model, test, opts, (f) => opts.onProgress?.(base + f / idx.length, `Test point ${k + 1} of ${idx.length}: ${test.speed} rpm`)));
    // Let the event loop breathe between points (UI / worker messages).
    await new Promise((r) => setTimeout(r, 0));
  }
  opts.onProgress?.(1, 'Done');
  return { modelName: model.name, points };
}
