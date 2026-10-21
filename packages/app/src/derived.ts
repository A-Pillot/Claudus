import { useEffect, useMemo, useRef, useState } from 'react';
import { analyse, Corner, solveAxle, type AxleState, type EndAnalysis, type Model } from '@claudus/core';
import { useApp } from './store';

/** The kinematic model of the end being shown, rebuilt when its data changes. */
export function useCorner(): { corner?: Corner; error?: string } {
  const data = useApp((s) => s.model[s.end]);
  const end = useApp((s) => s.end);
  // A template can change under the same number (edited, or loaded from a file), so rebuild then too.
  const templatesRev = useApp((s) => s.templatesRev);
  return useMemo(() => {
    if (!data) return { error: `This model has no ${end} suspension.` };
    try {
      return { corner: new Corner(data, end) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [data, end, templatesRev]);
}

/** Both corners solved at the current articulation. Warm-starts from the previous solve so sliders stay smooth. */
export function useAxleState(corner?: Corner): AxleState | undefined {
  const art = useApp((s) => s.art);
  const warm = useRef<{ corner?: Corner; right?: number[]; left?: number[] }>({});
  return useMemo(() => {
    if (!corner) return undefined;
    if (warm.current.corner !== corner) warm.current = { corner };
    try {
      let st = solveAxle(corner, art, warm.current);
      const ok = (a: AxleState) => a.right.converged && (a.leftMirror?.converged ?? true);
      if (!ok(st)) st = solveAxle(corner, art); // retry from static
      warm.current = { corner, right: st.right.x, left: st.leftMirror?.x };
      return st;
    } catch {
      return undefined;
    }
  }, [corner, art]);
}

/** Full derivative sweeps for the whole model. Recomputed shortly after edits stop. */
export interface AnalysisState {
  results?: EndAnalysis[];
  /** The model the results belong to (it can lag behind the model being edited). */
  model?: Model;
  busy: boolean;
  error?: string;
}

export function useAnalysis(): AnalysisState {
  const model = useApp((s) => s.model);
  const templatesRev = useApp((s) => s.templatesRev);
  const [state, setState] = useState<AnalysisState>({ busy: true });
  useEffect(() => {
    setState((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      try {
        setState({ results: analyse(model), model, busy: false });
      } catch (e) {
        setState({ busy: false, error: (e as Error).message });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [model, templatesRev]);
  return state;
}
