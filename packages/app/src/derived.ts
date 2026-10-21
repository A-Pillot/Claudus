import { useEffect, useMemo, useRef, useState } from 'react';
import { analyse, complianceAt, Corner, defaultCompliance, makeCompliant, solveAxle, type AxleState, type ComplianceData, type ComplianceResult, type EndAnalysis, type Model } from '@claudus/core';
import { isEditing, useApp } from './store';

/**
 * The compliance data the solver uses: the model's own (or the defaults), with every external force switched
 * off when the master switch says so.
 */
export function effectiveCompliance(c: ComplianceData | undefined, forcesOn: boolean): ComplianceData {
  const d = c ?? defaultCompliance();
  return forcesOn ? d : { ...d, forceSets: d.forceSets.map((f) => ({ ...f, on: false })) };
}

export function useEffectiveCompliance(): ComplianceData {
  const c = useApp((s) => s.model.compliance);
  const forcesOn = useApp((s) => s.forcesOn);
  return useMemo(() => effectiveCompliance(c, forcesOn), [c, forcesOn]);
}

/** The kinematic model of the end being shown, rebuilt when its data changes. */
export function useCorner(): { corner?: Corner; error?: string } {
  const data = useApp((s) => s.model[s.end]);
  const end = useApp((s) => s.end);
  // A template can change under the same number (edited, or loaded from a file), so rebuild then too.
  const templatesRev = useApp((s) => s.templatesRev);
  const compliant = useApp((s) => s.compliant);
  const comp = useEffectiveCompliance();
  return useMemo(() => {
    if (!data) return { error: `This model has no ${end} suspension.` };
    try {
      const corner = new Corner(data, end);
      // In compliant mode every solve of this corner is deflected under the spring and external loads.
      return { corner: compliant ? makeCompliant(corner, comp) : corner };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [data, end, templatesRev, compliant, comp]);
}

/** The compliant solution (joint deflections and forces, spring and tyre loads) at the current position of the right-hand corner. */
export function useComplianceDetail(corner?: Corner): ComplianceResult | undefined {
  const compliant = useApp((s) => s.compliant);
  const art = useApp((s) => s.art);
  const comp = useEffectiveCompliance();
  return useMemo(() => {
    if (!compliant || !corner) return undefined;
    const deform = corner.deform;
    corner.deform = undefined;
    try {
      return complianceAt(corner, corner.solve(art), comp);
    } catch {
      return undefined;
    } finally {
      corner.deform = deform;
    }
  }, [compliant, corner, art, comp]);
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
  const compliant = useApp((s) => s.compliant);
  const comp = useEffectiveCompliance();
  const [state, setState] = useState<AnalysisState>({ busy: true });
  const lastRun = useRef(0);
  useEffect(() => {
    setState((s) => ({ ...s, busy: true }));
    // While a point is being dragged the graphs refresh about three times a second instead of waiting for a pause.
    const live = isEditing() && Date.now() - lastRun.current > 300;
    const t = setTimeout(() => {
      lastRun.current = Date.now();
      try {
        setState({ results: analyse(compliant ? { ...model, compliance: comp } : model, { compliant }), model, busy: false });
      } catch (e) {
        setState({ busy: false, error: (e as Error).message });
      }
    }, live ? 0 : 250);
    return () => clearTimeout(t);
  }, [model, templatesRev, compliant, comp]);
  return state;
}
