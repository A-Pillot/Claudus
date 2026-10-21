# Claudus

This is a clone of Lotus Shark made by Claude.

Claudus rebuilds the Lotus SHARK suspension analysis tool (v4.03) as a modern TypeScript app. It reads
SHARK `.dat` model files, solves the suspension kinematics, and lists the same suspension derivatives.

## Status

**Phase 1, the calculation core (`packages/core`)**
- **Templates:** 21 built-in suspension types: 1, 2, 3, 4, 6, 7, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20,
  22, 24, 25, 27 and 28.
  - Point numbers and labels follow the SHARK help.
  - Default coordinates come from SHARK's sample files where there is one. SHARK shipped no sample for
    types 19, 20, 22, 24, 25, 27 and 28, so their defaults are designed layouts.
  - Templates with linked lower or upper arms use a virtual steering axis. Like SHARK, Claudus finds it
    from a small steering movement.
- **Files:** SHARK `.dat` model files are read and written. Sections Claudus does not use yet, such as
  compliance, forces and Raven data, are kept unchanged.
- **Solver:** handles bump and rebound, body roll about the static roll centre, rack steer, and
  combinations of these.
- **Derivatives:** the full SHARK set, plus a formatted SDF listing.

**Phase 2, the app (`packages/app`)**
- **3D view:** both corners of the axle, with wheels, springs, dampers and the roll centre. You can orbit
  the view, and clicking a point selects it.
- **Motion:** sliders for bump, roll and steer, each with an animate button.
- **Live readouts:** camber, toe, castor, kingpin, trails, offsets, roll centre and track.
- **Editing:** a hard point table and the general data panel. Results update as you edit.
- **Graphs:** four configurable graphs of any derivative against bump, roll or steer, with front and rear
  overlaid.
- **SDF:** a listing view, with export.
- **Files:** New (from any template), Open and Save for `.dat` files.
- **Desktop:** a Tauri desktop app with native file dialogs.

Next up:
- The rigid axles and the two-sided templates (5, 8, 9, 21, 23, 26 and 29).
- The template editor and the 2D module.
- Compliance.
- Modal analysis, the forced-damped response and the optimiser.

## Use

```sh
npm install
npm run dev              # app in the browser at http://localhost:5173
npm test                 # vitest
npm run typecheck
npm run sdf -- packages/core/test/samples/type1.dat    # derivative listing on the command line
```

### Desktop app

Installers for Windows (`.msi` and `.exe`), macOS (`.dmg`) and Linux (`.AppImage` and `.deb`) are built
by the **Desktop builds** workflow.

- **Manual run:** start it from the Actions tab, then download the installers from the run's artifacts.
- **Tagged release:** push a tag like `v0.2.0` to get a draft release with the installers attached.

To build locally you need [Rust and the Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
Then run:

```sh
npm run desktop          # run the desktop app in development
npm run desktop:build    # build an installer for this machine
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
