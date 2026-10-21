import { useState } from 'react';
import { useAnalysis, useAxleState, useComplianceDetail, useCorner, useTolerance } from './derived';
import { useModes } from './modes';
import { AnalysisDialogs } from './components/AnalysisDialogs';
import { useApp } from './store';
import { useLab } from './lab';
import { useDisplayedState, useFreeBody, useModal } from './display';
import { Toolbar } from './components/Toolbar';
import { PointTable } from './components/PointTable';
import { ParamsPanel } from './components/ParamsPanel';
import { Viewer3D } from './components/Viewer3D';
import { ArticulationBar } from './components/ArticulationBar';
import { Readouts } from './components/Readouts';
import { Graphs } from './components/Graphs';
import { AddBanner } from './components/GraphicsMenu';
import { GroupsPanel } from './components/GroupsPanel';
import { SdfView } from './components/SdfView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ComplianceDialogs } from './components/ComplianceDialogs';
import { EditUserLineDialog, ManageUserLinesDialog } from './components/UserLineDialogs';
import { KinSumPanel, OptimiserPanel } from './components/SumPanels';
import { DisplayModeBar, FreeBodyTable, ModalPanel, SweepPanel } from './components/ModalPanels';
import { MassDialog } from './components/MassDialog';
import { TwoDApp } from './twod/TwoDApp';
import { useTwoD } from './twod/store2d';

type SideTab = 'points' | 'params' | 'groups';
type BottomTab = 'graphs' | 'sdf';

export function App() {
  const { corner, error } = useCorner();
  const state = useAxleState(corner);
  const analysis = useAnalysis();
  const tolerance = useTolerance();
  const reportErrors = useModes((s) => s.reportErrors);
  const compliant = useApp((s) => s.compliant);
  const detail = useComplianceDetail(corner);
  const display = useLab((s) => s.display);
  const modalOpen = useLab((s) => s.panels.modal);
  const modal = useModal(corner, state, compliant && (display.mode === 'mode' || modalOpen));
  const shown = useDisplayedState(corner, state, modal);
  const freeBody = useFreeBody(corner, detail);
  const selected = useApp((s) => s.selected);
  const revision = useApp((s) => s.revision);
  const [side, setSide] = useState<SideTab>('points');
  const [bottom, setBottom] = useState<BottomTab>('graphs');
  const label = corner && selected !== null ? corner.template.points[selected] : undefined;
  const twoD = useTwoD((s) => s.active);

  // The 2D module has its own data and screen; the toolbar is shared.
  if (twoD) {
    return (
      <div className="app">
        <Toolbar analysis={analysis} />
        <TwoDApp />
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar analysis={analysis} />
      <aside className="side">
        <Tabs value={side} onChange={setSide} tabs={[['points', 'Hard points'], ['params', 'General data'], ['groups', 'Groups']]} />
        <div className="scroll">{side === 'points' ? <PointTable /> : side === 'params' ? <ParamsPanel /> : <GroupsPanel />}</div>
      </aside>
      <main className="view">
        {corner && state ? (
          <>
            <ErrorBoundary resetKey={revision}><Viewer3D corner={corner} state={shown.state ?? state} detail={detail} ghosts={shown.ghosts} freeBody={freeBody} /></ErrorBoundary>
            <AddBanner />
            {compliant && <div className="overlay badge">Compliant solution</div>}
            {shown.caption && <div className="overlay caption" data-testid="display-caption">{shown.caption}</div>}
            <DisplayModeBar modal={modal} corner={corner} />
            {freeBody && <FreeBodyTable fb={freeBody} />}
            {label && <div className="overlay">Point {label.no}: {label.label}</div>}
            {!state.right.converged && reportErrors && <div className="overlay warn">The suspension cannot reach this position.</div>}
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
          {tolerance.busy && <span className="muted small">tolerance analysis…</span>}
          {analysis.error && <span className="error">{analysis.error}</span>}
        </Tabs>
        <div className="scroll">
          <ErrorBoundary resetKey={analysis.results}>
            {bottom === 'graphs' ? <Graphs results={analysis.results} tolerance={tolerance.result} /> : <SdfView analysis={analysis} />}
          </ErrorBoundary>
        </div>
      </section>
      <ComplianceDialogs corner={corner} state={state} detail={detail} />
      <MassDialog corner={corner} state={state} />
      <AnalysisDialogs />
      <EditUserLineDialog />
      <ManageUserLinesDialog />
      <KinSumPanel />
      <OptimiserPanel />
      <ModalPanel modal={modal} />
      <SweepPanel corner={corner} state={state} />
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
