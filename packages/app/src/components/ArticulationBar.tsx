import { useEffect, useRef, useState } from 'react';
import { defaultCombined, type Corner } from '@claudus/core';
import { useModes } from '../modes';
import { fmtUnit, unitText, useUnitSettings } from '../units';
import { useApp, type ArticulationState } from '../store';

type Mode = keyof ArticulationState;

export function ArticulationBar({ corner }: { corner?: Corner }) {
  const p = useApp((s) => s.model.params);
  const art = useApp((s) => s.art);
  const setArt = useApp((s) => s.setArt);
  const [playing, setPlaying] = useState<Mode | null>(null);
  useUnitSettings();
  const steerable = corner?.mech.rackPoint !== undefined;

  // Combined motion: a position along the profile's path of bump and rack steps.
  const profile = useApp((s) => s.model.combined) ?? defaultCombined(p);
  const pos = useModes((s) => s.combinedPos);
  const nSteps = profile.steps.length;
  const [combPlay, setCombPlay] = useState(false);
  const atPos = (q: number) => {
    const i = Math.min(Math.floor(q), nSteps - 2);
    const a = profile.steps[Math.max(0, i)];
    const b = profile.steps[Math.min(nSteps - 1, i + 1)];
    const f = nSteps < 2 ? 0 : q - i;
    return { bump: a.bump + (b.bump - a.bump) * f, rack: a.rack + (b.rack - a.rack) * f };
  };
  const goTo = (q: number) => { useModes.getState().set({ combinedPos: q }); setArt({ ...atPos(q), roll: 0 }); };
  useEffect(() => {
    if (!combPlay || nSteps < 2) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const q = (((now - t0) / 1000) * (nSteps - 1)) / 8 % (nSteps - 1); // one pass in about 8 seconds
      goTo(q);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combPlay, nSteps]);

  const boxSteer = !!corner?.options.steerAxis;
  const ranges: Record<Mode, { min: number; max: number; step: number; label: string; unit: string; digits: number }> = {
    bump: { min: -p.reboundTravel, max: p.bumpTravel, step: 0.5, label: 'Bump', unit: 'mm', digits: 1 },
    roll: { min: -p.rollAngle, max: p.rollAngle, step: 0.05, label: 'Roll', unit: 'deg', digits: 2 },
    rack: boxSteer
      ? { min: -p.steerTravel, max: p.steerTravel, step: 0.5, label: 'Steer (arm)', unit: 'deg', digits: 1 }
      : { min: -p.steerTravel, max: p.steerTravel, step: 0.5, label: 'Steer (rack)', unit: 'mm', digits: 1 },
  };

  // Animate one articulation back and forth through its range.
  const t0 = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    t0.current = performance.now();
    const r = ranges[playing];
    const tick = (now: number) => {
      const phase = ((now - t0.current) / 3000) * 2 * Math.PI;
      const s = Math.sin(phase);
      const v = s >= 0 ? s * r.max : -s * r.min;
      setArt({ [playing]: Math.round(v / r.step) * r.step });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, p]);

  return (
    <div className="artbar">
      {(Object.keys(ranges) as Mode[]).map((m) => {
        const r = ranges[m];
        const disabled = m === 'rack' && !steerable;
        return (
          <div key={m} className={`artctl${disabled ? ' disabled' : ''}`}>
            <label>
              {r.label}
              <span className="val">{disabled ? 'n/a' : `${fmtUnit(r.unit, art[m], r.digits)} ${unitText(r.unit)}`}</span>
            </label>
            <input
              type="range"
              min={r.min}
              max={r.max}
              step={r.step}
              value={art[m]}
              disabled={disabled}
              onChange={(e) => { setPlaying(null); setArt({ [m]: Number(e.target.value) }); }}
              onDoubleClick={() => setArt({ [m]: 0 })}
            />
            <button
              className="icon"
              disabled={disabled}
              title={playing === m ? 'Stop' : `Animate ${r.label.toLowerCase()}`}
              onClick={() => { setCombPlay(false); setPlaying(playing === m ? null : m); }}
            >
              {playing === m ? '■' : '▶'}
            </button>
          </div>
        );
      })}
      <div className="artctl" data-testid="combined-control">
        <label>
          Combined
          <span className="val">{nSteps < 2 ? 'n/a' : `step ${(pos + 1).toFixed(2)} of ${nSteps}`}</span>
        </label>
        <input
          type="range" min={0} max={Math.max(0, nSteps - 1)} step={0.05} value={Math.min(pos, Math.max(0, nSteps - 1))} disabled={nSteps < 2}
          aria-label="Combined motion position"
          onChange={(e) => { setPlaying(null); setCombPlay(false); goTo(Number(e.target.value)); }}
        />
        <button className="icon" disabled={nSteps < 2} title={combPlay ? 'Stop' : 'Animate combined motion'} onClick={() => { setPlaying(null); setCombPlay(!combPlay); }}>{combPlay ? '■' : '▶'}</button>
      </div>
      <button onClick={() => { setPlaying(null); setCombPlay(false); useModes.getState().set({ combinedPos: 0 }); setArt({ bump: 0, roll: 0, rack: 0 }); }}>Static</button>
    </div>
  );
}
