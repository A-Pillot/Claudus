/**
 * Full-axle built-in templates: rigid axles (types 5, 8, 9, 21) and the two-sided double wishbones
 * (types 23 and 26), which SHARK builds from type 1 with its Edit menu tools.
 *
 * The help gives point lists but no coordinates for these types, so the defaults describe a typical rear
 * axle: wheel centres at x = 3000, track 1520, 310 mm rolling radius (ground at z = 0).
 *
 * A five-link axle (four links plus a Panhard rod or Watts linkage) is over-constrained in roll. SHARK
 * splits it at a "rigid axle revolute" on the centre line so it can roll kinematically (compliance then
 * holds the joint with a stiff bush); Claudus does the same.
 */
import { mirrorY, type Vec3 } from '../math/vec3.js';
import { addRollBar, addTwoPartRack, convertToAxle } from './axle.js';
import { defineTemplate, type PointSpec } from './define.js';
import { GenType as G, type Template } from './types.js';

const X = 3000;
const WC = 760;
const R = 310;

const wheels = (right: number, left: number, stub: number, stubY = 0): PointSpec[] => [
  { no: right, label: 'Right wheel centre', def: [X, WC, R], gen: G.WheelCentre },
  { no: left, label: 'Left wheel centre', def: [X, -WC, R], gen: G.WheelCentre2 },
  { no: stub, label: stubY ? 'Wheel stub axle point' : 'Axle tube - stub axle', def: [X, stubY, R], gen: G.StubAxle },
];

const springs = (n: number): PointSpec[] => [
  { no: n, label: 'Right spring/damper axle', def: [X, 550, 250], gen: [G.Damper1ToSuspension, G.Spring1ToSuspension] },
  { no: n + 1, label: 'Right spring/damper body', def: [X, 530, 550], gen: [G.Damper1ToBody, G.Spring1ToBody] },
  { no: n + 2, label: 'Left spring/damper axle', def: [X, -550, 250], gen: [G.Damper2ToSuspension, G.Spring2ToSuspension] },
  { no: n + 3, label: 'Left spring/damper body', def: [X, -530, 550], gen: [G.Damper2ToBody, G.Spring2ToBody] },
];

const pt = (no: number, label: string, def: Vec3): PointSpec => ({ no, label, def });

/** Data points in number order, as SHARK lists them in model files. */
const byNo = (pts: PointSpec[]): PointSpec[] => [...pts].sort((a, b) => a.no - b.no);

/**
 * The centre revolute that splits a five-link axle, its axis along the axle tube (Y), and a stub axle point
 * for the left half. In roll each side's links want to pitch the axle differently; the revolute lets the
 * halves twist instead of binding.
 */
const splitAxle = (centre: number, leftWheel: number): PointSpec[] => [
  { no: centre, label: 'Centre pivot point', def: [X, 0, R], gen: G.RigidAxleRevolute },
  { no: 90, label: 'Centre pivot axis', def: [0, 0, 0], dummy: { at: centre, vec: [0, 1, 0], offset: 100 } },
  { no: 91, label: 'Left stub axle point', def: [0, 0, 0], gen: G.StubAxle2, dummy: { at: leftWheel, dir: [leftWheel, centre], offset: 100 } },
];

// Four trailing links, upper pair parallel to the lower pair.
const LOWER_BODY: Vec3 = [2550, 450, 220];
const LOWER_AXLE: Vec3 = [X, 450, 200];
const UPPER_BODY: Vec3 = [2650, 400, 450];
const UPPER_AXLE: Vec3 = [X, 400, 430];

const fourLinks = (): PointSpec[] => [
  pt(1, 'Right lower link body end', LOWER_BODY),
  pt(2, 'Right upper link body end', UPPER_BODY),
  pt(3, 'Left lower link body end', mirrorY(LOWER_BODY)),
  pt(4, 'Left upper link body end', mirrorY(UPPER_BODY)),
  pt(5, 'Right lower link axle end', LOWER_AXLE),
  pt(6, 'Right upper link axle end', UPPER_AXLE),
  pt(7, 'Left lower link axle end', mirrorY(LOWER_AXLE)),
  pt(8, 'Left upper link axle end', mirrorY(UPPER_AXLE)),
];

const fourLinkParts = [
  { label: 'Right lower link', points: [1, 5] },
  { label: 'Right upper link', points: [2, 6] },
  { label: 'Left lower link', points: [3, 7] },
  { label: 'Left upper link', points: [4, 8] },
];

const type5 = defineTemplate({
  slot: 5,
  label: '5-Link Rigid Axle (Panhard Rod)',
  fullAxle: true,
  rigidAxle: true,
  parts: [
    ...fourLinkParts,
    { label: 'Panhard rod', points: [9, 10] },
    { label: 'Axle (right)', points: [5, 6, 10, 11, 15, 16, 18, 90] },
    { label: 'Axle (left)', points: [7, 8, 13, 15, 17, 90, 91] },
  ],
  ground: [1, 2, 3, 4, 9, 12, 14],
  points: byNo([
    ...fourLinks(),
    pt(9, 'Panhard rod body end', [X + 80, -600, 330]),
    pt(10, 'Panhard rod axle end', [X + 80, 600, 300]),
    ...springs(11),
    ...wheels(16, 17, 18, WC - 100),
    ...splitAxle(15, 17),
  ]),
});

const type8 = defineTemplate({
  slot: 8,
  label: '4-Link Rigid Axle (Panhard Rod)',
  fullAxle: true,
  rigidAxle: true,
  parts: [
    { label: 'Right lower link', points: [1, 5] },
    { label: 'Left lower link', points: [3, 6] },
    { label: 'Upper link', points: [2, 4] },
    { label: 'Panhard rod', points: [7, 8] },
    { label: 'Axle', points: [4, 5, 6, 8, 9, 11, 18, 19, 20] },
  ],
  ground: [1, 2, 3, 7, 10, 12],
  points: byNo([
    pt(1, 'Right lower link body end', LOWER_BODY),
    pt(2, 'Upper link body end', [2650, 0, 450]),
    pt(3, 'Left lower link body end', mirrorY(LOWER_BODY)),
    pt(4, 'Upper link axle end', [X, 0, 430]),
    pt(5, 'Right lower link axle end', LOWER_AXLE),
    pt(6, 'Left lower link axle end', mirrorY(LOWER_AXLE)),
    pt(7, 'Panhard rod body end', [X + 80, -600, 330]),
    pt(8, 'Panhard rod axle end', [X + 80, 600, 300]),
    ...springs(9),
    ...wheels(19, 20, 18),
  ]),
});

const type9 = defineTemplate({
  slot: 9,
  label: '4-Link Rigid Axle (Twin Upper)',
  fullAxle: true,
  rigidAxle: true,
  parts: [
    { label: 'Right lower link', points: [1, 4] },
    { label: 'Right upper link', points: [2, 5] },
    { label: 'Left lower link', points: [3, 6] },
    { label: 'Left upper link', points: [7, 8] },
    { label: 'Axle', points: [4, 5, 6, 8, 9, 11, 18, 19, 20] },
  ],
  ground: [1, 2, 3, 7, 10, 12],
  points: byNo([
    pt(1, 'Right lower link body end', [2550, 500, 220]),
    pt(2, 'Right upper link body end', [2650, 200, 450]),
    pt(3, 'Left lower link body end', [2550, -500, 220]),
    pt(4, 'Right lower link axle end', [X, 500, 200]),
    pt(5, 'Right upper link axle end', [X, 450, 430]),
    pt(6, 'Left lower link axle end', [X, -500, 200]),
    pt(7, 'Left upper link body end', [2650, -200, 450]),
    pt(8, 'Left upper link axle end', [X, -450, 430]),
    ...springs(9),
    ...wheels(19, 20, 18),
  ]),
});

const type21 = defineTemplate({
  slot: 21,
  label: '5-Link Rigid Axle (Watts Linkage)',
  fullAxle: true,
  rigidAxle: true,
  parts: [
    ...fourLinkParts,
    { label: 'Watts upper link', points: [19, 20] },
    { label: 'Watts lower link', points: [21, 22] },
    { label: 'Watts cross link', points: [9, 10, 19, 21] },
    { label: 'Axle (right)', points: [5, 6, 9, 10, 11, 15, 16, 18, 90] },
    { label: 'Axle (left)', points: [7, 8, 13, 15, 17, 90, 91] },
  ],
  ground: [1, 2, 3, 4, 12, 14, 20, 22],
  points: byNo([
    ...fourLinks(),
    // The cross link turns on the axle about the line through points 9 and 10.
    pt(9, 'Watts cross link 1', [X + 120, 0, 300]),
    pt(10, 'Watts cross link 2', [X + 170, 0, 300]),
    ...springs(11),
    ...wheels(16, 17, 18, WC - 100),
    pt(19, 'Watts upper link axle end', [X + 170, 0, 400]),
    pt(20, 'Watts upper link body end', [X + 170, -500, 400]),
    pt(21, 'Watts lower link axle end', [X + 170, 0, 200]),
    pt(22, 'Watts lower link body end', [X + 170, 500, 200]),
    ...splitAxle(15, 17),
  ]),
});

export const RIGID_AXLES: Template[] = [type5, type8, type9, type21];

export const RIGID_AXLE_ROLLING_RADIUS: Record<number, number> = { 5: R, 8: R, 9: R, 21: R };

/** Types 23 and 26: type 1 converted to a full axle, with an anti-roll bar or a two-part compliant rack. */
export function twoSidedTemplates(type1: Template): Template[] {
  const axle = (slot: number, label: string) => convertToAxle(type1, { slot, label, startNo: 24 });
  const t23 = addRollBar(axle(23, 'Double Wishbone, Anti-Roll Bar'), {
    part: 'Lower wishbone',
    link: [4170, 560, 195],
    barEnd: [4170, 560, 330],
    mount: [4350, 350, 330],
    startNo: 42,
  });
  const t26 = addTwoPartRack(axle(26, 'Double Wishbone, Compliant Rack'), {
    link: [4245.5, 250, 227],
    mount: [4275, 250, 227],
    startNo: 42,
  });
  return [t23, t26].map((t) => ({ ...t, source: 'builtin' as const }));
}
