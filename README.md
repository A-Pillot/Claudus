# Claudus

This is a clone of Lotus Shark made by Claude.

Claudus rebuilds the Lotus SHARK suspension analysis tool (v4.03) as a modern TypeScript app. It reads
SHARK `.dat` model files, solves the suspension kinematics, and lists the same suspension derivatives.

## Status

**Phase 1, the calculation core (`packages/core`)**
- **Templates:** 28 built-in suspension types: 1 to 12 and 14 to 29.
  - Corner models: 1, 2, 3, 4, 6, 7, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 22, 24, 25, 27 and 28.
  - Rigid axles: 5, 8 and 21 (Panhard rod, Watts linkage) and 9 (twin upper links).
  - Two-sided double wishbones: 23 (anti-roll bar) and 26 (two-part compliant rack).
  - Twist beam: 29. The two trailing arms meet at a shear point. Kinematically the beam is rigid in bending
    and free to twist; in compliance it twists at the end's roll bar rate.
  - Point numbers and labels follow the SHARK help.
  - Default coordinates come from SHARK's sample files where there is one. SHARK shipped no sample for
    types 5, 8, 9, 19, 20, 21, 22, 24, 25, 27 and 28, so their defaults are designed layouts. Types 23 and
    26 are built from type 1 with the same tools SHARK's Edit menu offers.
  - Templates with linked lower or upper arms use a virtual steering axis. Like SHARK, Claudus finds it
    from a small steering movement.
- **Files:** SHARK `.dat` model files are read and written. Sections Claudus does not use yet, such as
  compliance, forces and Raven data, are kept unchanged.
- **Solver:** handles bump and rebound, body roll about the static roll centre, rack steer, and
  combinations of these.
- **Full axles:** templates that model both wheels are solved in one go, with bump moving both wheels.
  For a rigid axle the roll centre is where the normals to the two contact paths meet for opposed wheel
  travel, which is the centre the axle rolls about relative to the body.
- **Template tools:** Convert Corner to Axle, Add Roll Bar and Add Two Part Rack, as functions in the core.
  They get their menu entries with the template editor.
- **Derivatives:** the full SHARK set, plus a formatted SDF listing.

**Phase 2, the app (`packages/app`)**
- **3D view:** both sides of the axle, with wheels, springs, dampers and the roll centre. You can orbit
  the view, and clicking a point selects it.
- **Motion:** sliders for bump, roll and steer, each with an animate button.
- **Live readouts:** camber, toe, castor, kingpin, trails, offsets, roll centre and track.
- **Editing:** a hard point table and the general data panel. Results update as you edit.
- **Graphs:** four configurable graphs of any derivative against bump, roll or steer, with front and rear
  overlaid.
- **SDF:** a listing view, with export.
- **Files:** New (from any template), Open and Save for `.dat` files.
- **Desktop:** a Tauri desktop app with native file dialogs.

**2D module (`packages/core/src/twod`, `packages/app/src/twod`)**
- **Files:** SHARK 2D `.dat` files (double wishbone and Macpherson strut) are read and written exactly. Opening one
  switches to the 2D module, and New offers both 2D types.
- **Solver:** cross-car (Y-Z) solution of both types in bump, rebound and roll, giving camber, roll centre height
  and lateral position, half track change and the instant centres.
- **Targets:** user lines (camber, roll centre height and lateral against bump and roll) start from the slopes in the
  general data and can be edited or copied from the data line.
- **Free modes:** release one hard point (Solve / 2D Fix Option) and fit its position to the user lines.
- **Convert 2D to 3D:** fills a double wishbone or strut template from the 2D data.
- **View:** an SVG cross-car view with draggable points, construction lines and graphs with the targets overlaid.
**Phase 6, hard point utilities**
- **Import / Export:** hard points move in and out of Adams subsystem (`.sub`) files and a plain "User A" text
  format, matched by each template point's label strings (editable; formulas like `[(P1+P2)/2.0]` and `DERIVED`
  work). Shift, scale and axis switch are applied as SHARK does. Export rewrites only the matched numbers of an
  existing file. A preview shows every match before anything is applied.
- **Groups:** create, edit, delete and joggle point groups (stored in the `.dat` GROUPS section), plus saved point
  sets (Data / Coordinates) and Add End from File.

Next up:
- Modal, forced response and optimiser screens.
- Display units, AVI export and ride height utilities.

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
- A five-link rigid axle is over-constrained in roll. As in SHARK, it is split at a revolute on the centre
  line that turns about the axle tube, so the two halves can twist instead of binding. Compliance will hold
  that joint with a stiff bush.
- A rack housing is fixed to the body and a rack link moves with the rack. Their bushes only matter in
  compliance.
- An anti-roll bar is two halves turning in their mounts, joined by a revolute. Its bush is the bar's
  torsional rate, so in kinematics the halves turn freely.

The constraints are solved with a damped least-squares (Levenberg-Marquardt) method. Redundant joints,
such as revolutes modelled as two ball joints, are therefore not a problem.
