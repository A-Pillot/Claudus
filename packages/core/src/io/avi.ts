/** Uncompressed AVI writer (SHARK's AVI File Writer): RIFF AVI, one 'DIB ' video stream of 24-bit BI_RGB frames. */
export interface AviFrame {
  /** RGBA pixels, row 0 at the top, length width * height * 4. */
  rgba: Uint8Array | Uint8ClampedArray;
}

export interface AviOptions {
  width: number;
  height: number;
  fps: number;
  frames: AviFrame[];
}

/** Bytes in one frame: 24-bit rows padded to four bytes. */
export const aviFrameSize = (width: number, height: number): number => ((width * 3 + 3) & ~3) * height;

export function writeAvi({ width, height, fps, frames }: AviOptions): Uint8Array {
  if (!(width > 0 && height > 0) || !Number.isInteger(width) || !Number.isInteger(height)) throw new Error('AVI size must be positive whole pixels');
  if (!(fps > 0)) throw new Error('AVI frame rate must be positive');
  if (!frames.length) throw new Error('AVI needs at least one frame');
  for (const f of frames) if (f.rgba.length !== width * height * 4) throw new Error('AVI frame size does not match the video size');

  const stride = (width * 3 + 3) & ~3;
  const frameBytes = stride * height;
  const n = frames.length;
  const chunkBytes = 8 + frameBytes; // frameBytes is a multiple of four, so no pad byte
  const moviSize = 4 + n * chunkBytes;
  const hdrlSize = 4 + (8 + 56) + (12 + (8 + 56) + (8 + 40)); // 'hdrl' + avih + LIST strl (strh + strf)
  const idxSize = n * 16;
  const total = 12 + (8 + hdrlSize) + (8 + moviSize) + (8 + idxSize);

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  const tag = (s: string) => { for (let i = 0; i < 4; i++) out[p++] = s.charCodeAt(i); };
  const u32 = (v: number) => { dv.setUint32(p, v >>> 0, true); p += 4; };
  const u16 = (v: number) => { dv.setUint16(p, v, true); p += 2; };
  const usPerFrame = Math.round(1e6 / fps);

  tag('RIFF'); u32(total - 8); tag('AVI ');
  tag('LIST'); u32(hdrlSize); tag('hdrl');
  tag('avih'); u32(56);
  u32(usPerFrame); u32(Math.round(frameBytes * fps)); u32(0); u32(0x10); // flags: has index
  u32(n); u32(0); u32(1); u32(frameBytes); u32(width); u32(height); u32(0); u32(0); u32(0); u32(0);
  tag('LIST'); u32(4 + (8 + 56) + (8 + 40)); tag('strl');
  tag('strh'); u32(56);
  tag('vids'); tag('DIB '); u32(0); u16(0); u16(0); u32(0);
  u32(1000); u32(Math.round(fps * 1000)); // scale, rate: frames per second = rate / scale
  u32(0); u32(n); u32(frameBytes); u32(0xffffffff); u32(0);
  u16(0); u16(0); u16(width); u16(height);
  tag('strf'); u32(40);
  u32(40); u32(width); u32(height); u16(1); u16(24); u32(0); u32(frameBytes); u32(0); u32(0); u32(0); u32(0);
  tag('LIST'); u32(moviSize); tag('movi');
  for (const f of frames) {
    tag('00db'); u32(frameBytes);
    const src = f.rgba;
    for (let y = height - 1; y >= 0; y--) {
      let s = y * width * 4;
      const rowStart = p;
      for (let x = 0; x < width; x++, s += 4) { out[p++] = src[s + 2]; out[p++] = src[s + 1]; out[p++] = src[s]; }
      p = rowStart + stride;
    }
  }
  tag('idx1'); u32(idxSize);
  for (let i = 0; i < n; i++) { tag('00db'); u32(0x10); u32(4 + i * chunkBytes); u32(frameBytes); }
  return out;
}
