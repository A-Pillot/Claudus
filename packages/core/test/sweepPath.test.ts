import { describe, expect, it } from 'vitest';
import { sweepPath } from '../src/graphics/sweepPath.js';

describe('animation sweep path', () => {
  it('steps from min to max by the increment', () => {
    expect(sweepPath({ min: -10, max: 30, increment: 10 })).toEqual([-10, 0, 10, 20, 30]);
  });

  it('cuts each step into frames', () => {
    const p = sweepPath({ min: 0, max: 2, increment: 1, framesPerStep: 2 });
    expect(p).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('goes back to the start when looping, without repeating the ends', () => {
    const p = sweepPath({ min: 0, max: 2, increment: 1, loop: true });
    expect(p).toEqual([0, 1, 2, 1, 0]);
  });

  it('copes with a bad increment and with an empty range', () => {
    expect(sweepPath({ min: 0, max: 10, increment: 0 })).toHaveLength(41);
    expect(sweepPath({ min: 0, max: 1000, increment: 0.001, maxSteps: 50 })).toHaveLength(51);
    expect(sweepPath({ min: 5, max: 5, increment: 1 })).toEqual([5]);
  });
});
