/**
 * Solve / Convert 2D to 3D: fill one of the built-in 3D templates from a 2D model.
 *
 * The 2D data fixes the points that matter in the cross-car plane: the inner pivots (both pivots of an arm
 * share the 2D inner point, so the arm axis is along X), the outer ball joints (or strut top) and the wheel
 * centre. Points the 2D model does not have (dampers, springs, track rod, rockers) keep the template's
 * default layout, carried along with the part they belong to: upright points move with the upright, arm
 * points with their arm, body points with the average shift of the inner pivots. The extra 3D data the
 * dialog asks for is the wheelbase, castor angle and tyre rolling radius.
 */
import { newModel } from '../model/new.js';
import type { End, Model } from '../model/types.js';
import type { Vec3 } from '../math/vec3.js';
import { dataPoints, GROUND } from '../template/types.js';
import { getTemplate } from '../template/index.js';
import { geometry2D } from './solve.js';
import type { Model2D, P2 } from './types.js';

/** Which template point numbers play which role. */
interface Layout {
  lowerPivots: number[];
  lowerOuter: number[];
  /** Wishbone only. */
  upperPivots?: number[];
  upperOuter: number[];
  /** Strut only: points on the strut slider axis, below the strut top. */
  axis?: number[];
}

const WISHBONE: Layout = { lowerPivots: [1, 2], lowerOuter: [3], upperPivots: [5, 6], upperOuter: [7] };
const STRUT: Layout = { lowerPivots: [1, 2], lowerOuter: [3], upperOuter: [7], axis: [6, 8] };

const LAYOUTS: Record<number, Layout> = {
  1: WISHBONE, 6: WISHBONE, 14: WISHBONE, 15: WISHBONE, 17: WISHBONE,
  3: STRUT, 7: STRUT,
  4: { ...STRUT, lowerOuter: [3, 5] },
};

const WHEEL_CENTRE = 19;
const STUB_AXLE = 18;

/** The 3D template numbers a 2D model of this type can be converted to. */
export const convertTargets = (type: 1 | 2): number[] => Object.keys(LAYOUTS).map(Number).filter((s) => (LAYOUTS[s].upperPivots ? type === 1 : type === 2));

export interface TwoDConvertOptions {
  slot: number;
  end: End;
  wheelbase: number; // mm
  /** Positive = top of the kingpin axis rearward, deg. */
  castor: number;
  rollingRadius: number; // mm
}

export const defaultTwoDConvertOptions = (m: Model2D): TwoDConvertOptions => ({ slot: convertTargets(m.type)[0], end: 'front', wheelbase: 2240, castor: 0, rollingRadius: 225 });

/** Map a point with the 2D rigid motion that takes segment a0-b0 onto a1-b1 (X is left alone). */
function segmentMap(a0: P2, b0: P2, a1: P2, b1: P2): (p: Vec3) => Vec3 {
  const ang = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]) - Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return (p) => {
    const dy = p[1] - a0[0];
    const dz = p[2] - a0[1];
    return [p[0], a1[0] + c * dy - s * dz, a1[1] + s * dy + c * dz];
  };
}

const mid = (pts: Vec3[]): P2 => [pts.reduce((s, p) => s + p[1], 0) / pts.length, pts.reduce((s, p) => s + p[2], 0) / pts.length];

export function convert2DTo3D(m: Model2D, o: TwoDConvertOptions): Model {
  const layout = LAYOUTS[o.slot];
  if (!layout || !!layout.upperPivots !== (m.type === 1)) throw new Error(`A 2D ${m.type === 1 ? 'double wishbone' : 'strut'} model cannot be converted to type ${o.slot}.`);
  const t = getTemplate(o.slot);
  const tp = dataPoints(t);
  const def = new Map(tp.map((p) => [p.no, p.def]));
  const get = (no: number) => def.get(no) as Vec3;
  const geo = geometry2D(m);
  const tanC = Math.tan((o.castor * Math.PI) / 180);

  // Default positions of the roles, and where they must go.
  const lo0 = mid(layout.lowerOuter.map(get));
  const top0 = mid(layout.upperOuter.map(get));
  const li0 = mid(layout.lowerPivots.map(get));
  const ui0 = layout.upperPivots ? mid(layout.upperPivots.map(get)) : li0;
  const lowerArm = segmentMap(li0, lo0, geo.lowerInner, geo.lowerOuter);
  const upperArm = layout.upperPivots ? segmentMap(ui0, top0, geo.upperInner, geo.upperOuter) : lowerArm;
  const upright = segmentMap(lo0, top0, geo.lowerOuter, geo.upperOuter);
  const bodyShift: P2 = layout.upperPivots
    ? [((geo.lowerInner[0] - li0[0]) + (geo.upperInner[0] - ui0[0])) / 2, ((geo.lowerInner[1] - li0[1]) + (geo.upperInner[1] - ui0[1])) / 2]
    : [geo.lowerInner[0] - li0[0], geo.lowerInner[1] - li0[1]];

  const uprightPart = t.parts.length; // by convention the upright is the last part
  // The arm a pivot belongs to is the part that is not the body.
  const armOf = (no: number) => {
    const p = tp.find((q) => q.no === no);
    return p ? [p.part1, p.part2].find((x) => x > 0) ?? 0 : 0;
  };
  const lowerPart = armOf(layout.lowerPivots[0]);
  const upperPart = layout.upperPivots ? armOf(layout.upperPivots[0]) : -2;

  const out = new Map<number, Vec3>();
  for (const p of tp) {
    const parts = [p.part1, p.part2];
    const body = parts.includes(GROUND) && !parts.includes(uprightPart);
    let q: Vec3;
    if (parts.includes(uprightPart)) q = upright(p.def);
    else if (parts.includes(lowerPart) && !body) q = lowerArm(p.def);
    else if (parts.includes(upperPart) && !body) q = upperArm(p.def);
    else q = [p.def[0], p.def[1] + bodyShift[0], p.def[2] + bodyShift[1]];
    out.set(p.no, q);
  }

  // The key points sit exactly where the 2D data puts them.
  const put = (nos: number[], at: P2) => {
    for (const no of nos) out.set(no, [get(no)[0], at[0], at[1]]);
  };
  put(layout.lowerPivots, geo.lowerInner);
  if (layout.upperPivots) put(layout.upperPivots, geo.upperInner);
  put(layout.lowerOuter, geo.lowerOuter);
  put(layout.upperOuter, geo.upperOuter);
  if (layout.axis) {
    // Slider axis points keep their default distance from the strut top, along the damper angle.
    const top = get(layout.upperOuter[0]);
    for (const no of layout.axis) {
      const d = Math.hypot(get(no)[1] - top[1], get(no)[2] - top[2]);
      out.set(no, [get(no)[0], geo.upperOuter[0] + d * Math.sin(geo.damper), geo.upperOuter[1] - d * Math.cos(geo.damper)]);
    }
  }
  // Wheel centre above the contact patch; the stub axle point keeps its default inboard offset.
  const wc0 = get(WHEEL_CENTRE);
  const sp0 = get(STUB_AXLE);
  out.set(WHEEL_CENTRE, [wc0[0], geo.contact[0], o.rollingRadius]);
  out.set(STUB_AXLE, [sp0[0], geo.contact[0] - (wc0[1] - sp0[1]), o.rollingRadius]);

  // Castor: lean the kingpin axis back by shearing everything above the lower ball joint in X.
  const castorOf = (no: number, v: Vec3): Vec3 => {
    const part = tp.find((p) => p.no === no)!;
    const onUpright = [part.part1, part.part2].includes(uprightPart) && no !== WHEEL_CENTRE && no !== STUB_AXLE;
    const moves = onUpright || layout.upperOuter.includes(no) || (layout.axis?.includes(no) ?? false);
    return moves ? [v[0] + tanC * (v[2] - geo.lowerOuter[1]), v[1], v[2]] : v;
  };

  const model = newModel(o.slot, o.end);
  model[o.end] = {
    templateSlot: o.slot,
    points: tp.map((p) => castorOf(p.no, out.get(p.no) as Vec3)),
    rollingRadius: o.rollingRadius,
  };
  model.params = { ...model.params, wheelbase: o.wheelbase };
  return model;
}
