/**
 * Built-in suspension templates, rebuilt from the SHARK v4.03 help file.
 *
 * Point numbers and labels follow the help's "Data Requirements - Type N" topics. Default coordinates
 * come from the sample model files shipped with SHARK (DataFiles/typeN.dat). Part connectivity is
 * reconstructed from the point descriptions and the help screenshots, because SHARK compiled it into the
 * executable.
 */
import { GenType as G } from './types.js';
import { defineTemplate } from './define.js';
import type { Template } from './types.js';

// Common double-wishbone point labels (types 1, 6, 14, 15, 17...)
const DW = {
  1: 'Lower wishbone front pivot',
  2: 'Lower wishbone rear pivot',
  3: 'Lower wishbone outer ball joint',
  5: 'Upper wishbone front pivot',
  6: 'Upper wishbone rear pivot',
  7: 'Upper wishbone outer ball joint',
  11: 'Outer track rod ball joint',
  12: 'Inner track rod ball joint',
  18: 'Wheel spindle point',
  19: 'Wheel centre point',
};

const type1 = defineTemplate({
  slot: 1,
  label: 'Double Wishbone, damper to lower wishbone',
  parts: [
    { label: 'Lower wishbone', points: [1, 2, 3, 8, 17] },
    { label: 'Upper wishbone', points: [5, 6, 7] },
    { label: 'Track rod', points: [11, 12] },
    { label: 'Upright', points: [3, 7, 11, 18, 19] },
  ],
  ground: [1, 2, 5, 6, 9, 12, 16],
  points: [
    { no: 1, label: DW[1], def: [3819, 313, 225.6] },
    { no: 2, label: DW[2], def: [4179, 280, 185.9] },
    { no: 3, label: DW[3], def: [4092, 723.5, 167.1], gen: G.LowerBallJoint },
    { no: 5, label: DW[5], def: [4092.5, 420, 452] },
    { no: 6, label: DW[6], def: [4332, 420, 446] },
    { no: 7, label: DW[7], def: [4092.5, 695.5, 454.1], gen: G.UpperBallJoint },
    { no: 8, label: 'Damper wishbone end', def: [4146.5, 600, 203.6], gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: [4180, 475, 593.6], gen: G.Damper1ToBody },
    { no: 11, label: DW[11], def: [4214.5, 740.5, 208] },
    { no: 12, label: DW[12], def: [4245.5, 308, 227], gen: G.SteeringAttachment },
    { no: 16, label: 'Upper spring pivot point', def: [4180, 486, 690], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: [4145, 645, 210], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [4092.5, 701, 313.1], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [4092.5, 750, 313.1], gen: G.WheelCentre },
  ],
});

const type2 = defineTemplate({
  slot: 2,
  label: "Lower 'H' frame, single upper link",
  parts: [
    { label: 'H frame', points: [1, 2, 3, 5, 8, 17] },
    { label: 'Upper link', points: [6, 7] },
    { label: 'Upright', points: [3, 5, 7, 18, 19] },
  ],
  ground: [1, 2, 6, 9, 16],
  points: [
    { no: 1, label: 'Lower wishbone front pivot', def: [2955.51, 190, 52.19] },
    { no: 2, label: 'Lower wishbone rear pivot', def: [3435.8, 190, 31.11] },
    { no: 3, label: 'Lower wishbone outer front pivot point', def: [3165.8, 665, 19.61] },
    { no: 5, label: 'Lower wishbone outer rear pivot point', def: [3325.6, 665, 19.61] },
    { no: 6, label: 'Upper link inner ball joint', def: [3289.5, 330, 250] },
    { no: 7, label: 'Upper link outer ball joint', def: [3287.4, 665, 247.5] },
    { no: 8, label: 'Damper wishbone end', def: [3192.5, 586.87, 67.49], gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: [3218, 469, 403], gen: G.Damper1ToBody },
    { no: 16, label: 'Upper spring pivot point', def: [3218, 469, 403], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: [3192.5, 586.87, 67.49], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [3250.36, 642, 122], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [3250.36, 742, 122], gen: G.WheelCentre },
  ],
});

const type3 = defineTemplate({
  slot: 3,
  label: 'Steerable Macpherson Strut',
  parts: [
    { label: 'Lower wishbone', points: [1, 2, 3] },
    { label: 'Track rod', points: [11, 12] },
    { label: 'Strut / upright', points: [3, 6, 8, 11, 17, 18, 19] },
  ],
  ground: [1, 2, 7, 12, 16],
  points: [
    { no: 1, label: DW[1], def: [1484.06, 448.7, 200.73] },
    { no: 2, label: DW[2], def: [1823.06, 405.19, 191.12] },
    { no: 3, label: DW[3], def: [1731.68, 736.36, 183.65], gen: G.LowerBallJoint },
    { no: 6, label: 'Strut slider axis point', def: [1739.8, 612.25, 368.9], gen: [G.StrutSliderPoint, G.Damper1ToSuspension] },
    { no: 7, label: 'Strut top point', def: [1760.68, 584.89, 847.65], gen: G.Damper1ToBody },
    { no: 8, label: 'Strut slider lower axis point', def: [1735.439, 617.965, 268.9], gen: G.StrutEndPoint },
    { no: 11, label: DW[11], def: [1878.4, 675.42, 325.85] },
    { no: 12, label: DW[12], def: [1894, 326, 322.65], gen: G.SteeringAttachment },
    { no: 16, label: 'Upper spring pivot point', def: [1759.18, 592, 810.45], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: [1751.8, 620.8, 642.85], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [1737, 705.33, 305.19], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [1737, 764.69, 305], gen: G.WheelCentre },
  ],
});

const type4 = defineTemplate({
  slot: 4,
  label: 'Non-Steerable Macpherson Strut, twin lower link',
  parts: [
    { label: 'Front lower link', points: [1, 3] },
    { label: 'Rear lower link', points: [2, 5] },
    { label: 'Reaction rod', points: [11, 12] },
    { label: 'Strut / upright', points: [3, 5, 6, 8, 11, 17, 18, 19] },
  ],
  ground: [1, 2, 7, 12, 16],
  points: [
    { no: 1, label: 'Front lower link inboard', def: [3375, 340, 233] },
    { no: 2, label: 'Rear lower link inboard', def: [3580, 340, 233] },
    { no: 3, label: 'Front lower link outboard', def: [3415, 661.7, 202.5] },
    { no: 5, label: 'Rear lower link outboard', def: [3570, 661.7, 202.5] },
    { no: 6, label: 'Strut slider axis point', def: [3480, 584, 463], gen: [G.StrutSliderPoint, G.Damper1ToSuspension] },
    { no: 7, label: 'Strut top point', def: [3534, 536.1, 890], gen: G.Damper1ToBody },
    { no: 8, label: 'Strut slider lower axis point', def: [3451.02, 609.707, 233.841], gen: G.StrutEndPoint },
    { no: 11, label: 'Reaction rod outboard point', def: [3467, 600, 139] },
    { no: 12, label: 'Reaction rod body point', def: [2875, 580, 181] },
    { no: 16, label: 'Spring top centre line', def: [3530.5, 541, 757.3], gen: G.Spring1ToBody },
    { no: 17, label: 'Spring bottom at centre line', def: [3513, 591, 588.7], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [3480, 620, 264.2], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [3480, 715, 265], gen: G.WheelCentre },
  ],
});

const type6 = defineTemplate({
  slot: 6,
  label: 'Double Wishbone, damper to upper wishbone',
  parts: [
    { label: 'Lower wishbone', points: [1, 2, 3] },
    { label: 'Upper wishbone', points: [5, 6, 7, 8, 17] },
    { label: 'Track rod', points: [11, 12] },
    { label: 'Upright', points: [3, 7, 11, 18, 19] },
  ],
  ground: [1, 2, 5, 6, 9, 12, 16],
  points: [
    { no: 1, label: DW[1], def: [3819, 313, 225.6] },
    { no: 2, label: DW[2], def: [4179, 280, 185.9] },
    { no: 3, label: DW[3], def: [4092, 723.5, 167.1], gen: G.LowerBallJoint },
    { no: 5, label: DW[5], def: [4092.5, 420, 452] },
    { no: 6, label: DW[6], def: [4332, 420, 446] },
    { no: 7, label: DW[7], def: [4092.5, 695.5, 454.1], gen: G.UpperBallJoint },
    { no: 8, label: 'Damper wishbone end', def: [4145, 575, 475], gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: [4180, 405, 800], gen: G.Damper1ToBody },
    { no: 11, label: DW[11], def: [4214.5, 740.5, 208] },
    { no: 12, label: DW[12], def: [4245.5, 308, 227], gen: G.SteeringAttachment },
    { no: 16, label: 'Upper spring pivot point', def: [4180, 405, 800], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: [4145, 575, 475], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [4092.5, 701, 313.1], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [4092.5, 750, 313.1], gen: G.WheelCentre },
  ],
});

const type7 = defineTemplate({
  slot: 7,
  label: 'Non-Steerable Macpherson Strut, toe link to wishbone',
  parts: [
    { label: 'Lower wishbone', points: [1, 2, 3, 12, 17] },
    { label: 'Toe link', points: [11, 12] },
    { label: 'Strut / upright', points: [3, 6, 8, 11, 18, 19] },
  ],
  ground: [1, 2, 7, 16],
  points: [
    { no: 1, label: DW[1], def: [4489, 286, 286.8] },
    { no: 2, label: DW[2], def: [4768, 286, 279.5] },
    { no: 3, label: DW[3], def: [4567, 706, 226.5], gen: G.LowerBallJoint },
    { no: 6, label: 'Strut slider axis point', def: [4513, 602, 423], gen: [G.StrutSliderPoint, G.Damper1ToSuspension] },
    { no: 7, label: 'Strut top point', def: [4527.37, 531.5, 832.8], gen: G.Damper1ToBody },
    { no: 8, label: 'Strut slider lower axis point', def: [4507.66, 628.196, 270.73], gen: G.StrutEndPoint },
    { no: 11, label: 'Outer track rod ball joint', def: [4452.79, 686, 229.5] },
    { no: 12, label: 'Steering link to wishbone ball joint', def: [4449, 379, 270.5] },
    { no: 16, label: 'Upper spring pivot point', def: [4643, 496.5, 443.5], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point on lower arm', def: [4631, 544, 198.5], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [4552, 682.5, 309], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [4552, 767.9, 309.5], gen: G.WheelCentre },
  ],
});

const type10 = defineTemplate({
  slot: 10,
  label: 'Trailing Arm, upper and lower rear links',
  parts: [
    { label: 'Lower link', points: [2, 3] },
    { label: 'Upper link', points: [5, 7] },
    { label: 'Trailing arm', points: [1, 3, 7, 8, 17, 18, 19] },
  ],
  ground: [1, 2, 5, 9, 16],
  points: [
    { no: 1, label: 'Trailing arm front pivot', def: [2891, 410, 207] },
    { no: 2, label: 'Lower link inner ball joint', def: [3625.5, 126, 190.5] },
    { no: 3, label: 'Lower link outer ball joint', def: [3492, 595, 166.1] },
    { no: 5, label: 'Upper link inner ball joint', def: [3491, 410, 424.1] },
    { no: 7, label: 'Upper link outer ball joint', def: [3491, 630, 423.1] },
    { no: 8, label: 'Damper lower trailing arm end', def: [3494, 595, 166.1], gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: [3450, 300, 600], gen: G.Damper1ToBody },
    { no: 16, label: 'Upper spring pivot point', def: [3450, 300, 600], gen: G.Spring1ToBody },
    { no: 17, label: 'Spring lower trailing arm end', def: [3494, 595, 166.1], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [3435, 708.5, 307.1], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [3435, 768.5, 307.1], gen: G.WheelCentre },
  ],
});

const type11 = defineTemplate({
  slot: 11,
  label: 'Semi Trailing Arm',
  parts: [{ label: 'Semi trailing arm', points: [1, 2, 8, 17, 18, 19] }],
  ground: [1, 2, 9, 16],
  points: [
    { no: 1, label: 'Lower wishbone front pivot', def: [2988, 577, 350] },
    { no: 2, label: 'Lower wishbone rear pivot', def: [3062, 155, 310] },
    { no: 8, label: 'Damper lower trailing arm end', def: [3548, 589.2, 320], gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: [3538, 520, 800], gen: G.Damper1ToBody },
    { no: 16, label: 'Upper spring pivot point', def: [3276, 499, 800], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: [3326, 504.6, 420], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [3440, 700, 297], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [3440, 725, 297], gen: G.WheelCentre },
  ],
});

/** Shared point list for the pushrod / rocker family (types 14, 15). */
function rockerFamily(slot: number, label: string, pushrodOnUpper: boolean, coords: Record<number, [number, number, number]>) {
  return defineTemplate({
    slot,
    label,
    parts: [
      { label: 'Lower wishbone', points: pushrodOnUpper ? [1, 2, 3] : [1, 2, 3, 8] },
      { label: 'Upper wishbone', points: pushrodOnUpper ? [5, 6, 7, 8] : [5, 6, 7] },
      { label: 'Track rod', points: [11, 12] },
      { label: 'Push rod', points: [8, 9] },
      { label: 'Rocker', points: [9, 17, 20, 21] },
      { label: 'Upright', points: [3, 7, 11, 18, 19] },
    ],
    ground: [1, 2, 5, 6, 12, 16, 20, 21],
    points: [
      { no: 1, label: DW[1], def: coords[1] },
      { no: 2, label: DW[2], def: coords[2] },
      { no: 3, label: DW[3], def: coords[3], gen: G.LowerBallJoint },
      { no: 5, label: DW[5], def: coords[5] },
      { no: 6, label: DW[6], def: coords[6] },
      { no: 7, label: DW[7], def: coords[7], gen: G.UpperBallJoint },
      { no: 8, label: 'Push rod wishbone end', def: coords[8] },
      { no: 9, label: 'Push rod rocker end', def: coords[9] },
      { no: 11, label: DW[11], def: coords[11] },
      { no: 12, label: DW[12], def: coords[12], gen: G.SteeringAttachment },
      { no: 16, label: 'Damper to body point', def: coords[16], gen: [G.Damper1ToBody, G.Spring1ToBody] },
      { no: 17, label: 'Damper to rocker point', def: coords[17], gen: [G.Damper1ToSuspension, G.Spring1ToSuspension] },
      { no: 18, label: DW[18], def: coords[18], gen: G.StubAxle },
      { no: 19, label: DW[19], def: coords[19], gen: G.WheelCentre },
      { no: 20, label: 'Rocker axis 1st point', def: coords[20] },
      { no: 21, label: 'Rocker axis 2nd point', def: coords[21] },
    ],
  });
}

const type14 = rockerFamily(14, 'Double Wishbone, push rod to damper', false, {
  1: [-21.5, 75, 163], 2: [588, 75, 165], 3: [156.6, 805.5, 189], 5: [19.7, 148.39, 377], 6: [588, 148.39, 377],
  7: [162, 772.5, 408.5], 8: [150, 700, 225], 9: [175, 200, 475], 11: [80, 798, 405], 12: [-21.5, 153, 372.5],
  16: [550, 75, 505], 17: [150, 70, 475], 18: [160, 794, 306], 19: [160, 894, 310], 20: [250, 192, 500], 21: [240, 178, 450],
});

const type15 = rockerFamily(15, 'Double Wishbone, rocker arm damper', true, {
  1: [-21.5, 75, 163], 2: [588, 75, 165], 3: [156.6, 805.5, 189], 5: [19.7, 148.39, 377], 6: [588, 148.39, 377],
  7: [162, 772.5, 408.5], 8: [150, 700, 425], 9: [165, 350, 225], 11: [80, 798, 405], 12: [-21.5, 153, 372.5],
  16: [155, 175, 585], 17: [162, 300, 245], 18: [160, 794, 306], 19: [160, 894, 310], 20: [205, 92, 285], 21: [100, 92, 288],
});

const type16 = defineTemplate({
  slot: 16,
  label: "Non-Steerable lower 'A' with toe link",
  parts: [
    { label: 'Upper wishbone', points: [1, 2, 3, 8, 17] },
    { label: "Lower 'A' arm", points: [5, 6, 7] },
    { label: 'Toe link', points: [11, 12] },
    { label: 'Upright', points: [3, 5, 7, 11, 18, 19] },
  ],
  ground: [1, 2, 6, 9, 12, 16],
  points: [
    { no: 1, label: 'Upper wishbone front pivot', def: [-21.5, 75, 563] },
    { no: 2, label: 'Upper wishbone rear pivot', def: [588, 75, 565] },
    { no: 3, label: 'Upper wishbone outer ball joint', def: [156.6, 705.5, 589] },
    { no: 5, label: 'Front lower link outboard', def: [19.7, 778.4, 107] },
    { no: 6, label: 'Lower link inboard ball joint', def: [388, 148.4, 177] },
    { no: 7, label: 'Rear lower link outboard', def: [262, 772.5, 108.5] },
    { no: 8, label: 'Damper wishbone end', def: [150, 500, 575], gen: G.Damper1ToSuspension },
    { no: 9, label: 'Damper body end', def: [155, 200, 875], gen: G.Damper1ToBody },
    { no: 11, label: 'Reaction rod outboard point', def: [20, 598, 105] },
    { no: 12, label: 'Reaction rod body point', def: [-221.5, 153, 222.5] },
    { no: 16, label: 'Upper spring pivot point', def: [155, 200, 875], gen: G.Spring1ToBody },
    { no: 17, label: 'Lower spring pivot point', def: [150, 500, 575], gen: G.Spring1ToSuspension },
    { no: 18, label: DW[18], def: [160, 794, 306], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [160, 894, 310], gen: G.WheelCentre },
  ],
});

const type17 = defineTemplate({
  slot: 17,
  label: 'Double Wishbone, pushrod monoshock',
  parts: [
    { label: 'Lower wishbone', points: [1, 2, 3, 8] },
    { label: 'Upper wishbone', points: [5, 6, 7] },
    { label: 'Track rod', points: [11, 12] },
    { label: 'Push rod', points: [8, 9] },
    { label: 'Rocker', points: [9, 20, 21, 22] },
    { label: 'Second link', points: [22, 23] },
    { label: 'Damper rocker', points: [17, 23, 24, 25] },
    { label: 'Upright', points: [3, 7, 11, 18, 19] },
  ],
  ground: [1, 2, 5, 6, 12, 16, 20, 21, 24, 25],
  points: [
    { no: 1, label: DW[1], def: [-21.5, 75, 163] },
    { no: 2, label: DW[2], def: [588, 75, 165] },
    { no: 3, label: DW[3], def: [156.6, 805.5, 189], gen: G.LowerBallJoint },
    { no: 5, label: DW[5], def: [19.7, 148.39, 377] },
    { no: 6, label: DW[6], def: [588, 148.39, 377] },
    { no: 7, label: DW[7], def: [162, 772.5, 408.5], gen: G.UpperBallJoint },
    { no: 8, label: 'Push rod wishbone end', def: [150, 700, 225] },
    { no: 9, label: 'Push rod rocker end', def: [175, 200, 475] },
    { no: 11, label: DW[11], def: [80, 798, 405] },
    { no: 12, label: DW[12], def: [-21.5, 153, 372.5], gen: G.SteeringAttachment },
    { no: 16, label: 'Damper to body point', def: [650, 0, 505], gen: [G.Damper1ToBody, G.Spring1ToBody] },
    { no: 17, label: 'Damper to rocker point', def: [225, 0, 475], gen: [G.Damper1ToSuspension, G.Spring1ToSuspension] },
    { no: 18, label: DW[18], def: [160, 794, 306], gen: G.StubAxle },
    { no: 19, label: DW[19], def: [160, 894, 310], gen: G.WheelCentre },
    { no: 20, label: 'Rocker axis 1st point', def: [250, 192, 500] },
    { no: 21, label: 'Rocker axis 2nd point', def: [240, 178, 450] },
    { no: 22, label: '2nd link 1st rocker end', def: [150, 90, 475] },
    { no: 23, label: '2nd link damper rocker end', def: [255, 70, 485] },
    { no: 24, label: 'Damper rocker axis 1st point', def: [245, 100, 400] },
    { no: 25, label: 'Damper rocker axis 2nd point', def: [245, -100, 400] },
  ],
});

export const BUILTIN_TEMPLATES: Template[] = [type1, type2, type3, type4, type6, type7, type10, type11, type14, type15, type16, type17];

/** Default rolling radius (mm) for each built-in template's sample model. */
export const BUILTIN_ROLLING_RADIUS: Record<number, number> = { 16: 310 };
