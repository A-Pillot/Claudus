/**
 * Further built-in templates (types 12, 18, 19, 20, 22, 24, 25, 27, 28).
 *
 * Point numbers and labels follow the SHARK help. Types 12 and 18 take their default coordinates from
 * SHARK's sample files. SHARK shipped no samples for the others, so their defaults are a sensible
 * layout built around the type 1, 2 and 3 sample geometry. Part connectivity is our reading of the help
 * text and screenshots (SHARK compiled it into the executable).
 */
import { lerp, type Vec3 } from '../math/vec3.js';
import { defineTemplate } from './define.js';
import { GenType as G, type Template } from './types.js';

const SPINDLE = 'Wheel spindle point';
const WHEEL_CENTRE = 'Wheel centre point';

/** Type 12: knuckle swivelling on a kingpost carried by two parallel wishbones (trunnion style). */
const type12 = defineTemplate({
  slot: 12,
  label: 'Steerable Twin Parallel Wishbones and Knuckle',
  parts: [
    { label: 'Lower wishbone', points: [1, 2, 3, 8] },
    { label: 'Upper wishbone', points: [5, 6, 7, 17, 90] },
    { label: 'Track rod', points: [11, 12] },
    { label: 'Knuckle', points: [11, 18, 19, 20, 21] },
    { label: 'Kingpost', points: [3, 7, 90, 20, 21, 22] },
  ],
  ground: [1, 2, 5, 6, 9, 12, 16],
  points: [
    { no: 1, label: 'Lower wishbone front pivot', def: [1600, 115, -610] },
    { no: 2, label: 'Lower wishbone rear pivot', def: [2300, 115, -610] },
    { no: 3, label: 'Lower wishbone outer ball joint', def: [1950, 695, -610] },
    { no: 5, label: 'Upper wishbone front pivot', def: [1727, 245, -270] },
    { no: 6, label: 'Upper wishbone rear pivot', def: [2173, 245, -270] },
    { no: 7, label: 'Upper wishbone outer ball joint', def: [1950, 615, -265] },
    { no: 8, label: 'Damper wishbone end', def: [1950, 706, -580], gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: [1950, 419, -235], gen: G.Damper1ToBody },
    { no: 11, label: 'Outer track rod ball joint', def: [2142.87011719, 882.140014648, -434.140014648] },
    { no: 12, label: 'Inner track rod ball joint', def: [2115, 395, -442], gen: G.SteeringAttachment },
    { no: 16, label: 'Upper spring pivot point', def: [1950, 585, 210], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: [1950, 593, -65], gen: G.Spring1ToSuspension },
    { no: 18, label: 'Knuckle centre', def: [1950, 915, -405], gen: G.StubAxle },
    { no: 19, label: WHEEL_CENTRE, def: [1950, 960, -405], gen: G.WheelCentre },
    { no: 20, label: 'Knuckle upper axis point', def: [1952.59734543, 908.914759938, -355.43969684], gen: G.UpperBallJoint },
    { no: 21, label: 'Knuckle lower axis point', def: [1947.40265457, 921.085240062, -454.56030316], gen: G.LowerBallJoint },
    { no: 22, label: 'Axis point', def: [1950, 655, -437.5] },
    // The kingpost hinges on the upper wishbone about an axis parallel to the wishbone pivots.
    { no: 90, label: 'Upper trunnion axis (construction)', def: [0, 0, 0], dummy: { at: 7, dir: [5, 6], offset: 100 } },
  ],
});

/** Type 18: the upper wishbone and an upper toe link carry an 'S' link; the upright steers on it. */
const type18 = defineTemplate({
  slot: 18,
  label: "Double Wishbone, Upper Toe Link and 'S' Link",
  parts: [
    { label: 'Lower wishbone', points: [1, 2, 3] },
    { label: 'Upper wishbone', points: [5, 6, 7] },
    { label: 'Track rod', points: [11, 12] },
    { label: 'Upper toe link', points: [20, 21] },
    { label: "'S' link", points: [7, 8, 17, 21, 22, 90] },
    { label: 'Upright', points: [3, 11, 18, 19, 22, 90] },
  ],
  ground: [1, 2, 5, 6, 9, 12, 16, 20],
  points: [
    { no: 1, label: 'Lower wishbone front pivot', def: [3819, 313, 225.899993896] },
    { no: 2, label: 'Lower wishbone rear pivot', def: [4179, 280, 185.899993896] },
    { no: 3, label: 'Lower wishbone outer ball joint', def: [4092, 723.5, 167.100006104], gen: G.LowerBallJoint },
    { no: 5, label: 'Upper wishbone front pivot', def: [4092.5, 420, 452] },
    { no: 6, label: 'Upper wishbone rear pivot', def: [4332, 420, 446] },
    { no: 7, label: 'Upper wishbone outer ball joint', def: [4092.5, 595.5, 454.100006104] },
    { no: 8, label: 'Damper wishbone end', def: [4100, 645, 443.600006104], gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: [4146.5, 550, 703.599975586], gen: G.Damper1ToBody },
    { no: 11, label: 'Outer track rod ball joint', def: [4214.5, 740.5, 208] },
    { no: 12, label: 'Inner track rod ball joint', def: [4245.5, 308, 227], gen: G.SteeringAttachment },
    { no: 16, label: 'Upper spring pivot point', def: [4146.5, 550, 703.599975586], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: [4100, 645, 443.600006104], gen: G.Spring1ToSuspension },
    { no: 18, label: SPINDLE, def: [4092.5, 701, 313.100006104], gen: G.StubAxle },
    { no: 19, label: WHEEL_CENTRE, def: [4092.5, 750, 313.100006104], gen: G.WheelCentre },
    { no: 20, label: 'Upper toe link inboard end', def: [4000, 420, 452] },
    { no: 21, label: 'Upper toe link outboard end', def: [4045.5, 596.5, 454.299987793] },
    { no: 22, label: 'Drop link axis point', def: [4075.5, 705, 404.299987793], gen: G.UpperBallJoint },
    // The upright steers on the 'S' link about the kingpin axis (lower ball joint to drop link axis point).
    { no: 90, label: 'Kingpin axis (construction)', def: [0, 0, 0], dummy: { at: 22, dir: [3, 22], offset: 100 } },
  ],
});

/** Type 19: trailing arm hinged to the upright, located by two lower links and an upper link. */
const t19: Record<number, Vec3> = {
  1: [3360, 300, 190], 2: [3560, 250, 195], 3: [3370, 680, 180], 5: [3550, 680, 185],
  6: [3500, 350, 420], 7: [3480, 650, 415], 9: [3500, 480, 600], 11: [3300, 690, 330], 12: [2950, 600, 250],
  18: [3435, 708.5, 307.1], 19: [3435, 768.5, 307.1], 20: [3300, 690, 230],
};
t19[8] = lerp(t19[2], t19[5], 0.6);
const type19 = defineTemplate({
  slot: 19,
  label: 'Hinged Trailing Arm, Twin Lower Link',
  parts: [
    { label: 'Lower front link', points: [1, 3] },
    { label: 'Lower rear link', points: [2, 5, 8] },
    { label: 'Upper link', points: [6, 7] },
    { label: 'Trailing arm', points: [11, 12, 20] },
    { label: 'Upright', points: [3, 5, 7, 11, 18, 19, 20] },
  ],
  ground: [1, 2, 6, 9, 12],
  points: [
    { no: 1, label: 'Lower front link inboard pivot', def: t19[1] },
    { no: 2, label: 'Lower rear link inboard pivot', def: t19[2] },
    { no: 3, label: 'Lower front link outboard pivot', def: t19[3] },
    { no: 5, label: 'Lower rear link outboard pivot', def: t19[5] },
    { no: 6, label: 'Upper link inboard end', def: t19[6] },
    { no: 7, label: 'Upper link outboard end', def: t19[7] },
    { no: 8, label: 'Spring/damper wishbone end', def: t19[8], gen: [G.Damper1ToSuspension, G.Spring1ToSuspension] },
    { no: 9, label: 'Spring/damper body end', def: t19[9], gen: [G.Damper1ToBody, G.Spring1ToBody] },
    { no: 11, label: 'Trailing arm hinge upper joint', def: t19[11] },
    { no: 12, label: 'Trailing arm to body', def: t19[12] },
    { no: 18, label: SPINDLE, def: t19[18], gen: G.StubAxle },
    { no: 19, label: WHEEL_CENTRE, def: t19[19], gen: G.WheelCentre },
    { no: 20, label: 'Trailing arm hinge lower pivot', def: t19[20] },
  ],
});

/**
 * Twin-link double wishbone (types 20 and 22): each wishbone is two separate links, so both kingpin
 * points are virtual. The spring and damper act on the front lower link.
 */
// The links point at virtual ball joints placed where type 1 has its real ones, so the virtual kingpin
// comes out with ordinary kingpin angle and scrub.
const virtualLower: Vec3 = [4092, 723.5, 167.1];
const virtualUpper: Vec3 = [4092.5, 695.5, 454.1];
const tw: Record<string, Vec3> = {
  lfi: [3850, 320, 215], lri: [4179, 280, 185.9], ufi: [3950, 420, 452], uri: [4332, 420, 446],
  dmpBody: [4060, 475, 593.6], sprBody: [4060, 486, 690],
  tro: [4214.5, 740.5, 208], tri: [4245.5, 308, 227], spindle: [4092.5, 701, 313.1], wc: [4092.5, 750, 313.1],
};
tw.lfo = lerp(tw.lfi, virtualLower, 0.92);
tw.lro = lerp(tw.lri, virtualLower, 0.92);
tw.ufo = lerp(tw.ufi, virtualUpper, 0.9);
tw.uro = lerp(tw.uri, virtualUpper, 0.9);
tw.dmp = lerp(tw.lfi, tw.lfo, 0.75);
tw.spr = lerp(tw.lfi, tw.lfo, 0.7);

const type20 = defineTemplate({
  slot: 20,
  label: 'Double Wishbone, Twin Outer Ball Joints',
  parts: [
    { label: 'Lower front link', points: [1, 3, 8, 17] },
    { label: 'Lower rear link', points: [2, 20] },
    { label: 'Upper front link', points: [5, 7] },
    { label: 'Upper rear link', points: [6, 21] },
    { label: 'Track rod', points: [11, 12] },
    { label: 'Upright', points: [3, 7, 11, 18, 19, 20, 21] },
  ],
  ground: [1, 2, 5, 6, 9, 12, 16],
  points: [
    { no: 1, label: 'Lower wishbone front link inboard pivot', def: tw.lfi },
    { no: 2, label: 'Lower wishbone rear link inboard pivot', def: tw.lri },
    { no: 3, label: 'Lower wishbone front link outboard pivot', def: tw.lfo },
    { no: 5, label: 'Upper wishbone front link inboard pivot', def: tw.ufi },
    { no: 6, label: 'Upper wishbone rear link inboard pivot', def: tw.uri },
    { no: 7, label: 'Upper wishbone front link outboard end', def: tw.ufo },
    { no: 8, label: 'Damper wishbone end', def: tw.dmp, gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: tw.dmpBody, gen: G.Damper1ToBody },
    { no: 11, label: 'Outer track rod ball joint', def: tw.tro },
    { no: 12, label: 'Inner track rod ball joint', def: tw.tri, gen: G.SteeringAttachment },
    { no: 16, label: 'Upper spring pivot point', def: tw.sprBody, gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point (to front lower link)', def: tw.spr, gen: G.Spring1ToSuspension },
    { no: 18, label: SPINDLE, def: tw.spindle, gen: G.StubAxle },
    { no: 19, label: WHEEL_CENTRE, def: tw.wc, gen: G.WheelCentre },
    { no: 20, label: 'Lower wishbone rear link outboard pivot', def: tw.lro },
    { no: 21, label: 'Upper wishbone rear link outboard pivot', def: tw.uro },
  ],
});

const type22 = defineTemplate({
  slot: 22,
  label: 'Double Wishbone, Twin Outer Ball Joints, Spring to Front Link',
  parts: [
    { label: 'Lower front link', points: [1, 3, 7, 12] },
    { label: 'Lower rear link', points: [2, 15] },
    { label: 'Upper front link', points: [4, 6] },
    { label: 'Upper rear link', points: [5, 16] },
    { label: 'Track rod', points: [9, 10] },
    { label: 'Upright', points: [3, 6, 9, 13, 14, 15, 16] },
  ],
  ground: [1, 2, 4, 5, 8, 10, 11],
  points: [
    { no: 1, label: 'Lower wishbone front inner pivot', def: tw.lfi },
    { no: 2, label: 'Lower wishbone rear inner pivot', def: tw.lri },
    { no: 3, label: 'Lower wishbone front outer ball joint', def: tw.lfo },
    { no: 4, label: 'Upper wishbone front inner pivot', def: tw.ufi },
    { no: 5, label: 'Upper wishbone rear inner pivot', def: tw.uri },
    { no: 6, label: 'Upper wishbone front outer ball joint', def: tw.ufo },
    { no: 7, label: 'Damper wishbone end', def: tw.dmp, gen: G.Damper1ToSuspension },
    { no: 8, label: 'Damper body end', def: tw.dmpBody, gen: G.Damper1ToBody },
    { no: 9, label: 'Outer track rod ball joint', def: tw.tro },
    { no: 10, label: 'Inner track rod ball joint', def: tw.tri, gen: G.SteeringAttachment },
    { no: 11, label: 'Upper spring pivot point', def: tw.sprBody, gen: G.Spring1ToBody },
    { no: 12, label: 'Lower spring pivot point', def: tw.spr, gen: G.Spring1ToSuspension },
    { no: 13, label: SPINDLE, def: tw.spindle, gen: G.StubAxle },
    { no: 14, label: WHEEL_CENTRE, def: tw.wc, gen: G.WheelCentre },
    { no: 15, label: 'Lower wishbone rear outer ball joint', def: tw.lro },
    { no: 16, label: 'Upper wishbone rear outer ball joint', def: tw.uro },
  ],
});

/** Type 25: twin lower links (virtual lower ball joint) and a conventional upper wishbone. */
const type25 = defineTemplate({
  slot: 25,
  label: 'Double Wishbone, Twin Lower Outer Ball Joints',
  parts: [
    { label: 'Lower front link', points: [1, 3, 8, 17] },
    { label: 'Lower rear link', points: [2, 20] },
    { label: 'Upper wishbone', points: [5, 6, 7] },
    { label: 'Track rod', points: [11, 12] },
    { label: 'Upright', points: [3, 7, 11, 18, 19, 20] },
  ],
  ground: [1, 2, 5, 6, 9, 12, 16],
  points: [
    { no: 1, label: 'Lower wishbone front inner pivot', def: tw.lfi },
    { no: 2, label: 'Lower wishbone rear inner pivot', def: tw.lri },
    { no: 3, label: 'Lower wishbone front outer ball joint', def: tw.lfo },
    { no: 5, label: 'Upper wishbone front inner pivot', def: [4092.5, 420, 452] },
    { no: 6, label: 'Upper wishbone rear inner pivot', def: [4332, 420, 446] },
    { no: 7, label: 'Upper wishbone outer ball joint', def: [4092.5, 695.5, 454.1], gen: G.UpperBallJoint },
    { no: 8, label: 'Damper wishbone end', def: tw.dmp, gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: tw.dmpBody, gen: G.Damper1ToBody },
    { no: 11, label: 'Outer track rod ball joint', def: tw.tro },
    { no: 12, label: 'Inner track rod ball joint', def: tw.tri, gen: G.SteeringAttachment },
    { no: 16, label: 'Upper spring pivot point', def: tw.sprBody, gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: tw.spr, gen: G.Spring1ToSuspension },
    { no: 18, label: SPINDLE, def: tw.spindle, gen: G.StubAxle },
    { no: 19, label: WHEEL_CENTRE, def: tw.wc, gen: G.WheelCentre },
    { no: 20, label: 'Lower wishbone rear outer ball joint', def: tw.lro },
  ],
});

// Strut axis shared by types 24 and 27 (from the type 3 sample), with the top placed exactly on it.
const strutUpper: Vec3 = [1739.8, 612.25, 368.9];
const strutLower: Vec3 = [1735.439, 617.965, 268.9];
const strutTop = lerp(strutLower, strutUpper, 1 + (847.65 - strutUpper[2]) / (strutUpper[2] - strutLower[2]));

/** Two lower links aimed at the type 3 lower ball joint, which becomes the virtual lower kingpin point. */
const twinLinks = (front: Vec3, rear: Vec3, reach: number): Vec3[] => {
  const v: Vec3 = [1731.68, 736.36, 183.65];
  return [front, rear, lerp(front, v, reach), lerp(rear, v, reach)];
};

/** Steerable Macpherson strut on two lower links (types 24 and 27). Points are numbered 1-13. */
function twinLinkStrut(slot: number, label: string, names: [string, string, string, string, string, string], lower: Vec3[]) {
  return defineTemplate({
    slot,
    label,
    parts: [
      { label: 'Front lower link', points: [1, 3] },
      { label: 'Rear lower link', points: [2, 4] },
      { label: 'Track rod', points: [8, 9] },
      { label: 'Strut / upright', points: [3, 4, 5, 7, 8, 11, 12, 13] },
    ],
    ground: [1, 2, 6, 9, 10],
    points: [
      { no: 1, label: names[0], def: lower[0] },
      { no: 2, label: names[1], def: lower[1] },
      { no: 3, label: names[2], def: lower[2] },
      { no: 4, label: names[3], def: lower[3] },
      { no: 5, label: 'Strut slider upper axis point', def: strutUpper, gen: [G.StrutSliderPoint, G.Damper1ToSuspension] },
      { no: 6, label: 'Strut top point', def: strutTop, gen: G.Damper1ToBody },
      { no: 7, label: 'Strut slider lower axis point', def: strutLower, gen: G.StrutEndPoint },
      { no: 8, label: names[4], def: [1878.4, 675.42, 325.85] },
      { no: 9, label: names[5], def: [1894, 326, 322.65], gen: G.SteeringAttachment },
      { no: 10, label: 'Upper spring pivot point', def: [1759.18, 592, 810.45], gen: G.Spring1ToBody },
      { no: 11, label: 'Lower spring pivot point', def: [1751.8, 620.8, 642.85], gen: G.Spring1ToSuspension },
      { no: 12, label: SPINDLE, def: [1737, 705.33, 305.19], gen: G.StubAxle },
      { no: 13, label: WHEEL_CENTRE, def: [1737, 764.69, 305], gen: G.WheelCentre },
    ],
  });
}

const type24 = twinLinkStrut(
  24,
  'Steerable Macpherson Strut, Twin Outer Ball Joints',
  ['Lower wishbone inner front pivot', 'Lower wishbone inner rear pivot', 'Lower wishbone outer front ball joint', 'Lower wishbone outer rear ball joint', 'Outer track rod ball joint', 'Inner track rod ball joint'],
  twinLinks([1484.06, 448.7, 200.73], [1823.06, 405.19, 191.12], 0.92),
);

const type27 = twinLinkStrut(
  27,
  'Steerable Macpherson Strut, Twin Lower Link',
  ['Front lower link inboard', 'Rear lower link inboard', 'Front lower link outboard', 'Rear lower link outboard', 'Steering arm outboard end', 'Steering arm inboard end'],
  twinLinks([1700, 420, 200], [1450, 450, 205], 0.95),
);

/** Type 28: lower 'H' arm with a drop link for toe control, plus two upper links. Points are numbered 1-15. */
const type28 = defineTemplate({
  slot: 28,
  label: '4-Link Rear, Transverse Control Link',
  parts: [
    { label: 'Lower wishbone', points: [1, 2, 3, 4, 7, 10] },
    { label: 'Drop link', points: [4, 15] },
    { label: 'Upper front link', points: [5, 6] },
    { label: 'Upper rear link', points: [13, 14] },
    { label: 'Upright', points: [3, 6, 11, 12, 14, 15] },
  ],
  ground: [1, 2, 5, 8, 9, 13],
  points: [
    { no: 1, label: 'Lower wishbone front pivot', def: [2955.51, 190, 52.19] },
    { no: 2, label: 'Lower wishbone rear pivot', def: [3435.8, 190, 31.11] },
    { no: 3, label: 'Lower wishbone outer front pivot point', def: [3165.8, 665, 19.61] },
    { no: 4, label: 'Lower wishbone outer rear pivot point', def: [3325.6, 640, 19.61] },
    { no: 5, label: 'Upper front link inner ball joint', def: [3150, 330, 250] },
    { no: 6, label: 'Upper front link outer ball joint', def: [3180, 665, 247.5] },
    { no: 7, label: 'Damper wishbone end', def: [3192.5, 586.87, 67.49], gen: G.Damper1ToSuspension },
    { no: 8, label: 'Damper body end', def: [3218, 469, 403], gen: G.Damper1ToBody },
    { no: 9, label: 'Upper spring pivot point', def: [3218, 469, 403], gen: G.Spring1ToBody },
    { no: 10, label: 'Lower spring pivot point', def: [3192.5, 586.87, 67.49], gen: G.Spring1ToSuspension },
    { no: 11, label: SPINDLE, def: [3250.36, 642, 122], gen: G.StubAxle },
    { no: 12, label: WHEEL_CENTRE, def: [3250.36, 742, 122], gen: G.WheelCentre },
    { no: 13, label: 'Upper rear link inner ball joint', def: [3420, 330, 250] },
    { no: 14, label: 'Upper rear link outer ball joint', def: [3320, 665, 247.5] },
    { no: 15, label: 'Drop link to upright', def: [3330, 665, 90] },
  ],
});

export const MORE_TEMPLATES: Template[] = [type12, type18, type19, type20, type22, type24, type25, type27, type28];
