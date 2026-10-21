/**
 * SHARK's Data / Set Static Angles: set the static camber and toe directly. The stub axle point moves so the
 * spindle takes the new angles; the wheel centre stays where it is, and so does the spindle length.
 */
import { deg, mirrorY, rad, scale, sub, norm, type Vec3 } from '../math/vec3.js';
import { getTemplate } from '../template/index.js';
import { dataPoints, findGen, GenType } from '../template/types.js';
import { spindleAxis } from '../solver/mechanism.js';
import type { End, Model } from './types.js';

export interface StaticAngles {
  camber: number; // deg, + top outward
  toe: number; // deg, SAE, + toe-in
}

/** Data point indexes of the wheel centre and stub axle of each wheel of an end (the second only on a full axle). */
function wheelPoints(m: Model, end: End): { wc: number; stub: number }[] {
  const s = m[end];
  if (!s) return [];
  const t = m.templates?.find((x) => x.slot === s.templateSlot) ?? getTemplate(s.templateSlot);
  const data = dataPoints(t);
  const at = (g: GenType) => {
    const p = findGen(t, g);
    return p ? data.findIndex((d) => d.no === p.no) : -1;
  };
  const out: { wc: number; stub: number }[] = [];
  for (const [w, st] of [[GenType.WheelCentre, GenType.StubAxle], [GenType.WheelCentre2, GenType.StubAxle2]] as const) {
    const wc = at(w);
    const stub = at(st);
    if (wc >= 0 && stub >= 0) out.push({ wc, stub });
  }
  return out;
}

/** True when the end's wheel centre and stub axle are both data points that can be edited. */
export const canSetStaticAngles = (m: Model, end: End) => wheelPoints(m, end).length > 0;

const side = (wheel: number) => (wheel === 0 ? (p: Vec3) => p : mirrorY);

/** The static camber and toe of each wheel of an end, in the right-hand convention. */
export function staticAngles(m: Model, end: End): StaticAngles[] {
  const s = m[end];
  return wheelPoints(m, end).map((w, k) => {
    const mr = side(k);
    const a = spindleAxis(mr(s!.points[w.wc]), mr(s!.points[w.stub]));
    return { camber: deg(-Math.asin(a[2])), toe: deg(Math.atan2(-a[0], a[1])) };
  });
}

/** A model with the stub axle moved to give each wheel the wanted camber and toe. Angles are per wheel. */
export function setStaticAngles(m: Model, end: End, angles: StaticAngles[]): Model {
  const s = m[end];
  const wp = wheelPoints(m, end);
  if (!s || !wp.length) throw new Error('This suspension has no wheel centre and stub axle points to edit.');
  const points = s.points.map((p) => [...p] as Vec3);
  wp.forEach((w, k) => {
    const want = angles[k];
    if (!want) return;
    const mr = side(k);
    const wc = mr(points[w.wc]);
    const len = norm(sub(wc, mr(points[w.stub])));
    const c = rad(want.camber);
    const t = rad(want.toe);
    const axis: Vec3 = [-Math.cos(c) * Math.sin(t), Math.cos(c) * Math.cos(t), -Math.sin(c)];
    points[w.stub] = mr(sub(wc, scale(axis, len)));
  });
  return { ...m, [end]: { ...s, points } };
}
