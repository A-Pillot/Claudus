import { useMemo, useRef, useState } from 'react';
import { aviFrameSize, modelBaseName, sweepPath } from '@claudus/core';
import { useApp, type ArticulationState } from '../store';
import { files } from '../files';
import { useCorner } from '../derived';
import { fmtUnit, unitText, useUnitSettings } from '../units';
import { captureFrame, hasCanvas, makeVideo, outputSize, recorderType, sourceSize, useFrames, type VideoFormat } from '../video';
import { Dlg } from './ComplianceDialogs';

type Mode = keyof ArticulationState;

const SWEEPS: { mode: Mode; label: string; unit: string }[] = [
  { mode: 'bump', label: 'Bump', unit: 'mm' },
  { mode: 'roll', label: 'Roll', unit: 'deg' },
  { mode: 'rack', label: 'Steer (rack)', unit: 'mm' },
];

const WIDTHS = [480, 640, 960, 1280, 1920];

/** SHARK's AVI File Writer: animate over a displacement range, or write the captured frames in order. */
export function VideoDialog({ onClose }: { onClose: () => void }) {
  useUnitSettings();
  const p = useApp((s) => s.model.params);
  const fileName = useApp((s) => s.fileName);
  const { corner } = useCorner();
  const frames = useFrames((s) => s.frames);
  const { remove, clear } = useFrames.getState();
  const steerable = corner?.mech.rackPoint !== undefined;
  const webmType = recorderType();

  const [source, setSource] = useState<'sweep' | 'frames'>('sweep');
  const [mode, setMode] = useState<Mode>('bump');
  const [perStep, setPerStep] = useState(1);
  const [loop, setLoop] = useState(true);
  const [fps, setFps] = useState(25);
  const [format, setFormat] = useState<VideoFormat>('avi');
  const [width, setWidth] = useState(960);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const range = {
    bump: { min: -p.reboundTravel, max: p.bumpTravel, inc: p.bumpIncrement, unit: 'mm' },
    roll: { min: -p.rollAngle, max: p.rollAngle, inc: p.rollIncrement, unit: 'deg' },
    rack: { min: -p.steerTravel, max: p.steerTravel, inc: p.steerIncrement, unit: 'mm' },
  }[mode];
  const values = useMemo(
    () => sweepPath({ min: range.min, max: range.max, increment: range.inc, framesPerStep: perStep, loop }),
    [range.min, range.max, range.inc, perStep, loop],
  );

  const count = source === 'sweep' ? values.length : frames.length;
  const src = hasCanvas() || source === 'frames' ? sourceSize({ format, fps, width, source: source === 'sweep' ? { kind: 'sweep', mode, values } : { kind: 'frames', frames } }) : undefined;
  const size = src ? outputSize(src[0], src[1], width) : undefined;
  const aviMB = size ? (count * aviFrameSize(size[0], size[1])) / 1e6 : 0;
  const busy = progress !== null;
  const canRun = count > 0 && !!size && fps > 0 && (format === 'avi' || !!webmType) && (source !== 'sweep' || mode !== 'rack' || steerable);

  const run = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setMessage(null);
    setProgress([0, count]);
    try {
      const r = await makeVideo(
        { format, fps, width, source: source === 'sweep' ? { kind: 'sweep', mode, values } : { kind: 'frames', frames } },
        (d, t) => setProgress([d, t]),
        ctl.signal,
      );
      const base = modelBaseName(fileName) + (source === 'sweep' ? '_' + mode : '_frames');
      const saved = await files().saveBinary(`${base}.${r.ext}`, r.data, r.mime);
      setMessage(saved ? { text: `Saved ${saved}: ${r.frames} frames, ${r.width} x ${r.height}.` } : { text: 'Not saved.' });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };
  const capture = async () => { if (!(await captureFrame())) setMessage({ text: 'The 3D view is not ready.', error: true }); };

  return (
    <Dlg title="Export animation" onClose={() => { abort.current?.abort(); onClose(); }}>
      <p className="muted small">Writes the 3D view as an animation. AVI is uncompressed (large files, plays anywhere); WebM is compressed.</p>
      <div className="seg" role="radiogroup" aria-label="Source">
        <button className={source === 'sweep' ? 'on' : ''} onClick={() => setSource('sweep')} disabled={busy}>Displacement range</button>
        <button className={source === 'frames' ? 'on' : ''} onClick={() => setSource('frames')} disabled={busy}>Captured frames ({frames.length})</button>
      </div>

      {source === 'sweep' ? (
        <>
          <div className="row">
            <label className="vlabel">Sweep</label>
            <select aria-label="Sweep" value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as Mode)}>
              {SWEEPS.map((s) => <option key={s.mode} value={s.mode} disabled={s.mode === 'rack' && !steerable}>{s.label}</option>)}
            </select>
            <span className="muted small" data-testid="video-range">
              {fmtUnit(range.unit, range.min, 2)} to {fmtUnit(range.unit, range.max, 2)} {unitText(range.unit)}, step {fmtUnit(range.unit, range.inc, 2)}
            </span>
          </div>
          <div className="row">
            <label className="vlabel">Frames per step</label>
            <input className="numcell" type="number" min={1} max={10} aria-label="Frames per step" value={perStep} disabled={busy}
              onChange={(e) => setPerStep(Math.max(1, Math.min(10, Math.round(Number(e.target.value)) || 1)))} />
            <label className="check"><input type="checkbox" checked={loop} disabled={busy} onChange={(e) => setLoop(e.target.checked)} /> Loop back and forth</label>
          </div>
        </>
      ) : (
        <div className="row">
          <button onClick={capture} disabled={busy}>Capture frame</button>
          <button onClick={clear} disabled={busy || !frames.length}>Clear all</button>
          <span className="muted small">Set up the view, capture, change the position or view, capture again.</span>
        </div>
      )}
      {source === 'frames' && (
        <div className="framelist" data-testid="frame-list">
          {frames.length === 0 && <span className="muted small">No frames yet.</span>}
          {frames.map((f, i) => (
            <div key={f.id} className="frame">
              <img src={f.thumb} alt={`Frame ${i + 1}`} />
              <span className="small">{i + 1}</span>
              <button className="icon" aria-label={`Remove frame ${i + 1}`} disabled={busy} onClick={() => remove(f.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <label className="vlabel">Frame rate</label>
        <input className="numcell" type="number" min={1} max={60} aria-label="Frames per second" value={fps} disabled={busy}
          onChange={(e) => setFps(Math.max(1, Math.min(60, Math.round(Number(e.target.value)) || 25)))} />
        <span className="muted small">fps</span>
        <label className="vlabel short">Format</label>
        <select aria-label="Format" value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as VideoFormat)}>
          <option value="avi">AVI (uncompressed)</option>
          <option value="webm" disabled={!webmType}>{webmType?.startsWith('video/mp4') ? 'MP4' : 'WebM'}{webmType ? '' : ' (not supported here)'}</option>
        </select>
      </div>
      <div className="row">
        <label className="vlabel">Width</label>
        <select aria-label="Width" value={width} disabled={busy} onChange={(e) => setWidth(Number(e.target.value))}>
          {WIDTHS.map((w) => <option key={w} value={w}>{w} px</option>)}
        </select>
        <span className="muted small" data-testid="video-info">
          {count} frames{count ? `, ${(count / fps).toFixed(1)} s` : ''}{size ? `, ${size[0]} x ${size[1]}` : ''}{format === 'avi' && size ? `, about ${aviMB.toFixed(0)} MB` : ''}
        </span>
      </div>
      {format === 'avi' && aviMB > 400 && <p className="error small">This file will be large. Lower the width or the number of frames.</p>}

      {progress && <progress value={progress[0]} max={progress[1]} aria-label="Progress" />}
      {message && <p className={message.error ? 'error small' : 'muted small'} data-testid="video-message">{message.text}</p>}
      <div className="row">
        <button className="primary" onClick={run} disabled={busy || !canRun} data-testid="video-export">Export…</button>
        {busy && <button onClick={() => abort.current?.abort()}>Cancel</button>}
      </div>
    </Dlg>
  );
}
