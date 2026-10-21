/**
 * Animation export (SHARK's Graphics / AVI File Writer): the 3D view is stepped through a displacement range, or a
 * list of captured frames is played, and written as an uncompressed AVI or a WebM (MediaRecorder).
 */
import { create } from 'zustand';
import { writeAvi, type AviFrame } from '@claudus/core';
import { useApp, type ArticulationState } from './store';

let glCanvas: HTMLCanvasElement | null = null;
/** The 3D view registers its canvas here (it is created with preserveDrawingBuffer so it can be read back). */
export const registerCanvas = (c: HTMLCanvasElement | null) => { glCanvas = c; };
export const hasCanvas = () => glCanvas !== null;

export interface CapturedFrame {
  id: number;
  canvas: HTMLCanvasElement;
  thumb: string;
}

interface FrameStore {
  frames: CapturedFrame[];
  add: (f: Omit<CapturedFrame, 'id'>) => void;
  remove: (id: number) => void;
  clear: () => void;
}

let nextId = 1;
export const useFrames = create<FrameStore>((set) => ({
  frames: [],
  add: (f) => set((s) => ({ frames: [...s.frames, { ...f, id: nextId++ }] })),
  remove: (id) => set((s) => ({ frames: s.frames.filter((f) => f.id !== id) })),
  clear: () => set({ frames: [] }),
}));

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Let the store update reach the 3D view and be drawn. */
const settle = async () => { await frame(); await frame(); await frame(); };

function copyOf(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/** Add the 3D view as it is now to the frame list (SHARK's screen-shot sequence). */
export async function captureFrame(): Promise<boolean> {
  if (!glCanvas) return false;
  await frame(); // the buffer is complete once the current frame is drawn
  const c = copyOf(glCanvas);
  const t = document.createElement('canvas');
  t.width = 96;
  t.height = Math.max(1, Math.round((96 * c.height) / c.width));
  t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
  useFrames.getState().add({ canvas: c, thumb: t.toDataURL('image/png') });
  return true;
}

export type VideoFormat = 'avi' | 'webm';

/** The first video type MediaRecorder can write here, or undefined when it cannot record at all. */
export function recorderType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
}

export interface VideoOptions {
  format: VideoFormat;
  fps: number;
  /** Output width in pixels (never larger than the source). */
  width: number;
  /** A sweep of the articulation, or the captured frames. */
  source: { kind: 'sweep'; mode: keyof ArticulationState; values: number[] } | { kind: 'frames'; frames: CapturedFrame[] };
}

export interface VideoResult {
  data: Blob | Uint8Array;
  mime: string;
  ext: string;
  frames: number;
  width: number;
  height: number;
}

/** Size of the film: the source's aspect ratio at the wanted width. */
export function outputSize(srcW: number, srcH: number, width: number): [number, number] {
  const w = Math.max(16, Math.min(srcW, Math.round(width)));
  return [w, Math.max(16, Math.round((w * srcH) / srcW))];
}

export function sourceSize(o: VideoOptions): [number, number] | undefined {
  if (o.source.kind === 'frames') {
    const f = o.source.frames[0];
    return f ? [f.canvas.width, f.canvas.height] : undefined;
  }
  return glCanvas ? [glCanvas.width, glCanvas.height] : undefined;
}

export async function makeVideo(o: VideoOptions, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<VideoResult> {
  const src = sourceSize(o);
  if (!src) throw new Error('There is nothing to record yet.');
  const [w, h] = outputSize(src[0], src[1], o.width);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: o.format === 'avi' })!;
  const total = o.source.kind === 'sweep' ? o.source.values.length : o.source.frames.length;
  const interval = 1000 / o.fps;

  // Draw one source picture into the output and hand it to the encoder.
  let emit: (i: number) => Promise<void>;
  let finish: () => Promise<VideoResult>;
  let cleanup = () => {};
  if (o.format === 'avi') {
    const frames: AviFrame[] = [];
    emit = async () => { frames.push({ rgba: ctx.getImageData(0, 0, w, h).data }); };
    finish = async () => {
      const data = writeAvi({ width: w, height: h, fps: o.fps, frames });
      return { data, mime: 'video/x-msvideo', ext: 'avi', frames: frames.length, width: w, height: h };
    };
  } else {
    const mime = recorderType();
    if (!mime) throw new Error('This browser cannot record WebM video. Use AVI instead.');
    // Rendering can be slower than the frame rate, so the pictures are kept and played into the recorder afterwards.
    const pics: HTMLCanvasElement[] = [];
    emit = async () => { pics.push(copyOf(out)); };
    finish = async () => {
      const rec = new MediaRecorder(out.captureStream(o.fps), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      cleanup = () => { if (rec.state !== 'inactive') rec.stop(); };
      rec.start();
      for (let i = 0; i < pics.length; i++) {
        if (signal.aborted) throw new Error('Cancelled');
        ctx.drawImage(pics[i], 0, 0);
        onProgress(i + 1, pics.length);
        await sleep(interval);
      }
      await sleep(Math.max(0, 300 - interval)); // a very short film needs a moment for the encoder to flush
      const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
      rec.stop();
      await stopped;
      const type = mime.split(';')[0];
      return { data: new Blob(chunks, { type }), mime: type, ext: type === 'video/mp4' ? 'mp4' : 'webm', frames: total, width: w, height: h };
    };
  }

  const draw = (img: CanvasImageSource) => { ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h); };
  const saved = useApp.getState().art;
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new Error('Cancelled');
      if (o.source.kind === 'sweep') {
        useApp.getState().setArt({ ...saved, [o.source.mode]: o.source.values[i] });
        await settle();
        draw(glCanvas!);
      } else {
        draw(o.source.frames[i].canvas);
      }
      await emit(i);
      onProgress(i + 1, total);
    }
    return await finish();
  } catch (e) {
    cleanup();
    throw e;
  } finally {
    if (o.source.kind === 'sweep') useApp.getState().setArt(saved);
  }
}
