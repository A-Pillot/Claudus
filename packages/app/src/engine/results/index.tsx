// Results viewers for the Engine module (performance curves, crank-angle traces, pipe display, text report).
import './results.css';
import { PerformanceView } from './PerformanceView';
import { TracesView } from './TracesView';
import { PipesView } from './PipesView';
import { ReportView, ExportButtons } from './ReportView';

export type ResultsView = 'performance' | 'traces' | 'pipes' | 'report';

export { ExportButtons };

export function EngineResults({ view, showExport = true }: { view: ResultsView; showExport?: boolean }) {
  return (
    <div className="engine-results">
      {showExport && view !== 'report' && <div className="er-bar er-top"><ExportButtons /></div>}
      {view === 'performance' && <PerformanceView />}
      {view === 'traces' && <TracesView />}
      {view === 'pipes' && <PipesView />}
      {view === 'report' && <ReportView />}
    </div>
  );
}
