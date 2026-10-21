import { useState } from 'react';
import { useAnalysis, useAxleState, useCorner } from './derived';
import { useApp } from './store';
import { Toolbar } from './components/Toolbar';
import { PointTable } from './components/PointTable';
import { ParamsPanel } from './components/ParamsPanel';
import { Viewer3D } from './components/Viewer3D';
import { ArticulationBar } from './components/ArticulationBar';
import { Readouts } from './components/Readouts';
import { Graphs } from './components/Graphs';
import { SdfView } from './components/SdfView';
import { ErrorBoundary } from './components/ErrorBoundary';

type SideTab = 'points' | 'params';
type BottomTab = 'graphs' | 'sdf';

export function App() {
  const { corner, error } = useCorner();
  const state = useAxleState(corner);
  const analysis = useAnalysis();
  const selected = useApp((s) => s.selected);
  const revision = useApp((s) => s.revision);
  const [side, setSide] = useState<SideTab>('points');
  const [bottom, setBottom] = useState<BottomTab>('graphs');
  const label = corner && selected !== null ? corner.template.points[selected] : undefined;

  return (
    <div className="app">
      <Toolbar analysis={analysis} />
      <aside className="side">
        <Tabs value={side} onChange={setSide} tabs={[['points', 'Hard points'], ['params', 'General data']]} />
        <div className="scroll">{side === 'points' ? <PointTable /> : <ParamsPanel />}</div>
      </aside>
      <main className="view">
        {corner && state ? (
          <>
            <ErrorBoundary resetKey={revision}><Viewer3D corner={corner} state={state} /></ErrorBoundary>
            {label && <div className="overlay">Point {label.no}: {label.label}</div>}
            {!state.right.converged && <div className="overlay warn">The suspension cannot reach this position.</div>}
          </>
        ) : (
          <div className="muted pad">{error ?? 'Solving…'}</div>
        )}
      </main>
      <section className="art">
        <ArticulationBar corner={corner} />
      </section>
      <aside className="live">{corner && state && <Readouts corner={corner} state={state} />}</aside>
      <section className="bottom">
        <Tabs value={bottom} onChange={setBottom} tabs={[['graphs', 'Graphs'], ['sdf', 'SDF listing']]}>
          {analysis.busy && <span className="muted small">calculating…</span>}
          {analysis.error && <span className="error">{analysis.error}</span>}
        </Tabs>
        <div className="scroll">
          <ErrorBoundary resetKey={analysis.results}>
            {bottom === 'graphs' ? <Graphs results={analysis.results} /> : <SdfView analysis={analysis} />}
          </ErrorBoundary>
        </div>
      </section>
    </div>
  );
}

function Tabs<T extends string>({ value, onChange, tabs, children }: { value: T; onChange: (v: T) => void; tabs: [T, string][]; children?: React.ReactNode }) {
  return (
    <div className="tabs">
      {tabs.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
      <span className="grow" />
      {children}
    </div>
  );
}
