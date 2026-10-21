import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { elementShape, optionOf, type Corner, type GraphicElement, type Shape, type Vec3 } from '@claudus/core';
import { useApp } from '../store';
import { useViewCtl } from '../viewCtl';

const PART_COLOURS = ['#4e79a7', '#f28e2b', '#59a14f', '#b07aa1', '#76b7b2', '#edc948', '#9c755f', '#e15759'];
const PICKED = '#ffe066';
const MEASURE = '#4dd0e1';
const MISC = '#c8d1dc';

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
/** Rotation taking the +Y axis (the way three.js cylinders point) onto a direction. */
const alongY = (dir: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
const alongZ = (dir: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());

/** The label that goes with an element's shape in the 3D view, if it has one. */
export function shapeLabel(g: GraphicElement, s: Shape): string | undefined {
  const variant = g.props?.[0] ?? 0;
  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
  if (s.type === 'measure') {
    if (s.kind === 'angle') return `${s.value.toFixed(2)}°`;
    if (s.kind === 'components' && s.comps) return `dx ${f(s.comps[0])}  dy ${f(s.comps[1])}  dz ${f(s.comps[2])}  (${f(s.value)}) mm`;
    return `${f(s.value)} mm`;
  }
  // Circles and spheres worked out from other points show what was worked out.
  if (s.type === 'circle' && (variant === 0 || variant === 3)) return `R ${f(s.radius)}`;
  if (s.type === 'sphere' && variant === 3) return `R ${f(s.radius)}`;
  return undefined;
}

interface Props {
  corner: Corner;
  points: Vec3[];
  /** Left-side mirror images are not clickable or labelled. */
  interactive: boolean;
  /** Draw only the elements this accepts (the free body diagram's part). */
  only?: (g: GraphicElement) => boolean;
}

/** Every graphic element of the template, at the current point positions. */
export function GraphicElements({ corner, points, interactive, only }: Props) {
  const t = corner.template;
  const selectedGraphic = useApp((s) => s.selectedGraphic);
  const addMode = useApp((s) => s.addMode);
  const showPivots = useViewCtl((s) => s.showPivots);
  const lineSize = useViewCtl((s) => s.lineSize);
  const at = (no: number) => {
    const i = corner.mech.index.get(no);
    return i === undefined ? undefined : points[i];
  };
  const partOf = (nos: number[]) => {
    for (let k = 1; k <= t.parts.length; k++) {
      if (nos.every((no) => { const tp = t.points[corner.mech.index.get(no) ?? -1]; return tp && (tp.part1 === k || tp.part2 === k); })) return k;
    }
    return 0;
  };
  return (
    <group>
      {t.graphics.map((g, i) => {
        if (only && !only(g)) return null;
        const shape = elementShape(g, at);
        if (!shape) return null;
        if (shape.type === 'pivot' && !showPivots) return null;
        const picked = interactive && selectedGraphic === i;
        const colour = picked ? PICKED : shape.type === 'segments' ? PART_COLOURS[(partOf(g.points) - 1 + PART_COLOURS.length) % PART_COLOURS.length] : shape.type === 'measure' ? MEASURE : MISC;
        const click = interactive
          ? (e: { stopPropagation: () => void }) => {
              e.stopPropagation();
              if (!addMode) useApp.getState().selectGraphic(picked ? null : i);
            }
          : undefined;
        return (
          <group key={i}>
            <ShapeMesh shape={shape} colour={colour} onClick={click} lineSize={lineSize} />
            {interactive && <ShapeLabel g={g} shape={shape} colour={colour} />}
          </group>
        );
      })}
    </group>
  );
}

type Click = ((e: { stopPropagation: () => void }) => void) | undefined;

/** A thick invisible bar along a segment so thin lines are easy to click. */
function Bar({ a, b, radius, colour, opacity = 0, onClick }: { a: Vec3; b: Vec3; radius: number; colour: string; opacity?: number; onClick: Click }) {
  const { pos, q, len } = useMemo(() => {
    const d = v3(b).sub(v3(a));
    return { pos: v3(a).add(v3(b)).multiplyScalar(0.5), q: d.length() > 1e-9 ? alongY(d) : new THREE.Quaternion(), len: d.length() };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={q} onClick={onClick}>
      <cylinderGeometry args={[radius, radius, len, 8, 1]} />
      <meshStandardMaterial color={colour} transparent opacity={opacity} depthWrite={opacity > 0.5} />
    </mesh>
  );
}

function ShapeMesh({ shape, colour, onClick, lineSize }: { shape: Shape; colour: string; onClick: Click; lineSize: number }) {
  switch (shape.type) {
    case 'segments':
      return (
        <>
          {shape.segments.map(([a, b], k) => (
            <group key={k}>
              <Line points={[a, b]} color={colour} lineWidth={(shape.style === 'tube' ? 4 : 2.5) * lineSize} />
              <Bar a={a} b={b} radius={9} colour={colour} onClick={onClick} />
            </group>
          ))}
        </>
      );
    case 'pivot':
      return <Bar a={shape.a} b={shape.b} radius={9} colour={colour === MISC ? '#9aa4b2' : colour} opacity={1} onClick={onClick} />;
    case 'cylinder':
      return <Bar a={shape.a} b={shape.b} radius={shape.radius} colour={colour} opacity={0.55} onClick={onClick} />;
    case 'circle':
      return <CircleMesh shape={shape} colour={colour} onClick={onClick} />;
    case 'sphere':
      return (
        <mesh position={shape.centre} onClick={onClick}>
          <sphereGeometry args={[Math.max(shape.radius, 0.1), 32, 20]} />
          <meshStandardMaterial color={colour} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      );
    case 'facet':
      return <Facet vertices={shape.vertices} colour={colour} onClick={onClick} />;
    case 'plane': {
      const { centre, u, v, half } = shape;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [centre[0] + (a * u[0] + b * v[0]) * half, centre[1] + (a * u[1] + b * v[1]) * half, centre[2] + (a * u[2] + b * v[2]) * half] as Vec3);
      return <Facet vertices={corners} colour={colour} onClick={onClick} opacity={0.18} outline />;
    }
    case 'measure': {
      const arms: [Vec3, Vec3][] = shape.apex ? [[shape.apex, shape.from], [shape.apex, shape.to]] : [[shape.from, shape.to]];
      return (
        <>
          {arms.map(([a, b], k) => (
            <group key={k}>
              <Line points={[a, b]} color={colour} lineWidth={2} dashed dashSize={10} gapSize={6} />
              <Bar a={a} b={b} radius={9} colour={colour} onClick={onClick} />
            </group>
          ))}
          {[shape.from, shape.to].map((p, k) => (
            <mesh key={k} position={p}>
              <sphereGeometry args={[5, 12, 8]} />
              <meshStandardMaterial color={colour} />
            </mesh>
          ))}
        </>
      );
    }
  }
}

function CircleMesh({ shape, colour, onClick }: { shape: Extract<Shape, { type: 'circle' }>; colour: string; onClick: Click }) {
  const q = useMemo(() => alongZ(v3(shape.normal)), [shape.normal]);
  return (
    <group position={shape.centre} quaternion={q}>
      <mesh onClick={onClick}>
        <torusGeometry args={[Math.max(shape.radius, 0.1), 2.5, 8, 96]} />
        <meshStandardMaterial color={colour} />
      </mesh>
      <mesh>
        <sphereGeometry args={[4, 10, 8]} />
        <meshStandardMaterial color={colour} />
      </mesh>
    </group>
  );
}

function Facet({ vertices, colour, onClick, opacity = 0.45, outline = false }: { vertices: Vec3[]; colour: string; onClick: Click; opacity?: number; outline?: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const flat = vertices.flat();
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    g.setIndex(vertices.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]);
    g.computeVertexNormals();
    return g;
  }, [vertices]);
  return (
    <>
      <mesh geometry={geometry} onClick={onClick}>
        <meshStandardMaterial color={colour} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {outline && <Line points={[...vertices, vertices[0]]} color={colour} lineWidth={1} />}
    </>
  );
}

/** Where a label sits: the middle of a measurement, the centre of a derived circle or sphere. */
function labelPosition(s: Shape): Vec3 | undefined {
  if (s.type === 'measure') {
    if (s.apex) return s.apex;
    return [(s.from[0] + s.to[0]) / 2, (s.from[1] + s.to[1]) / 2, (s.from[2] + s.to[2]) / 2];
  }
  if (s.type === 'circle' || s.type === 'sphere') return s.centre;
  return undefined;
}

function ShapeLabel({ g, shape, colour }: { g: GraphicElement; shape: Shape; colour: string }) {
  const text = shapeLabel(g, shape);
  const pos = labelPosition(shape);
  if (!text || !pos) return null;
  return (
    <Html position={pos} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="glabel" style={{ color: colour }} title={optionOf(g)?.name}>{text}</div>
    </Html>
  );
}
