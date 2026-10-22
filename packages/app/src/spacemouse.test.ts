import { describe, expect, it } from 'vitest';
import { currentAxes, defaultSpaceMouseSettings, feedReport, parseReport, resetInput, spaceMouseStep, type Axes } from './spacemouse';
import { openFilters } from './desktop';
import { modelFilters } from './files';
import type { Vec3 } from '@claudus/core';

const le = (...v: number[]) => {
  const b = new Uint8Array(v.length * 2);
  const d = new DataView(b.buffer);
  v.forEach((x, i) => d.setInt16(i * 2, x, true));
  return b;
};

describe('SpaceMouse reports', () => {
  it('reads separate translation and rotation reports (older devices)', () => {
    expect(parseReport(1, le(10, -20, 350))).toEqual({ translation: [10, -20, 350] });
    expect(parseReport(2, le(-5, 0, 7))).toEqual({ rotation: [-5, 0, 7] });
  });
  it('reads a six-axis report (newer devices)', () => {
    expect(parseReport(1, le(1, 2, 3, 4, 5, 6))).toEqual({ translation: [1, 2, 3], rotation: [4, 5, 6] });
  });
  it('reads buttons as a bit mask', () => {
    expect(parseReport(3, Uint8Array.from([0b10, 0x01]))).toEqual({ buttons: 0b1_0000_0010 });
  });
  it('scales axes, applies the dead zone, and forgets stale input', () => {
    resetInput();
    feedReport(1, le(350, 10, -175, 0, 0, 0), 1000);
    const a = currentAxes({ ...defaultSpaceMouseSettings, deadZone: 0.1 }, 1010)!;
    expect(a[0]).toBeCloseTo(1);
    expect(a[1]).toBe(0); // inside the dead zone
    expect(a[2]).toBeCloseTo(-(0.5 - 0.1) / 0.9);
    expect(currentAxes(defaultSpaceMouseSettings, 2000)).toBeNull();
    expect(currentAxes({ ...defaultSpaceMouseSettings, enabled: false }, 1010)).toBeNull();
    resetInput();
  });
});

describe('SpaceMouse camera motion', () => {
  // Camera on -X looking at the origin, Z up: screen right is -Y, screen up is +Z.
  const pos: Vec3 = [-2, 0, 0];
  const tgt: Vec3 = [0, 0, 0];
  const right: Vec3 = [0, -1, 0];
  const up: Vec3 = [0, 0, 1];
  const s = defaultSpaceMouseSettings;
  const step = (axes: Axes, o = s) => spaceMouseStep(axes, 0.1, pos, tgt, right, up, o);
  const dist = (r: { position: Vec3; target: Vec3 }) => Math.hypot(...r.position.map((p, i) => p - r.target[i]));

  it('pushing right moves the view left so the model goes right', () => {
    const r = step([1, 0, 0, 0, 0, 0]);
    expect(r.target[1]).toBeGreaterThan(0); // target moves along -right = +Y
    expect(dist(r)).toBeCloseTo(2);
  });
  it('lifting the cap (negative Z) moves the model up', () => {
    expect(step([0, 0, -1, 0, 0, 0]).target[2]).toBeLessThan(0);
  });
  it('pulling the cap towards you zooms in, and the reverse option flips it', () => {
    expect(dist(step([0, 1, 0, 0, 0, 0]))).toBeLessThan(2);
    expect(dist(step([0, 1, 0, 0, 0, 0], { ...s, invertZoom: true }))).toBeGreaterThan(2);
  });
  it('twisting orbits about vertical and keeps the distance', () => {
    const r = step([0, 0, 0, 0, 0, 1]);
    expect(r.position[1]).not.toBeCloseTo(0);
    expect(r.position[2]).toBeCloseTo(0);
    expect(dist(r)).toBeCloseTo(2);
  });
  it('tilting towards you raises the camera over the model', () => {
    const r = step([0, 0, 0, 1, 0, 0]);
    expect(r.position[2]).toBeGreaterThan(0);
    expect(dist(r)).toBeCloseTo(2);
  });
  it('switched-off motions do nothing', () => {
    const r = step([1, 1, 1, 1, 1, 1], { ...s, pan: false, zoom: false, rotate: false });
    expect(r).toEqual({ position: pos, target: tgt });
  });
});

describe('file dialog filters', () => {
  it('offers .dat and .shk with the current one first', () => {
    expect(modelFilters('car.shk')[0].extensions).toEqual(['shk']);
    expect(modelFilters('car.dat').map((f) => f.extensions[0])).toEqual(['dat', 'shk']);
  });
  it('opens several extensions together', () => {
    expect(openFilters(['dat', 'shk'])[0].extensions).toEqual(['dat', 'shk']);
    expect(openFilters(['dat'])).toEqual([{ name: 'DAT files', extensions: ['dat'] }]);
  });
});
