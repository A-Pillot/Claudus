# Claudus

This is a clone of Lotus Shark made by Claude.

Claudus rebuilds the Lotus SHARK suspension analysis tool (v4.03) as a modern TypeScript app. It reads
SHARK `.dat` model files, solves the suspension kinematics, and lists the same suspension derivatives.

## Status

Phase 1, the calculation core (`packages/core`), is done:

- **Templates:** 12 built-in suspension types: 1, 2, 3, 4, 6, 7, 10, 11, 14, 15, 16 and 17. Point numbers,
  labels and default coordinates match SHARK's own sample files.
- **Files:** SHARK `.dat` model files are read and written. Sections that Claudus does not use yet, such
  as compliance, forces and Raven data, are kept unchanged.
- **Solver:** a kinematic solver handles bump and rebound, body roll about the static roll centre, rack
  steer, and combinations of these.
- **Derivatives:** camber, toe (SAE and in the wheel plane), castor, kingpin, trails and offsets, roll
  centre (in bump and in roll), anti-dive, anti-squat, damper and spring ratio and travel, half-track and
  wheelbase change, Ackermann and turning radius.
- **Output:** a formatted SDF listing, from the command line.

Next up:

- The interactive 3D app with graphs (React, three.js, Tauri).
- The remaining templates, the template editor and the 2D module.
- Compliance.
- Modal analysis, the forced-damped response and the optimiser.

## Use

```sh
npm install
npm test                         # vitest
npm run typecheck
npm run sdf -- packages/core/test/samples/type1.dat    # print the derivative listing
npm run sdf -- model.dat out.sdf                       # or write it to a file
```

## Conventions

These follow SHARK.

- **Axes:** X points rearward, Y to the right and Z up, in mm. The modelled corner is the right-hand one
  (+Y). The left-hand corner is its mirror image.
- **Roll:** positive roll puts the right-hand corner into bump. The body rolls about the static roll
  centre.
- **Steer:** steer is rack travel in mm along +Y.
- **Signs:** derivative signs follow the SHARK help's Theory topic (SAE J670e plus Lotus definitions). For
  example, positive camber means the top of the wheel leans out, and positive toe means toe-in.

## How the solver works

Each part with three or more points is a rigid body. A part with two points is a fixed-length link.

- A point shared by two parts is a joint between them.
- The wheel keeps its lowest point on the ground plane.
- A Macpherson strut top stays on the strut axis.

The constraints are solved with a damped least-squares (Levenberg-Marquardt) method. Redundant joints,
such as revolutes modelled as two ball joints, are therefore not a problem.
