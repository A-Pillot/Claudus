// Results viewers for the Engine module (performance curves, crank-angle traces, pipe display).
export type ResultsView = 'performance' | 'traces' | 'pipes' | 'report';

export function EngineResults(_props: { view: ResultsView }) {
  return <div className="engine-results">Results viewers are being built.</div>;
}
