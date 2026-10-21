import { useMemo } from 'react';
import { formatSdf } from '@claudus/core';
import type { AnalysisState } from '../derived';
import { useApp } from '../store';

export function SdfView({ analysis }: { analysis: AnalysisState }) {
  const name = useApp((s) => s.fileName);
  const { results, model } = analysis;
  const text = useMemo(() => (results && model ? formatSdf(model, results, name) : 'Calculating…'), [model, results, name]);
  return <pre className="sdf">{text}</pre>;
}
