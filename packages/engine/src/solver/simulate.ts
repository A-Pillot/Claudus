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
  return { p: v.p, T: v.T, gas: fuelGas(v.T, v.burnt), burnt: v.burnt };
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

  const throttleArea = (id: number): number => {
    const t = model.throttles.find((x) => x.id === id);
    if (!t) return 0;
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
  }

  const thetaOf = (c: Cylinder, g: number) => wrap(g - c.firingAngle, cycleDeg);

  // Start each cylinder at the right volume.
  for (const c of cyls) {
    const v = c.node.vol!;
    v.V = cylinderVolume(c.cyl, thetaOf(c.cyl, 0));
    v.m = (v.p * v.V) / (fuelGas(v.T, v.burnt).R * v.T);
  }

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
  const retunePipes = () => {
    for (const sp of net.pipes) {
      const s = sp.solver.sample(0.5);
      const g = fuelGas(s.T, s.burnt);
      sp.solver.setGas(g.gamma, g.R);
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
        flowStreams[pe.node].push({ mdot, h: f.hFlux / f.mdot, burnt: Math.min(1, Math.max(0, f.burntFlux / f.mdot)) });
        const cs = cylByNode.get(net.nodes[pe.node]);
        if (cs && pe.area.kind === 'valve') {
          const ci = cyls.indexOf(cs);
          if (pe.area.valve.kind === 'intake') {
            stepMI[ci] += mdot;
            const fresh = mdot > 0 ? 1 - Math.min(1, Math.max(0, f.burntFlux / f.mdot)) : 1 - cs.node.vol!.burnt;
            cs.airIn += mdot * dt * fresh;
          } else stepME[ci] += -mdot;
        }
      }
    }

    // Direct node-to-node links.
    for (const l of net.links) {
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
        v.advance(dt, { Vnew: v.V, dV: 0, qCombustion: 0, qWall: 0, flows: flowStreams[i] });
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
        cs.fuelMass = cs.freshAtStart / afr;
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
      v.advance(dt, { Vnew, dV, qCombustion: qComb, qWall, flows, dBurntMass });

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
          r.li[k] = iv ? valveLift(iv, th, cycleDeg) : 0;
          r.le[k] = ev ? valveLift(ev, th, cycleDeg) : 0;
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
      progress?.(cycle / maxCycles);
      if (recording) break;
      const change = Math.abs(imep - prevImep) / Math.max(Math.abs(imep), 0.1);
      const done = cycle >= minCycles && change < tol;
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
  const fmep = chenFlynnFmep(friction, pmax, cyls.length ? meanPistonSpeed(cyls[0].cyl, rpm) : 0);
  const bmep = imep - fmep;
  const cyclesPerSec = rpm / 60 / (model.cycle === 2 ? 1 : 2);
  const power = (bmep * 1e5 * totalVd * cyclesPerSec) / 1000; // kW
  const torque = power > -1e9 ? (power * 1000) / (rpm * 2 * Math.PI / 60) : 0;
  const airPerCycle = s.airIn.reduce((a, b) => a + b, 0);
  const fuelPerCycle = s.fuel.reduce((a, b) => a + b, 0);
  const airMassFlow = airPerCycle * cyclesPerSec;
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
    airMassFlow,
    fuelMassFlow,
    thermalEfficiency: eff,
    cylinders,
    traces: { cylinders: cylTraces, pipes: pipeTraces, plenums: plenTraces },
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
