/** Combined motion sweep: the corner solved at each step of a bump-and-steer path. */
import type { CombinedProfile } from '../model/types.js';
import type { Corner } from '../solver/corner.js';
import { wheelGeometry, type WheelGeometry } from './derivatives.js';

export interface CombinedRow extends WheelGeometry {
  /** 1-based step number along the path. */
  step: number;
  bump: number;
  rack: number;
  /** Change in toe angle from static, deg (+ toe-in). */
  toeChange: number;
  halfTrackChange: number;
  wheelbaseChange: number;
  damperTravel: number;
  springTravel: number;
  converged: boolean;
}

export function combinedSweep(c: Corner, profile: CombinedProfile): CombinedRow[] {
  const stat = c.solve({});
  const g0 = wheelGeometry(c, stat.points, stat.groundZ, stat);
  const d0 = c.damperLength(stat.points);
  const s0 = c.springLength(stat.points);
  const sign = c.end === 'front' ? -1 : 1;
  let warm: number[] | undefined;
  return profile.steps.map((s, i) => {
    let st = c.solve({ bump: s.bump, rack: s.rack }, warm);
    if (!st.converged && warm) st = c.solve({ bump: s.bump, rack: s.rack });
    warm = st.converged ? st.x : undefined;
    const g = wheelGeometry(c, st.points, st.groundZ, st);
    return {
      ...g,
      step: i + 1,
      bump: s.bump,
      rack: s.rack,
      toeChange: g.toeSae - g0.toeSae,
      halfTrackChange: g.tcp[1] - g0.tcp[1],
      wheelbaseChange: sign * (g.tcp[0] - g0.tcp[0]),
      damperTravel: c.damperLength(st.points) - d0,
      springTravel: c.springLength(st.points) - s0,
      converged: st.converged,
    };
  });
}
