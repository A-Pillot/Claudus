// In-cylinder convective heat transfer coefficients, W/m^2K.
import type { HeatTransferModel } from '../model';

export interface HeatState {
  p: number; // Pa
  T: number; // K
  bore: number; // m
  meanPistonSpeed: number; // m/s
  V: number; // m^3
  Vd: number; // displacement m^3
  pMotored?: number; // Pa
  T1?: number; // reference state (start of compression/combustion)
  p1?: number;
  V1?: number;
  Tw?: number; // wall temperature K (Annand radiation)
  R?: number; // gas constant J/kgK
  swirlRatio?: number;
  combustion: boolean; // closed cycle (compression/combustion/expansion)
}

const gasK = (T: number): number => 0.0263 * Math.pow(T / 300, 0.8);
const gasMu = (T: number): number => (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4);

export function heatTransferCoeff(model: HeatTransferModel, s: HeatState): number {
  switch (model.kind) {
    case 'none':
      return 0;
    case 'woschni': {
      const pk = s.p / 1000;
      const swirl = 0; // swirl term unused (Srat = 0 by default)
      let w: number;
      if (s.combustion) {
        const T1 = s.T1 ?? s.T, p1 = s.p1 ?? s.p, V1 = s.V1 ?? s.V;
        const pm = s.pMotored ?? p1 * Math.pow(V1 / s.V, 1.33);
        const comb = (0.00324 * s.Vd * T1 * (s.p - pm)) / (p1 * V1);
        w = 2.28 * s.meanPistonSpeed + Math.max(comb, 0) + swirl;
      } else {
        w = 6.18 * s.meanPistonSpeed + swirl;
      }
      const h = 3.26 * Math.pow(s.bore, -0.2) * Math.pow(pk, 0.8) * Math.pow(s.T, -0.55) * Math.pow(Math.max(w, 0.1), 0.8);
      return model.scale * h;
    }
    case 'annand': {
      const R = s.R ?? 287;
      const rho = s.p / (R * s.T);
      const Re = (rho * s.meanPistonSpeed * s.bore) / gasMu(s.T);
      let h = (model.a * gasK(s.T) * Math.pow(Math.max(Re, 1), model.b)) / s.bore;
      if (s.combustion && model.c > 0) {
        const Tw = s.Tw ?? 450;
        const dT = s.T - Tw;
        if (Math.abs(dT) > 1) h += (model.c * (Math.pow(s.T, 4) - Math.pow(Tw, 4))) / dT;
      }
      return h;
    }
    case 'eichelberg':
      // p in bar, W/m^2K
      return model.scale * 2.43 * Math.cbrt(s.meanPistonSpeed) * Math.sqrt((s.p * 1e-5) * s.T);
  }
}
