import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { boxPositions, limitOf, Corner, GenType, GROUND, findGen, mirrorY, solveAxle, type AxleState, type FreeBody, type ComplianceResult, type Vec3 } from '@claudus/core';
import { beginEdit, endEdit, useApp } from '../store';
import { useModes } from '../modes';
import { coincidentWith, movePoint, pickable, trackingAxes, useEdit } from '../editing';
import { VIEW_AXES, VIEW_DIR, cameraApi, cycleDyn, isOrtho, setCameraApi, useViewCtl, type StdView } from '../viewCtl';
import { pickPoint } from '../graphicsActions';
import { fmtUnit, useUnitSettings } from '../units';
import { registerCanvas } from '../video';
import { currentAxes, leaveStdView, spaceMouseStep, useSpaceMouse } from '../spacemouse';
import { GraphicElements } from './GraphicShapes';
import { BodyGraphics } from './BodyGraphics';
import { CogScene,ComplianceScene, FreeBodyForces } from './ComplianceScene';

const MM = 0.001; // scene units are metres
const DYN_BUTTON = { rotate: THREE.MOUSE.ROTATE, pan: THREE.MOUSE.PAN, zoom: THREE.MOUSE.DOLLY } as const;

/** Points that should all be in view after Autoscale, in scene units (metres, centred on the axle). */
function fitPoints(state: AxleState, origin: Vec3, radius: number, wheels: number[]): Vec3[] {
  const all = [...state.right.points, ...(state.leftMirror ? state.leftMirror.points.map(mirrorY) : [])];
  const out: Vec3[] = all.map((p) => [(p[0] - origin[0]) * MM, p[1] * MM, (p[2] - origin[2]) * MM]);
  // The tyres reach beyond the hard points.
  for (const w of wheels) {
    for (const pts of [state.right.points, ...(state.leftMirror ? [state.leftMirror.points.map(mirrorY)] : [])]) {
      const c = pts[w];
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        out.push([(c[0] + dx * radius - origin[0]) * MM, (c[1] + dy * 100) * MM, (c[2] + dz * radius - origin[2]) * MM]);
      }
    }
  }
  return out;
}

type OrbitLike = { target: THREE.Vector3; update: () => void };

/** The camera: standard views, Autoscale, zoom box, centre picking and the mouse mode. Registers its API for the menus. */
function CameraRig({ fitPoints: pts }: { fitPoints: Vec3[] }) {
  const { camera, gl, scene, controls } = useThree();
  const ptsRef = useRef(pts);
  ptsRef.current = pts;
  const first = useRef(true);

  useEffect(() => {
    const oc = () => controls as unknown as OrbitLike | null;
    const fit = (dir?: Vec3) => {
      const c = oc();
      if (!c || !ptsRef.current.length) return;
      const box = new THREE.Box3();
      ptsRef.current.forEach((p) => box.expandByPoint(new THREE.Vector3(...p)));
      const centre = box.getCenter(new THREE.Vector3());
      const r = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.05);
      const cam = camera as THREE.PerspectiveCamera;
      const vfov = THREE.MathUtils.degToRad(cam.fov);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
      const d = (r * 1.1) / Math.sin(Math.min(vfov, hfov) / 2);
      const offset = dir ? new THREE.Vector3(...dir).normalize() : camera.position.clone().sub(c.target).normalize();
      c.target.copy(centre);
      camera.position.copy(centre).addScaledVector(offset, d);
      c.update();
    };
    const planeHit = (ndc: THREE.Vector2) => {
      const c = oc()!;
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, camera);
      const n = camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, c.target);
      return { rc, hit: rc.ray.intersectPlane(plane, new THREE.Vector3()) };
    };
    const shift = (delta: THREE.Vector3) => {
      const c = oc()!;
      c.target.add(delta);
      camera.position.add(delta);
      c.update();
    };
    setCameraApi({
      stdView: (v) => { fit(VIEW_DIR[v]); useViewCtl.setState({ stdView: v }); },
      fit: () => fit(),
      zoomBox: (x0, y0, x1, y1) => {
        const c = oc();
        if (!c) return;
        const ndc = new THREE.Vector2(((x0 + x1) / 2) * 2 - 1, -(((y0 + y1) / 2) * 2 - 1));
        const { hit } = planeHit(ndc);
        if (hit) shift(hit.clone().sub(c.target));
        const f = Math.max(0.02, Math.min(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
        const offset = camera.position.clone().sub(c.target);
        camera.position.copy(c.target).addScaledVector(offset, f);
        c.update();
      },
      pickCentre: (x, y) => {
        const c = oc();
        if (!c) return;
        const ndc = new THREE.Vector2(x * 2 - 1, -(y * 2 - 1));
        const { rc, hit } = planeHit(ndc);
        const solid = (o: THREE.Object3D) => {
          const m = o as THREE.Mesh;
          return m.isMesh && m.visible && !Array.isArray(m.material) && (m.material as THREE.Material).opacity > 0.1;
        };
        const p = rc.intersectObjects(scene.children, true).find((h) => solid(h.object))?.point ?? hit;
        if (p) shift(p.clone().sub(c.target));
      },
      current: () => ({ position: camera.position.toArray() as Vec3, target: (oc()?.target.toArray() ?? [0, 0, 0]) as Vec3 }),
      apply: (position, target) => {
        const c = oc();
        if (!c) return;
        c.target.set(...target);
        camera.position.set(...position);
        c.update();
        useViewCtl.setState({ stdView: null });
      },
      basis: () => {
        const e = camera.matrixWorld.elements;
        return { right: [e[0], e[1], e[2]], up: [e[4], e[5], e[6]] };
      },
    });
    return () => setCameraApi(null);
  }, [camera, scene, controls]);

  // A view moved freely is no longer a standard one.
  useEffect(() => {
    const c = controls as unknown as THREE.EventDispatcher<{ start: object }> | null;
    if (!c) return;
    const moved = () => { if (useViewCtl.getState().stdView) useViewCtl.setState({ stdView: null }); };
    c.addEventListener('start', moved);
    return () => c.removeEventListener('start', moved);
  }, [controls]);

  // Right button: a click (not a drag) cycles rotate / pan / zoom.
  useEffect(() => {
    const el = gl.domElement;
    let down: [number, number] | null = null;
    const pd = (e: PointerEvent) => { if (e.button === 2) down = [e.clientX, e.clientY]; };
    const ctx = (e: MouseEvent) => {
      e.preventDefault();
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) cycleDyn();
      down = null;
    };
    el.addEventListener('pointerdown', pd);
    el.addEventListener('contextmenu', ctx);
    return () => { el.removeEventListener('pointerdown', pd); el.removeEventListener('contextmenu', ctx); };
  }, [gl]);

  // SpaceMouse: move the camera every frame while the cap is pushed.
  useFrame((_, dt) => {
    const c = controls as unknown as OrbitLike | null;
    const axes = c && currentAxes(useSpaceMouse.getState().settings);
    if (!c || !axes) return;
    const e = camera.matrixWorld.elements;
    const next = spaceMouseStep(axes, Math.min(dt, 0.1), camera.position.toArray() as Vec3, c.target.toArray() as Vec3,
      [e[0], e[1], e[2]], [e[4], e[5], e[6]], useSpaceMouse.getState().settings);
    c.target.set(...next.target);
    camera.position.set(...next.position);
    c.update();
    leaveStdView();
  });

  // Start with the whole suspension in view.
  useFrame(() => {
    if (first.current && controls && ptsRef.current.length) {
      first.current = false;
      cameraApi()?.fit();
    }
  });
  return null;
}

/** Wireframe and hidden-line drawing, by changing the materials of the scene's meshes. */
function FillStyleApplier() {
  const { scene } = useThree();
  const fill = useViewCtl((s) => s.fill);
  const bg = useViewCtl((s) => s.background);
  const key = `${fill}|${bg}`;
  useFrame(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material || Array.isArray(m.material) || o.userData.edgeOverlay) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.opacity === 0 && !o.userData.base) return; // invisible pick bars
      if (o.userData.fillKey === key) return;
      o.userData.fillKey = key;
      const base = (o.userData.base ??= { colour: mat.color.clone(), opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite });
      const overlay = o.children.find((c) => c.userData.edgeOverlay);
      if (overlay) { o.remove(overlay); (overlay as THREE.LineSegments).geometry.dispose(); }
      mat.wireframe = fill === 'wireframe';
      mat.color.copy(base.colour);
      mat.opacity = base.opacity;
      mat.transparent = base.transparent;
      mat.depthWrite = base.depthWrite;
      if (fill === 'hidden') {
        // Surfaces take the background colour and hide what is behind them; their edges are drawn on top.
        mat.color.set(bg);
        mat.opacity = 1;
        mat.transparent = false;
        mat.depthWrite = true;
        const edges = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), new THREE.LineBasicMaterial({ color: base.colour }));
        edges.userData.edgeOverlay = true;
        edges.raycast = () => {};
        o.add(edges);
      }
      mat.needsUpdate = true;
    });
  });
  return null;
}

/** The other end of the car, drawn at its static position when front and rear are shown together. */
function OtherEnd({ origin }: { origin: Vec3 }) {
  const end = useApp((s) => s.end);
  const other = end === 'front' ? 'rear' : 'front';
  const data = useApp((s) => s.model[other]);
  const templatesRev = useApp((s) => s.templatesRev);
  const solved = useMemo(() => {
    if (!data) return undefined;
    try {
      const c = new Corner(data, other);
      return { corner: c, state: solveAxle(c, { bump: 0, roll: 0, rack: 0 }) };
    } catch { return undefined; }
  }, [data, other, templatesRev]);
  if (!solved) return null;
  const { corner, state } = solved;
  return (
    <group>
      <Side corner={corner} points={state.right.points} mirrored origin={origin} />
      {state.leftMirror && <Side corner={corner} points={state.leftMirror.points.map(mirrorY)} mirrored origin={origin} />}
    </group>
  );
}

interface Props {
  corner: Corner;
  state: AxleState;
  /** Present in compliant mode: joint results for the right-hand corner. */
  detail?: ComplianceResult;
  /** Other solved steps drawn as a lighter overlay (articulation display, all steps). */
  ghosts?: AxleState[];
  /** Draw only this part, its points, elements and forces. */
  freeBody?: FreeBody;
}

export function Viewer3D({ corner, state, detail, ghosts, freeBody }: Props) {
  const view = useApp((s) => s.view);
  const compliant = useApp((s) => s.compliant);
  const wheelbase = useApp((s) => s.model.params.wheelbase);
  const vc = useViewCtl();
  const wc = corner.mech.staticPoints[corner.mech.wheelCentre];
  // Centre the scene on the axle so the camera orbits around the car's centreline at this end.
  const origin: Vec3 = [wc[0], 0, corner.z0];
  return (
    <Canvas
      gl={{ preserveDrawingBuffer: true }}
      camera={{ position: [-1.6, -1.4, 0.9], up: [0, 0, 1], fov: 40, near: 0.01, far: 100 }}
      onCreated={({ camera, gl }) => { camera.lookAt(0, 0, 0.25); registerCanvas(gl.domElement); }}
      onPointerMissed={() => { const s = useApp.getState(); s.select(null); if (!s.addMode) s.selectGraphic(null); }}
    >
      <color attach="background" args={[vc.background]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, -3, 4]} intensity={1.2} />
      <group position={[-origin[0] * MM, 0, -origin[2] * MM]} scale={MM}>
        {freeBody ? (
          <FreeBodyView corner={corner} points={state.right.points} fb={freeBody} />
        ) : (
          <>
        <Side corner={corner} points={state.right.points} mirrored={false} origin={origin} />
        {/* A corner model's left side is drawn as the mirror image; a full-axle template already has both. */}
        {detail && <ComplianceScene corner={corner} points={state.right.points} detail={detail} />}
        {compliant && <CogScene corner={corner} points={state.right.points} />}
        {state.leftMirror && view.bothSides && <Side corner={corner} points={state.leftMirror.points.map(mirrorY)} mirrored origin={origin} />}
        {vc.bothEnds && !freeBody && <OtherEnd origin={origin} />}
        {ghosts?.map((g, i) => (
          <group key={i}>
            <GraphicElements corner={corner} points={g.right.points} interactive={false} />
            {g.leftMirror && view.bothSides && <GraphicElements corner={corner} points={g.leftMirror.points.map(mirrorY)} interactive={false} />}
          </group>
        ))}
          </>
        )}
        <BodyGraphics frontX={corner.end === 'front' ? wc[0] : wc[0] - wheelbase} groundZ={state.right.groundZ} />
        <LimitBoxes />
        {vc.showGround && <Ground z={state.right.groundZ} x={wc[0]} />}
        {vc.showRollCentre && <RollCentre rc={state.rollCentre} />}
        {view.triad && <axesHelper args={[300]} />}
      </group>
      <OrbitControls makeDefault target={[0, 0, 0.25]} mouseButtons={{ LEFT: DYN_BUTTON[vc.dyn], MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />
      <CameraRig fitPoints={fitPoints(state, origin, corner.radius, corner.sides.map((w) => w.wc))} />
      <FillStyleApplier />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#e15759', '#59a14f', '#4e79a7']} labelColor="#fff" />
      </GizmoHelper>
    </Canvas>
  );
}

/** Free body diagram: just one part with its points, graphic elements, wheel (if it carries one) and forces. */
function FreeBodyView({ corner, points, fb }: { corner: Corner; points: Vec3[]; fb: FreeBody }) {
  const t = corner.template;
  const tyreWidths = useApp((s) => s.model.tyreWidths);
  const on = new Set(fb.points.map((i) => t.points[i].no));
  const showNos = useApp((s) => s.view.pointNos);
  return (
    <group>
      <GraphicElements corner={corner} points={points} interactive={false} only={(g) => g.points.length > 0 && g.points.every((no) => on.has(no))} />
      {corner.sides.map((w, k) => t.points[w.wc].part1 === fb.part && (
        <Wheel key={k} wc={points[w.wc]} stub={points[w.stub]} radius={corner.radius} width={tyreWidths[(corner.end === 'front' ? 0 : 2) + (k === 1 ? 0 : 1)] || 150} />
      ))}
      {fb.points.map((i) => (
        <mesh key={i} position={points[i]}>
          <sphereGeometry args={[8, 16, 12]} />
          <meshStandardMaterial color="#dfe6ee" />
          <Html center={false} zIndexRange={[5, 0]} style={{ pointerEvents: 'none', transform: 'translate(8px, -14px)' }}>
            <div className="plabel"><b>{t.points[i].no}</b>{showNos ? '' : ` ${t.points[i].label}`}</div>
          </Html>
        </mesh>
      ))}
      <FreeBodyForces fb={fb} />
    </group>
  );
}

function Side({ corner, points, mirrored, origin }: { corner: Corner; points: Vec3[]; mirrored: boolean; origin: Vec3 }) {
  useUnitSettings();
  const t = corner.template;
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  const tyreWidths = useApp((s) => s.model.tyreWidths);
  const idx = (no: number) => corner.mech.index.get(no)!;
  const view = useApp((s) => s.view);
  const addMode = useApp((s) => s.addMode);
  const vc = useViewCtl();
  const edit = useEdit();
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const p = (no: number) => points[idx(no)];

  const pairs = (a: GenType, b: GenType) => [findGen(t, a), findGen(t, b)];
  const springs = [pairs(GenType.Spring1ToSuspension, GenType.Spring1ToBody), pairs(GenType.Spring2ToSuspension, GenType.Spring2ToBody)];
  const dampers = [pairs(GenType.Damper1ToSuspension, GenType.Damper1ToBody), pairs(GenType.Damper2ToSuspension, GenType.Damper2ToBody)];
  // Tyre widths are stored left then right for each end; wheel 0 is the right-hand one.
  const width = (wheel: number) => tyreWidths[(corner.end === 'front' ? 0 : 2) + (mirrored || wheel === 1 ? 0 : 1)] || 150;

  /** Drag the point along the tracking axes; the model and graphs update as it moves, and the drag is one undo step. */
  const startDrag = (i: number, e: ThreeEvent<PointerEvent>) => {
    if (mirrored || edit.mode !== 'drag' || useApp.getState().addMode || useEdit.getState().tempPicking || !pickable(i)) return;
    const stdView = useViewCtl.getState().stdView;
    const axes = trackingAxes(useEdit.getState().tracking, stdView);
    const p0 = new THREE.Vector3(...points[i]);
    const ray = (cx: number, cy: number) => {
      const r = gl.domElement.getBoundingClientRect();
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
      const o = rc.ray.origin;
      return { o: new THREE.Vector3(o.x / MM + origin[0], o.y / MM + origin[1], o.z / MM + origin[2]), d: rc.ray.direction.clone() };
    };
    /** Where the pointer's ray meets the line or plane the point is constrained to (mm). */
    const hit = (cx: number, cy: number): THREE.Vector3 | null => {
      const { o, d } = ray(cx, cy);
      if (axes.length === 1) {
        const a = new THREE.Vector3().setComponent(axes[0], 1);
        const w = p0.clone().sub(o);
        const b = a.dot(d);
        const den = 1 - b * b;
        if (den < 1e-6) return null;
        return p0.clone().addScaledVector(a, (b * d.dot(w) - a.dot(w)) / den);
      }
      const n = isOrtho(stdView) ? new THREE.Vector3().setComponent([0, 1, 2].find((k) => !axes.includes(k))!, 1) : camera.getWorldDirection(new THREE.Vector3());
      const den = n.dot(d);
      if (Math.abs(den) < 1e-6) return null;
      return o.clone().addScaledVector(d, n.dot(p0.clone().sub(o)) / den);
    };
    let prev = hit(e.nativeEvent.clientX, e.nativeEvent.clientY);
    if (!prev) return;
    const sx = e.nativeEvent.clientX;
    const sy = e.nativeEvent.clientY;
    let active = false;
    if (controls) controls.enabled = false;
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        active = true;
        beginEdit();
        select(i);
      }
      const cur = hit(ev.clientX, ev.clientY);
      if (!cur || !prev) return;
      const d = cur.clone().sub(prev);
      prev = cur;
      movePoint(i, [d.x, d.y, d.z]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (active) endEdit();
      if (controls) controls.enabled = true;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const clicked = (i: number, no: number) => {
    const s = useApp.getState();
    const ed = useEdit.getState();
    if (s.addMode) { pickPoint(no); return; }
    if (ed.tempPicking) {
      ed.setTempGroup(ed.tempGroup.includes(i) ? ed.tempGroup.filter((x) => x !== i) : [...ed.tempGroup, i]);
      return;
    }
    if (!pickable(i)) return;
    select(i);
    if (ed.coincidence) {
      const c = coincidentWith(i);
      ed.setCoincident(c.length > 1 ? c : null);
    }
  };

  const size = vc.pointSize;
  const trackAxes = !mirrored && selected !== null && edit.mode !== 'edit' && edit.trackVisible && points[selected] ? trackingAxes(edit.tracking, vc.stdView) : [];
  const partMembers = (k: number) => t.points.map((tp, i) => (!tp.dummy && (tp.part1 === k || tp.part2 === k) ? i : -1)).filter((i) => i >= 0);

  return (
    <group>
      <GraphicElements corner={corner} points={points} interactive={!mirrored} />
      {vc.showDampers && dampers.map(([a, b], k) => a && b && <Line key={`d${k}`} points={[p(a.no), p(b.no)]} color={vc.damperColour} lineWidth={7 * vc.lineSize} />)}
      {vc.showSprings && springs.map(([a, b], k) => a && b && <Line key={`s${k}`} points={[p(a.no), p(b.no)]} color={vc.springColour} lineWidth={2 * vc.lineSize} dashed dashSize={12} gapSize={6} />)}
      {vc.showWheels && corner.sides.map((w, k) => (
        <Wheel key={k} wc={points[w.wc]} stub={points[w.stub]} radius={corner.radius} width={width(k)} colour={vc.wheelColour} />
      ))}
      {t.points.map((tp, i) => {
        if (tp.dummy) return null;
        const isGround = tp.part1 === GROUND || tp.part2 === GROUND;
        if (isGround && !vc.showBody) return null;
        const sel = !mirrored && selected === i;
        const picking = !mirrored && addMode?.picked.includes(tp.no);
        const inTemp = !mirrored && edit.tempGroup.includes(i);
        return (
          <mesh
            key={tp.no}
            position={points[i]}
            onClick={mirrored ? undefined : (e) => { e.stopPropagation(); clicked(i, tp.no); }}
            onPointerDown={mirrored ? undefined : (e) => { e.stopPropagation(); startDrag(i, e); }}
          >
            {isGround ? <boxGeometry args={[14 * size, 14 * size, 14 * size]} /> : <sphereGeometry args={[(sel ? 11 : 7) * size, 16, 12]} />}
            <meshStandardMaterial color={sel ? '#ffe066' : picking ? '#ff8a3d' : inTemp ? '#6ee7ff' : isGround ? vc.bodyColour : vc.pointColour} />
            {!mirrored && (view.pointNos || view.pointValues || vc.pointNames) && (
              <Html center={false} zIndexRange={[5, 0]} style={{ pointerEvents: 'none', transform: 'translate(8px, -14px)' }}>
                <div className="plabel">
                  {view.pointNos && <b>{tp.no}</b>}
                  {vc.pointNames && <span> {tp.label}</span>}
                  {view.pointValues && <span> {points[i].map((v) => fmtUnit('mm', v, 1)).join(', ')}</span>}
                </div>
              </Html>
            )}
          </mesh>
        );
      })}
      {!mirrored && vc.partLabels && t.parts.map((name, k) => {
        const m = partMembers(k + 1);
        if (!m.length) return null;
        const c = [0, 1, 2].map((a) => m.reduce((sum, i) => sum + points[i][a], 0) / m.length) as Vec3;
        return (
          <Html key={`part${k}`} position={c} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
            <div className="plabel part">{name}</div>
          </Html>
        );
      })}
      {trackAxes.map((a) => {
        const c = points[selected!];
        const h = edit.trackLength / 2;
        const lo = [...c] as Vec3;
        const hi = [...c] as Vec3;
        lo[a] -= h;
        hi[a] += h;
        return <Line key={`tr${a}`} points={[lo, hi]} color={['#e15759', '#59a14f', '#4e79a7'][a]} lineWidth={1} dashed dashSize={8} gapSize={5} />;
      })}
    </group>
  );
}

function Wheel({ wc, stub, radius, width, colour = "#2b2f36" }: { wc: Vec3; stub: Vec3; radius: number; width: number; colour?: string }) {
  const { quaternion } = useMemo(() => {
    const axis = new THREE.Vector3(wc[0] - stub[0], wc[1] - stub[1], wc[2] - stub[2]).normalize();
    return { quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis) };
  }, [wc, stub]);
  return (
    <group position={wc} quaternion={quaternion}>
      <mesh>
        <cylinderGeometry args={[radius, radius, width, 48, 1, true]} />
        <meshStandardMaterial color={colour} side={THREE.DoubleSide} transparent opacity={0.55} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[radius * 0.62, radius * 0.62, width * 0.9, 32]} />
        <meshStandardMaterial color="#5b6573" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function Ground({ z, x }: { z: number; x: number }) {
  return (
    <group position={[x, 0, z]}>
      <gridHelper args={[3000, 30, '#3a4250', '#262c35']} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

function RollCentre({ rc }: { rc: Vec3 }) {
  if (!rc.every(Number.isFinite) || Math.abs(rc[1]) > 5000 || Math.abs(rc[2]) > 5000) return null;
  return (
    <mesh position={rc}>
      <sphereGeometry args={[12, 16, 12]} />
      <meshStandardMaterial color="#e15759" emissive="#7a1f20" />
    </mesh>
  );
}

/** Point limit boxes of the end being shown (Graphics / Point Limits), and the tolerance analysis positions. */
function LimitBoxes() {
  const model = useApp((s) => s.model);
  const end = useApp((s) => s.end);
  const visible = useModes((s) => s.limitsVisible);
  const use = useModes((s) => s.limitsUse);
  const tolOn = useModes((s) => s.tolOn);
  const tol = useModes((s) => s.tolPoint);
  const data = model[end];
  const geometry = useMemo(() => {
    if (!visible || !data) return null;
    const v: number[] = [];
    data.points.forEach((_, i) => {
      const { min, max } = limitOf(model, end, i);
      const c = (x: number, y: number, z: number) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
      // 12 edges: along each axis from each of the four corners of the other two.
      for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        v.push(...(c(0, a, b)), ...(c(1, a, b)), ...(c(a, 0, b)), ...(c(a, 1, b)), ...(c(a, b, 0)), ...(c(a, b, 1)));
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return g;
  }, [visible, model, end, data]);
  const dots = useMemo(() => {
    if (!tolOn || !tol || tol.end !== end || !data?.points[tol.index]) return [];
    return boxPositions(limitOf(model, end, tol.index), data.points[tol.index]);
  }, [tolOn, tol, model, end, data]);
  return (
    <>
      {geometry && (
        <lineSegments geometry={geometry}>
          <lineBasicMaterial color={use ? '#ff9d4d' : '#6b7686'} />
        </lineSegments>
      )}
      {dots.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[3, 8, 6]} />
          <meshBasicMaterial color="#ff9d4d" />
        </mesh>
      ))}
    </>
  );
}
