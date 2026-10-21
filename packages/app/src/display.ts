import { useEffect, useMemo, useState } from 'react';
import {
  Corner, add, displacedPoints, forcedResponseAt, forcedSetup, modalAnalysis, responseAtPhase, solveAxle, sub,
  type AxleState, type ModalResult, type Vec3,
} from '@claudus/core';
import { useApp } from './store';
import { useLab, type DisplayMode } from './lab';
import { useEffectiveCompliance } from './derived';

/** The modal analysis of the shown end at the current position; only worked out while something needs it. */
export function useModal(corner: Corner | undefined, state: AxleState | undefined, needed: boolean): ModalResult | undefined {
  const comp = useEffectiveCompliance();
  return useMemo(() => {
    if (!needed || !corner || !state) return undefined;
    try {
      return modalAnalysis(corner, state.right, comp);
    } catch {
      return undefined;
    }
  }, [needed, corner, state, comp]);
}

/** Animation phase in degrees, one cycle every two seconds, updated about 30 times a second while on. */
export function usePhase(active: boolean): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!active) { setPhase(0); return; }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 33) { last = t; setPhase(((t / 2000) * 360) % 360); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return phase;
}

export interface DisplayedState {
  state: AxleState | undefined;
  mode: DisplayMode;
  /** Text for the 3D view: which mode and frequency is drawn. */
  caption?: string;
}

/**
 * The state the 3D view draws: the solved state itself (normal displacement), or its points moved by the compliant
 * deformation, a mode shape or the forced response, scaled by the display scalar and optionally animated.
 */
export function useDisplayedState(corner: Corner | undefined, state: AxleState | undefined, modal: ModalResult | undefined): DisplayedState {
  const compliant = useApp((s) => s.compliant);
  const data = useApp((s) => s.model[s.end]);
  const end = useApp((s) => s.end);
  const art = useApp((s) => s.art);
  const templatesRev = useApp((s) => s.templatesRev);
  const comp = useEffectiveCompliance();
  const d = useLab((s) => s.display);
  const mode: DisplayMode = compliant ? d.mode : 'articulation';
  const phaseDeg = usePhase(d.animate && mode !== 'articulation');
  const phaseRad = (phaseDeg * Math.PI) / 180;

  // Deformed geometry: the kinematic solution at the same articulation.
  const kinematic = useMemo(() => {
    if (mode !== 'deformed' || !data) return undefined;
    try {
      return solveAxle(new Corner(data, end), art).right.points;
    } catch {
      return undefined;
    }
  }, [mode, data, end, art, templatesRev]);

  const modeIndex = modal ? Math.min(Math.max(1, Math.round(d.modeNo)), modal.modes.length) - 1 : 0;
  // Mode shapes are drawn with the largest point movement as one unit, so the scalar is in millimetres.
  const unitMode = useMemo(() => {
    if (mode !== 'mode' || !modal || !corner || !state) return undefined;
    const m = modal.modes[modeIndex];
    if (!m) return undefined;
    const moved = displacedPoints(corner, state.right, modal.model, m.shape, 1).map((p, i) => sub(p, state.right.points[i]));
    const peak = Math.max(1e-12, ...moved.map((v) => Math.hypot(...v)));
    return moved.map((v) => v.map((x) => x / peak) as Vec3);
  }, [mode, modal, modeIndex, corner, state]);

  const setup = useMemo(() => {
    if (mode !== 'forced' || !corner || !state) return undefined;
    try {
      return forcedSetup(corner, state.right, comp);
    } catch {
      return undefined;
    }
  }, [mode, corner, state, comp]);
  const response = useMemo(() => (setup ? forcedResponseAt(setup, d.forcedHz) : undefined), [setup, d.forcedHz]);

  return useMemo((): DisplayedState => {
    if (!state || mode === 'articulation') return { state, mode };
    let delta: Vec3[] | undefined;
    let caption: string | undefined;
    const wave = d.animate ? Math.sin(phaseRad) : 1;
    if (mode === 'deformed') {
      if (kinematic) {
        const k = d.animate ? 0.5 * (1 - Math.cos(phaseRad)) : 1;
        // Displayed = kinematic + scalar x (compliant - kinematic).
        delta = state.right.points.map((p, i) => sub(p, kinematic[i]).map((x) => x * (d.deformScalar * k - 1)) as Vec3);
        caption = `Deformed geometry, displacements x ${d.deformScalar}`;
      }
    } else if (mode === 'mode') {
      if (unitMode && modal) {
        delta = unitMode.map((v) => v.map((x) => x * d.modeScalar * wave) as Vec3);
        const f = modal.modes[modeIndex].frequency;
        caption = `Mode ${modeIndex + 1} of ${modal.modes.length}: ${f.toFixed(2)} Hz, scalar ${d.modeScalar}`;
      } else caption = 'Mode shape: no modal analysis available';
    } else if (mode === 'forced') {
      if (setup && response && corner) {
        const q = responseAtPhase(response, d.animate ? phaseDeg : 0);
        const moved = displacedPoints(corner, state.right, setup.model, q, d.forcedScalar);
        delta = moved.map((p, i) => sub(p, state.right.points[i]));
        caption = `Forced-damped response at ${d.forcedHz.toFixed(1)} Hz, scalar ${d.forcedScalar}`;
      }
    }
    if (!delta) return { state, mode, caption };
    const dd = delta;
    return {
      mode,
      caption,
      state: {
        ...state,
        right: { ...state.right, points: state.right.points.map((p, i) => add(p, dd[i])) },
        leftMirror: state.leftMirror && { ...state.leftMirror, points: state.leftMirror.points.map((p, i) => add(p, dd[i])) },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, mode, kinematic, unitMode, modal, modeIndex, setup, response, corner, d.animate, d.deformScalar, d.modeScalar, d.forcedScalar, d.forcedHz, phaseDeg]);
}
