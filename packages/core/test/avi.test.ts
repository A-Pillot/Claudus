import { describe, expect, it } from 'vitest';
import { aviFrameSize, writeAvi } from '../src/io/avi.js';

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.slice(at, at + 4));

function solid(w: number, h: number, r: number, g: number, b: number) {
  const a = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([r, g, b, 255], i * 4);
  return { rgba: a };
}

describe('AVI writer', () => {
  const w = 5, h = 3, n = 4;
  const bytes = writeAvi({ width: w, height: h, fps: 25, frames: Array.from({ length: n }, (_, i) => solid(w, h, i * 10, 20, 30)) });
  const dv = new DataView(bytes.buffer);

  it('writes a RIFF AVI header with consistent sizes', () => {
    expect(ascii(bytes, 0)).toBe('RIFF');
    expect(ascii(bytes, 8)).toBe('AVI ');
    expect(dv.getUint32(4, true)).toBe(bytes.length - 8);
    expect(ascii(bytes, 12)).toBe('LIST');
    expect(ascii(bytes, 20)).toBe('hdrl');
    const hdrl = dv.getUint32(16, true);
    expect(ascii(bytes, 24)).toBe('avih');
    expect(dv.getUint32(32, true)).toBe(40000); // microseconds per frame
    expect(dv.getUint32(48, true)).toBe(n); // total frames
    expect(dv.getUint32(64, true)).toBe(w);
    expect(dv.getUint32(68, true)).toBe(h);
    // movi follows hdrl
    const moviAt = 20 + hdrl;
    expect(ascii(bytes, moviAt)).toBe('LIST');
    expect(ascii(bytes, moviAt + 8)).toBe('movi');
  });

  it('describes a 24-bit uncompressed DIB stream', () => {
    const strh = bytes.findIndex((_, i) => ascii(bytes, i) === 'strh');
    expect(ascii(bytes, strh + 8)).toBe('vids');
    expect(ascii(bytes, strh + 12)).toBe('DIB ');
    expect(dv.getUint32(strh + 28, true)).toBe(1000);
    expect(dv.getUint32(strh + 32, true)).toBe(25000);
    const strf = bytes.findIndex((_, i) => ascii(bytes, i) === 'strf');
    expect(dv.getUint32(strf + 4, true)).toBe(40);
    expect(dv.getInt32(strf + 12, true)).toBe(w);
    expect(dv.getInt32(strf + 16, true)).toBe(h);
    expect(dv.getUint16(strf + 22, true)).toBe(24);
    expect(dv.getUint32(strf + 24, true)).toBe(0); // BI_RGB
  });

  it('stores padded bottom-up BGR frames and an index', () => {
    const fs = aviFrameSize(w, h);
    expect(fs).toBe(16 * 3); // 5 px * 3 = 15 bytes padded to 16
    const movi = bytes.findIndex((_, i) => ascii(bytes, i) === 'movi');
    const moviSize = dv.getUint32(movi - 4, true);
    expect(moviSize).toBe(4 + n * (8 + fs));
    const c2 = movi + 4 + 2 * (8 + fs);
    expect(ascii(bytes, c2)).toBe('00db');
    expect(dv.getUint32(c2 + 4, true)).toBe(fs);
    expect([bytes[c2 + 8], bytes[c2 + 9], bytes[c2 + 10]]).toEqual([30, 20, 20]); // BGR of (20,20,30)
    const idx = movi + moviSize;
    expect(ascii(bytes, idx)).toBe('idx1');
    expect(dv.getUint32(idx + 4, true)).toBe(n * 16);
    expect(dv.getUint32(idx + 8 + 16 * 3 + 8, true)).toBe(4 + 3 * (8 + fs));
    expect(idx + 8 + n * 16).toBe(bytes.length);
  });

  it('flips rows so the top row comes last', () => {
    const a = new Uint8Array(2 * 2 * 4);
    a.set([255, 0, 0, 255], 0); // top-left red
    a.set([0, 0, 255, 255], 2 * 4); // bottom-left blue
    const v = writeAvi({ width: 2, height: 2, fps: 10, frames: [{ rgba: a }] });
    const movi = v.findIndex((_, i) => ascii(v, i) === 'movi');
    const first = movi + 4 + 8; // first stored row is the bottom one
    expect([v[first], v[first + 1], v[first + 2]]).toEqual([255, 0, 0]); // blue pixel as BGR
    const second = first + 8; // stride 8
    expect([v[second], v[second + 1], v[second + 2]]).toEqual([0, 0, 255]); // red pixel as BGR
  });

  it('rejects bad input', () => {
    expect(() => writeAvi({ width: 2, height: 2, fps: 10, frames: [] })).toThrow();
    expect(() => writeAvi({ width: 2, height: 2, fps: 10, frames: [{ rgba: new Uint8Array(3) }] })).toThrow();
    expect(() => writeAvi({ width: 2, height: 2, fps: 0, frames: [solid(2, 2, 0, 0, 0)] })).toThrow();
  });
});
