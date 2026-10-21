// Pipe bend and pressure-loss junction helpers (quasi-steady loss coefficients, after Miller / Bassett et al.).

const BEND_RD = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 10];
const BEND_K90 = [0.55, 0.3, 0.21, 0.16, 0.14, 0.13, 0.13, 0.15, 0.18];

/**
 * Total bend loss coefficient Kb (dp0 = Kb * rho*u^2/2) from bend angle and radius/diameter ratio.
 * Approximation of Miller's smooth-bend data: 90 degree curve interpolated in r/D, scaled with angle.
 * Pass the result as PipeOptions.bendLossK. `roughness` multiplies it (>= 1, Miller's Cf correction).
 */
export function bendLossCoefficient(angleDeg: number, radiusOverD: number, roughness = 1): number {
  const x = Math.min(Math.max(radiusOverD, BEND_RD[0]), BEND_RD[BEND_RD.length - 1]);
  let k90 = BEND_K90[BEND_K90.length - 1];
  for (let i = 1; i < BEND_RD.length; i++) {
    if (x <= BEND_RD[i]) {
      const f = (x - BEND_RD[i - 1]) / (BEND_RD[i] - BEND_RD[i - 1]);
      k90 = BEND_K90[i - 1] + f * (BEND_K90[i] - BEND_K90[i - 1]);
      break;
    }
  }
  const a = Math.min(Math.max(Math.abs(angleDeg), 0), 360);
  const angleFactor = a <= 90 ? Math.pow(a / 90, 0.9) : Math.pow(a / 90, 0.4);
  return k90 * angleFactor * Math.max(1, roughness);
}

/** Effective flow area of a branch end that carries a stagnation-pressure loss K (dp0 = K*rho*u^2/2 based on branch velocity). */
export function junctionLossArea(branchArea: number, K: number): number {
  return branchArea / Math.sqrt(1 + Math.max(0, K));
}

export interface JunctionBranch {
  area: number; // m^2, pipe end area
  angleDeg: number; // direction the branch leaves the junction, relative to the datum branch's continuation (0 = straight through)
  mdotIn: number; // kg/s, + = flowing from this pipe end INTO the junction (use -EndFlux.mdot)
}

export interface JunctionLoss {
  datum: number; // index of the datum branch (largest flow towards the junction)
  K: number[]; // loss coefficient per branch based on its own velocity head (0 for datum and inflowing branches)
  effAreaFactor: number[]; // multiply the branch's effArea (<= 1)
}

/**
 * Pressure-loss junction (quasi-steady, momentum-based, any number of branches). The datum branch
 * carries the largest flow towards the junction; every branch with flow leaving the junction sees a loss
 * K_dat = (1 - w)^2 + w*(1 - cos(theta)), w = velocity ratio branch/datum, converted to the branch's own
 * head. For a constant-pressure junction simply do not call this (all factors are 1).
 */
export function pressureLossJunction(branches: JunctionBranch[]): JunctionLoss {
  const n = branches.length;
  const K = new Array<number>(n).fill(0);
  const fac = new Array<number>(n).fill(1);
  let datum = 0, best = -Infinity;
  for (let i = 0; i < n; i++) if (branches[i].mdotIn > best) { best = branches[i].mdotIn; datum = i; }
  if (best > 1e-12) {
    const d = branches[datum];
    for (let j = 0; j < n; j++) {
      if (j === datum) continue;
      const b = branches[j];
      if (b.mdotIn >= 0) continue; // flows towards the junction: no loss assigned
      const w = (-b.mdotIn / best) * (d.area / b.area);
      const th = ((b.angleDeg - d.angleDeg) * Math.PI) / 180;
      const kDat = (1 - w) * (1 - w) + w * (1 - Math.cos(th));
      const kj = Math.min(50, kDat / Math.max(w * w, 1e-6));
      K[j] = kj;
      fac[j] = 1 / Math.sqrt(1 + kj);
    }
  }
  return { datum, K, effAreaFactor: fac };
}
