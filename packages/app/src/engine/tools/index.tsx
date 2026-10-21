// Engine tools: combustion analysis, friction estimator, port flow analysis, concept builder, parametric / optimiser.
import { useEffect } from 'react';
import type { EngineModel } from '@claudus/engine';
import './tools.css';
import { CombustionTool } from './CombustionTool';
import { ConceptTool } from './ConceptTool';
import { FrictionTool } from './FrictionTool';
import { ParametricTool } from './ParametricTool';
import { PortFlowTool } from './PortFlowTool';

export type EngineTool = 'combustion' | 'friction' | 'portflow' | 'concept' | 'parametric';

const TITLES: Record<EngineTool, string> = {
  combustion: 'Combustion Analysis',
  friction: 'Friction Estimator',
  portflow: 'Port Flow Analysis',
  concept: 'Concept Builder',
  parametric: 'Parametric / Optimizer',
};

export function EngineToolsDialog({ tool, onClose, evaluate }: { tool: EngineTool; onClose: () => void; evaluate?: (m: EngineModel) => Promise<number> | number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-label={TITLES[tool]} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog etools">
        <div className="etools-head">
          <h3>{TITLES[tool]}</h3>
          <button onClick={onClose}>Close</button>
        </div>
        {tool === 'combustion' && <CombustionTool />}
        {tool === 'friction' && <FrictionTool />}
        {tool === 'portflow' && <PortFlowTool />}
        {tool === 'concept' && <ConceptTool onClose={onClose} />}
        {tool === 'parametric' && <ParametricTool evaluate={evaluate} />}
      </div>
    </div>
  );
}
