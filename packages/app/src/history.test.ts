import { describe, expect, it } from 'vitest';
import { newModel } from '@claudus/core';
import { beginEdit, endEdit, useApp } from './store';
import { movePoint } from './editing';

const pt = () => useApp.getState().model.front!.points[0].slice();

describe('undo and redo', () => {
  it('records point edits and restores them', () => {
    useApp.getState().setModel(newModel(1, 'front'), 'a.dat');
    const p0 = pt();
    useApp.getState().setPoint(0, 0, p0[0] + 5);
    useApp.getState().setPoint(0, 1, p0[1] + 7);
    expect(useApp.getState().undoStack.length).toBe(2);
    useApp.getState().undo();
    expect(pt()).toEqual([p0[0] + 5, p0[1], p0[2]]);
    useApp.getState().undo();
    expect(pt()).toEqual(p0);
    useApp.getState().redo();
    expect(pt()[0]).toBe(p0[0] + 5);
    useApp.getState().setPoint(0, 2, 1);
    expect(useApp.getState().redoStack.length).toBe(0);
  });

  it('groups a drag into one step and honours the buffer length', () => {
    useApp.getState().setModel(newModel(1, 'front'), 'a.dat');
    const p0 = pt();
    beginEdit();
    for (let i = 0; i < 10; i++) movePoint(0, [1, 0, 0]);
    endEdit();
    expect(useApp.getState().undoStack.length).toBe(1);
    useApp.getState().undo();
    expect(pt()).toEqual(p0);
    useApp.getState().setUndoLimit(2);
    for (let i = 0; i < 5; i++) useApp.getState().setPoint(0, 0, i);
    expect(useApp.getState().undoStack.length).toBe(2);
    useApp.getState().setUndoLimit(0);
    expect(useApp.getState().undoStack.length).toBe(0);
    useApp.getState().setPoint(0, 0, 99);
    expect(useApp.getState().undoStack.length).toBe(0);
    useApp.getState().setUndoLimit(50);
  });
});
