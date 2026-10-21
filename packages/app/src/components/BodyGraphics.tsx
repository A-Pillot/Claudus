import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { bodyLines, BODY_USER, type Vec3 } from '@claudus/core';
import { useApp } from '../store';
import { useSettings } from '../settings';

/**
 * The body graphics of Data / Body Type, drawn in the 3D view. Body lines are in car axes: x back from the front
 * axle, y across, z up from the ground. `frontX` is the front axle's x and `groundZ` the ground height.
 */
export function BodyGraphics({ frontX, groundZ }: { frontX: number; groundZ: number }) {
  const body = useApp((s) => s.model.body);
  const show = useSettings((s) => s.settings.showBody);
  const lines = useMemo(() => bodyLines(body), [body]);
  const tris = useMemo(() => {
    if (body?.type !== BODY_USER || !body.facets.length) return null;
    const pos: number[] = [];
    for (const f of body.facets) {
      const tri = (a: Vec3, b: Vec3, c: Vec3) => pos.push(...a, ...b, ...c);
      tri(f[0], f[1], f[2]);
      if (f.length > 3) tri(f[0], f[2], f[3]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [body]);
  if (!show || !body || body.type === 0) return null;
  return (
    <group position={[frontX, 0, groundZ]} name="body-graphics">
      {lines.map((l, i) => <Line key={i} points={l} color="#6c7a8c" lineWidth={1} transparent opacity={0.8} />)}
      {tris && (
        <mesh geometry={tris}>
          <meshStandardMaterial color="#6c7a8c" transparent opacity={0.25} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
