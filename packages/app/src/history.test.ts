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

describe('undo across a template edit', () => {
  it('puts the template back with the points', async () => {
    const { addPointNow, useDataUi } = await import('./dataUi');
    const { dataPoints, getTemplate } = await import('@claudus/core');
    useApp.getState().setModel(newModel(1, 'front'), 'a.dat');
    useDataUi.getState().setAdd({ what: 'point', mode: 'abs', label: 'P1', abs: [10, 20, 30] });
    addPointNow(useDataUi.getState().add); // built-in 1 becomes a custom template
    addPointNow({ ...useDataUi.getState().add, label: 'P2' }); // the custom template is edited in place
    const count = () => {
      const d = useApp.getState().model.front!;
      return [d.points.length, dataPoints(getTemplate(d.templateSlot)).length];
    };
    const [n2] = count();
    useApp.getState().undo();
    expect(count()).toEqual([n2 - 1, n2 - 1]);
    useApp.getState().undo();
    expect(count()).toEqual([n2 - 2, n2 - 2]);
    useApp.getState().redo();
    useApp.getState().redo();
    expect(count()).toEqual([n2, n2]);
  });
});

describe('temporary group', () => {
  it('is dropped when another model is opened or the end changes', async () => {
    const { useEdit } = await import('./editing');
    useApp.getState().setModel(newModel(1, 'front'), 'a.dat');
    useEdit.getState().setTempGroup([2, 3]);
    useApp.getState().setModel(newModel(1, 'front'), 'b.dat');
    expect(useEdit.getState().tempGroup).toEqual([]);
    useEdit.getState().setTempGroup([2, 3]);
    useApp.getState().setEnd('rear');
    expect(useEdit.getState().tempGroup).toEqual([]);
  });
});
