import { describe, expect, it } from 'vitest';
import { createGroup, newModel } from '@claudus/core';
import { useApp } from './store';
import { coincidentWith, editSet, movePoint, pickable, useEdit } from './editing';

describe('group-aware editing', () => {
  it('moves a whole saved group, a temporary group, and retains part lengths', () => {
    useApp.getState().setModel(newModel(1, 'front'), 'a.dat');
    useEdit.getState().set({ changeMode: 'change' });
    useApp.setState((s) => ({ model: createGroup(s.model, 'g', 'front', [0, 1]) }));
    expect(editSet(0)).toEqual([0, 1]);
    const before = useApp.getState().model.front!.points;
    movePoint(0, [0, 0, 5]);
    const after = useApp.getState().model.front!.points;
    expect(after[0][2]).toBe(before[0][2] + 5);
    expect(after[1][2]).toBe(before[1][2] + 5);
    expect(after[2]).toEqual(before[2]);
    // A temporary group takes priority for its members.
    useEdit.getState().setTempGroup([2, 3]);
    expect(editSet(3)).toEqual([2, 3]);
    useEdit.getState().setTempGroup([]);
    // Retain mode: only body points can be picked, and the parts they hold move with them.
    useEdit.getState().set({ changeMode: 'retain' });
    expect(pickable(0)).toBe(true);
    expect(pickable(2)).toBe(false); // outboard point on the wishbone and upright
    expect(editSet(0).length).toBeGreaterThan(2);
    useEdit.getState().set({ changeMode: 'change' });
  });

  it('finds coincident points', () => {
    useApp.getState().setModel(newModel(1, 'front'), 'a.dat');
    const pts = useApp.getState().model.front!.points;
    useEdit.getState().set({ coincidenceTol: 0.5 });
    expect(coincidentWith(0)).toEqual([0]);
    for (let k = 0; k < 3; k++) useApp.getState().setPoint(1, k, pts[0][k]);
    expect(coincidentWith(0)).toEqual([0, 1]);
  });
});
