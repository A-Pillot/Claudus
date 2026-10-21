// Text results (.MRS style) and exports.
import { useMemo } from 'react';
import { formatReport, resultsToCsv, tracesToCsv } from '@claudus/engine';
import { useEngine } from '../store';
import { download } from './vars';
import './results.css';

export function ExportButtons() {
  const results = useEngine((s) => s.results);
  const model = useEngine((s) => s.model);
  const base = (results?.modelName || model?.name || 'engine').replace(/[^\w.-]+/g, '_');
  return (
    <>
      <button disabled={!results} onClick={() => results && download(`${base}_performance.csv`, resultsToCsv(results), 'text/csv')}>Export CSV</button>
      <button disabled={!results?.points.length} onClick={() => results && download(`${base}_traces.csv`, tracesToCsv(results.points[results.points.length - 1]), 'text/csv')} title="Traces of the last test point">Export traces CSV</button>
      <button disabled={!results || !model} onClick={() => results && model && download(`${base}.mrs.txt`, formatReport(model, results))}>Export report</button>
    </>
  );
}

export function ReportView() {
  const results = useEngine((s) => s.results);
  const model = useEngine((s) => s.model);
  const text = useMemo(() => (results && model ? formatReport(model, results) : ''), [results, model]);
  if (!results) return <div className="er-empty">No results yet. Run the simulation to see the text report.</div>;
  return (
    <div className="er-view">
      <div className="er-bar"><ExportButtons /></div>
      <pre className="er-report">{text || 'Load a model to produce the report.'}</pre>
    </div>
  );
}
