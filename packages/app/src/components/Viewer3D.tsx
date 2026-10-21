import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, Line, OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { GenType, GROUND, findGen, mirrorY, type AxleState, type FreeBody, type ComplianceResult, type Corner, type Vec3 } from '@claudus/core';
import { useApp } from '../store';
import { pickPoint } from '../graphicsActions';
import { fmtUnit, useUnitSettings } from '../units';
import { registerCanvas } from '../video';
import { GraphicElements } from './GraphicShapes';
import { CogScene, ComplianceScene, FreeBodyForces } from './ComplianceScene';

const MM = 0.001; // scene units are metres

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
      <color attach="background" args={['#14171c']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, -3, 4]} intensity={1.2} />
      <group position={[-origin[0] * MM, 0, -origin[2] * MM]} scale={MM}>
        {freeBody ? (
          <FreeBodyView corner={corner} points={state.right.points} fb={freeBody} />
        ) : (
          <>
        <Side corner={corner} points={state.right.points} mirrored={false} />
        {/* A corner model's left side is drawn as the mirror image; a full-axle template already has both. */}
        {detail && <ComplianceScene corner={corner} points={state.right.points} detail={detail} />}
        {compliant && <CogScene corner={corner} points={state.right.points} />}
        {state.leftMirror && view.bothSides && <Side corner={corner} points={state.leftMirror.points.map(mirrorY)} mirrored />}
        {ghosts?.map((g, i) => (
          <group key={i}>
            <GraphicElements corner={corner} points={g.right.points} interactive={false} />
            {g.leftMirror && view.bothSides && <GraphicElements corner={corner} points={g.leftMirror.points.map(mirrorY)} interactive={false} />}
          </group>
        ))}
          </>
        )}
        <Ground z={state.right.groundZ} x={wc[0]} />
        <RollCentre rc={state.rollCentre} />
        {view.triad && <axesHelper args={[300]} />}
      </group>
      <OrbitControls makeDefault target={[0, 0, 0.25]} />
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

function Side({ corner, points, mirrored }: { corner: Corner; points: Vec3[]; mirrored: boolean }) {
  useUnitSettings();
  const t = corner.template;
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  const tyreWidths = useApp((s) => s.model.tyreWidths);
  const idx = (no: number) => corner.mech.index.get(no)!;
  const view = useApp((s) => s.view);
  const addMode = useApp((s) => s.addMode);
  const p = (no: number) => points[idx(no)];

  const pairs = (a: GenType, b: GenType) => [findGen(t, a), findGen(t, b)];
  const springs = [pairs(GenType.Spring1ToSuspension, GenType.Spring1ToBody), pairs(GenType.Spring2ToSuspension, GenType.Spring2ToBody)];
  const dampers = [pairs(GenType.Damper1ToSuspension, GenType.Damper1ToBody), pairs(GenType.Damper2ToSuspension, GenType.Damper2ToBody)];
  // Tyre widths are stored left then right for each end; wheel 0 is the right-hand one.
  const width = (wheel: number) => tyreWidths[(corner.end === 'front' ? 0 : 2) + (mirrored || wheel === 1 ? 0 : 1)] || 150;

  return (
    <group>
      <GraphicElements corner={corner} points={points} interactive={!mirrored} />
      {dampers.map(([a, b], k) => a && b && <Line key={`d${k}`} points={[p(a.no), p(b.no)]} color="#ff9d4d" lineWidth={7} />)}
      {springs.map(([a, b], k) => a && b && <Line key={`s${k}`} points={[p(a.no), p(b.no)]} color="#a5e887" lineWidth={2} dashed dashSize={12} gapSize={6} />)}
      {corner.sides.map((w, k) => (
        <Wheel key={k} wc={points[w.wc]} stub={points[w.stub]} radius={corner.radius} width={width(k)} />
      ))}
      {t.points.map((tp, i) => {
        if (tp.dummy) return null;
        const isGround = tp.part1 === GROUND || tp.part2 === GROUND;
        const sel = !mirrored && selected === i;
        const picking = !mirrored && addMode?.picked.includes(tp.no);
        return (
          <mesh
            key={tp.no}
            position={points[i]}
            onClick={mirrored ? undefined : (e) => { e.stopPropagation(); if (useApp.getState().addMode) pickPoint(tp.no); else select(i); }}
          >
            {isGround ? <boxGeometry args={[14, 14, 14]} /> : <sphereGeometry args={[sel ? 11 : 7, 16, 12]} />}
            <meshStandardMaterial color={sel ? '#ffe066' : picking ? '#ff8a3d' : isGround ? '#9aa4b2' : '#dfe6ee'} />
            {!mirrored && (view.pointNos || view.pointValues) && (
              <Html center={false} zIndexRange={[5, 0]} style={{ pointerEvents: 'none', transform: 'translate(8px, -14px)' }}>
                <div className="plabel">
                  {view.pointNos && <b>{tp.no}</b>}
                  {view.pointValues && <span> {points[i].map((v) => fmtUnit('mm', v, 1)).join(', ')}</span>}
                </div>
              </Html>
            )}
          </mesh>
        );
      })}
    </group>
  );
}

function Wheel({ wc, stub, radius, width }: { wc: Vec3; stub: Vec3; radius: number; width: number }) {
  const { quaternion } = useMemo(() => {
    const axis = new THREE.Vector3(wc[0] - stub[0], wc[1] - stub[1], wc[2] - stub[2]).normalize();
    return { quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis) };
  }, [wc, stub]);
  return (
    <group position={wc} quaternion={quaternion}>
      <mesh>
        <cylinderGeometry args={[radius, radius, width, 48, 1, true]} />
        <meshStandardMaterial color="#2b2f36" side={THREE.DoubleSide} transparent opacity={0.55} />
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
