import { useEffect, useRef, useState } from 'react';
import type { Corner } from '@claudus/core';
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

  const ranges: Record<Mode, { min: number; max: number; step: number; label: string; unit: string; digits: number }> = {
    bump: { min: -p.reboundTravel, max: p.bumpTravel, step: 0.5, label: 'Bump', unit: 'mm', digits: 1 },
    roll: { min: -p.rollAngle, max: p.rollAngle, step: 0.05, label: 'Roll', unit: 'deg', digits: 2 },
    rack: { min: -p.steerTravel, max: p.steerTravel, step: 0.5, label: 'Steer (rack)', unit: 'mm', digits: 1 },
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
              onClick={() => setPlaying(playing === m ? null : m)}
            >
              {playing === m ? '■' : '▶'}
            </button>
          </div>
        );
      })}
      <button onClick={() => { setPlaying(null); setArt({ bump: 0, roll: 0, rack: 0 }); }}>Static</button>
    </div>
  );
}
