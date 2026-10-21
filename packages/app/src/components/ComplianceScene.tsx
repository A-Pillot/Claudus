import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { add, bushAxes, type FreeBody, endCompliance, forcesFor, partMasses, resolveAxisRef, type ComplianceResult, type Corner, type CornerState, type Vec3 } from '@claudus/core';
import { useApp } from '../store';
import { useEffectiveCompliance } from '../derived';

const AXIS_LEN = 45; // mm
const FORCE_LEN = 160; // mm, fixed length of an external force arrow
const JOINT_FORCE_MAX = 140; // mm, length of the largest calculated joint force arrow

/** A line with a cone head at `to`. Scene units are millimetres here (the parent group scales). */
function Arrow({ from, to, color, head = 14 }: { from: Vec3; to: Vec3; color: string; head?: number }) {
  const quaternion = useMemo(() => {
    const d = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    if (d.lengthSq() < 1e-12) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }, [from, to]);
  return (
    <group>
      <Line points={[from, to]} color={color} lineWidth={3} />
      <mesh position={to} quaternion={quaternion}>
        <coneGeometry args={[head * 0.45, head, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

/**
 * What the compliant solver adds to the 3D view of the right-hand corner: rigid joints versus bushes, bush local
 * axes, the active force set's external forces and the calculated joint forces.
 */
export function ComplianceScene({ corner, points, detail }: { corner: Corner; points: Vec3[]; detail?: ComplianceResult }) {
  const view = useApp((s) => s.view);
  const comp = useEffectiveCompliance();
  const end = corner.end;
  const idx = (no: number) => corner.mech.index.get(no);
  const at = (no: number) => { const i = idx(no); return i === undefined ? undefined : points[i]; };
  const bushes = comp[end]?.bushes ?? [];
  const bushed = new Set(bushes.map((b) => b.point));

  const axes = useMemo(() => bushes.map((b) => {
    const o = at(b.point);
    if (!o) return undefined;
    const R = bushAxes(o, resolveAxisRef(b.zAxis, o, at), resolveAxisRef(b.xzPlane, o, at));
    return { o, R, no: b.point };
  }), [bushes, points]); // eslint-disable-line react-hooks/exhaustive-deps

  const forces = forcesFor(comp, end).map((f) => {
    const origin = f.at === 0 ? corner.tcp(points, 0) : at(f.at);
    if (!origin) return undefined;
    const head = add(origin, f.head);
    const tail = add(origin, f.tail);
    const d: Vec3 = [head[0] - tail[0], head[1] - tail[1], head[2] - tail[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-9) return undefined;
    // The arrow ends at the head, a fixed length back along the force.
    const from: Vec3 = [head[0] - (d[0] / len) * FORCE_LEN, head[1] - (d[1] / len) * FORCE_LEN, head[2] - (d[2] / len) * FORCE_LEN];
    return { f, head, tail, from };
  });

  const maxForce = Math.max(1e-9, ...(detail?.joints.map((j) => Math.hypot(...j.force)) ?? [0]));

  return (
    <group>
      {view.showBushes && corner.template.points.map((tp, i) => {
        if (tp.dummy || !detail?.joints.some((j) => j.point === tp.no)) return null;
        return bushed.has(tp.no) ? (
          <mesh key={tp.no} position={points[i]} name={`bush-${tp.no}`}>
            <sphereGeometry args={[13, 16, 12]} />
            <meshStandardMaterial color="#f28e2b" transparent opacity={0.65} />
          </mesh>
        ) : (
          <mesh key={tp.no} position={points[i]} name={`rigid-${tp.no}`}>
            <octahedronGeometry args={[6]} />
            <meshStandardMaterial color="#4fb3a5" />
          </mesh>
        );
      })}
      {view.showBushAxes && axes.map((a) => a && (
        <group key={a.no}>
          {(['#e15759', '#59a14f', '#4e79a7'] as const).map((c, k) => (
            <Line key={k} points={[a.o, add(a.o, a.R[k].map((v) => v * AXIS_LEN) as Vec3)]} color={c} lineWidth={2} />
          ))}
        </group>
      ))}
      {view.showForces && forces.map((x, i) => x && (
        <group key={i}>
          <Arrow from={x.from} to={x.head} color="#ffd54a" />
          <mesh position={x.head}><sphereGeometry args={[5, 8, 8]} /><meshBasicMaterial color="#ffd54a" /></mesh>
          <mesh position={x.tail}><sphereGeometry args={[4, 8, 8]} /><meshBasicMaterial color="#c9a227" /></mesh>
        </group>
      ))}
      {view.showJointForces && detail?.joints.map((j, i) => {
        const o = at(j.point);
        const m = Math.hypot(...j.force);
        if (!o || m < 1e-6) return null;
        const k = JOINT_FORCE_MAX / maxForce;
        return <Arrow key={i} from={o} to={add(o, j.force.map((v) => v * k) as Vec3)} color="#c678dd" head={10} />;
      })}
    </group>
  );
}

const FB_COLOURS = { joint: '#c678dd', spring: '#a5e887', tyre: '#4dd0e1', external: '#ffd54a' } as const;

/** Forces on one part (free body diagram): arrows at their points, the longest a fixed length. */
export function FreeBodyForces({ fb }: { fb: FreeBody }) {
  const max = Math.max(1e-9, ...fb.forces.map((f) => Math.hypot(...f.force)));
  return (
    <group>
      {fb.forces.map((f, i) => {
        const m = Math.hypot(...f.force);
        if (m < 1e-6) return null;
        const k = (JOINT_FORCE_MAX * 1.4) / max;
        const tip = add(f.at, f.force.map((v) => v * k) as Vec3);
        return <Arrow key={i} from={f.at} to={tip} color={FB_COLOURS[f.kind]} head={12} />;
      })}
    </group>
  );
}

export const freeBodyColour = (kind: keyof typeof FB_COLOURS) => FB_COLOURS[kind];

const COG_RADIUS = 14; // mm
const COG_AXIS_LEN = 90; // mm

/** A two-colour sphere in alternating quadrants, the usual centre-of-gravity symbol. */
function CogMarker({ at, part }: { at: Vec3; part: number }) {
  return (
    <group position={at} rotation={[Math.PI / 2, 0, 0]} name={`cog-${part}`}>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k}>
          <sphereGeometry args={[COG_RADIUS, 14, 10, (k * Math.PI) / 2, Math.PI / 2]} />
          <meshStandardMaterial color={k % 2 ? '#15181d' : '#3fbf5f'} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** Each part's C of G marker and local axes (compliant mode only; toggled under Graphics). */
export function CogScene({ corner, points }: { corner: Corner; points: Vec3[] }) {
  const view = useApp((s) => s.view);
  const comp = useEffectiveCompliance();
  const end = corner.end;
  const cogs = useMemo(() => {
    if (!view.showCog && !view.showCogAxes) return [];
    const data = endCompliance(comp, end);
    const at = (no: number) => { const i = corner.mech.index.get(no); return i === undefined ? undefined : points[i]; };
    return partMasses(corner, { points } as unknown as CornerState, data).map((m) => {
      const given = data.masses?.find((x) => x.part === m.part);
      const R = bushAxes(m.cog, given && resolveAxisRef(given.zAxis, m.cog, at), given && resolveAxisRef(given.xzPlane, m.cog, at));
      return { part: m.part, cog: m.cog, R };
    });
  }, [view.showCog, view.showCogAxes, comp, end, corner, points]);
  return (
    <group>
      {cogs.map((c) => (
        <group key={c.part}>
          {view.showCog && <CogMarker at={c.cog} part={c.part} />}
          {view.showCogAxes && (['#e15759', '#59a14f', '#4e79a7'] as const).map((col, k) => (
            <Line key={k} points={[c.cog, add(c.cog, c.R[k].map((v) => v * COG_AXIS_LEN) as Vec3)]} color={col} lineWidth={2} />
          ))}
        </group>
      ))}
    </group>
  );
}
