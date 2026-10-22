import { useMemo } from 'react';
import { formatSdf } from '@claudus/core';
import type { AnalysisState } from '../derived';
import { useApp } from '../store';

export function SdfView({ analysis }: { analysis: AnalysisState }) {
  const name = useApp((s) => s.fileName);
  const { results, model, error, busy } = analysis;
  const text = useMemo(() => (results && model ? formatSdf(model, results, name) : !busy && error ? `No listing: ${error}` : 'Calculating…'), [model, results, name, busy, error]);
  return <pre className="sdf">{text}</pre>;
}
