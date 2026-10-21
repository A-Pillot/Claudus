import { useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ConvertDialog } from './ConvertDialog';
import { ArticulationBar2D, Panel2D } from './TwoDControls';
import { TwoDGraphs } from './TwoDGraphs';
import { Params2D, PointTable2D } from './TwoDPanels';
import { TwoDView } from './TwoDView';
import { useTwoD, type Articulation2D } from './store2d';
import { useSolution } from './useSolution';

type SideTab = 'points' | 'params';

/**
 * The 2D module screen. It fills the same grid areas as the 3D screen (the toolbar is shared, so App renders
 * it), and App puts these pieces where the 3D ones go.
 */
export function TwoDApp() {
  const sol = useSolution();
  const model = useTwoD((s) => s.model);
  const mode = useTwoD((s) => s.mode);
  const setMode = useTwoD((s) => s.setMode);
  const [side, setSide] = useState<SideTab>('points');
  const [converting, setConverting] = useState(false);

  return (
    <>
      <aside className="side">
        <div className="tabs">
          <button className={side === 'points' ? 'on' : ''} onClick={() => setSide('points')}>Hard points</button>
          <button className={side === 'params' ? 'on' : ''} onClick={() => setSide('params')}>General data</button>
        </div>
        <div className="scroll">{side === 'points' ? <PointTable2D sol={sol} /> : <Params2D />}</div>
      </aside>
      <main className="view">
        <ErrorBoundary resetKey={model}><TwoDView sol={sol} /></ErrorBoundary>
      </main>
      <section className="art"><ArticulationBar2D /></section>
      <aside className="live"><Panel2D sol={sol} onConvert={() => setConverting(true)} /></aside>
      <section className="bottom">
        <div className="tabs">
          {([['bump', 'Bump / rebound'], ['roll', 'Roll']] as [Articulation2D, string][]).map(([m, l]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
        <div className="scroll">
          <ErrorBoundary resetKey={sol.results}><TwoDGraphs sol={sol} /></ErrorBoundary>
        </div>
      </section>
      {converting && <ConvertDialog model={model} onClose={() => setConverting(false)} />}
    </>
  );
}
