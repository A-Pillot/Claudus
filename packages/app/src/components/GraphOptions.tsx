import { Dlg } from './ComplianceDialogs';

/** Per-graph display options: line colours and markers, and the x-y switch. */
export type Marker = 'none' | 'diamondFilled' | 'triangle' | 'triangleDown' | 'plus' | 'cross' | 'square' | 'diamond' | 'circle' | 'star';
export type LineKind = 'dataFront' | 'dataRear' | 'scope' | 'user';

export interface LineStyle { colour: string; marker: Marker }
export interface GraphOptions {
  swap: boolean;
  style: Record<LineKind, LineStyle>;
}

export const MARKER_NAMES: Record<Marker, string> = {
  none: 'None', diamondFilled: 'Filled diamond', triangle: 'Triangle', triangleDown: 'Inverted triangle', plus: 'Plus',
  cross: 'Cross', square: 'Square', diamond: 'Diamond', circle: 'Circle', star: 'Star',
};
export const LINE_NAMES: Record<LineKind, string> = { dataFront: 'Data line, front', dataRear: 'Data line, rear', scope: 'Scope lines', user: 'User line' };

export const defaultStyle = (): Record<LineKind, LineStyle> => ({
  dataFront: { colour: '#4e9fe5', marker: 'circle' },
  dataRear: { colour: '#f28e2b', marker: 'circle' },
  scope: { colour: '#b39ddb', marker: 'none' },
  user: { colour: '#7ee787', marker: 'circle' },
});
export const defaultOptions = (): GraphOptions => ({ swap: false, style: defaultStyle() });

/** Draw one marker centred on a canvas position (stroke and fill colours are set by the caller). */
export function drawMarker(ctx: CanvasRenderingContext2D, m: Marker, x: number, y: number, r: number) {
  if (m === 'none') return;
  ctx.beginPath();
  const poly = (pts: [number, number][]) => {
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * r, y + py * r) : ctx.moveTo(x + px * r, y + py * r)));
    ctx.closePath();
  };
  switch (m) {
    case 'circle': ctx.arc(x, y, r, 0, Math.PI * 2); break;
    case 'square': ctx.rect(x - r, y - r, 2 * r, 2 * r); break;
    case 'diamond': case 'diamondFilled': poly([[0, -1.3], [1.3, 0], [0, 1.3], [-1.3, 0]]); break;
    case 'triangle': poly([[0, -1.2], [1.1, 0.9], [-1.1, 0.9]]); break;
    case 'triangleDown': poly([[0, 1.2], [1.1, -0.9], [-1.1, -0.9]]); break;
    case 'plus': ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); break;
    case 'cross': ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.5 : r * 1.3;
        ctx[i ? 'lineTo' : 'moveTo'](x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      ctx.closePath();
      break;
  }
  if (m === 'diamondFilled') ctx.fill();
  ctx.stroke();
}

export function GraphStyleDialog({ options, onChange, onClose }: { options: GraphOptions; onChange: (o: GraphOptions) => void; onClose: () => void }) {
  const set = (k: LineKind, patch: Partial<LineStyle>) => onChange({ ...options, style: { ...options.style, [k]: { ...options.style[k], ...patch } } });
  return (
    <Dlg title="Graph line styles" onClose={onClose}>
      <table className="ctable" data-testid="graph-styles">
        <thead><tr><th>Line</th><th>Colour</th><th>Marker</th></tr></thead>
        <tbody>
          {(Object.keys(LINE_NAMES) as LineKind[]).map((k) => (
            <tr key={k}>
              <td>{LINE_NAMES[k]}</td>
              <td><input type="color" aria-label={`${LINE_NAMES[k]} colour`} value={options.style[k].colour} onChange={(e) => set(k, { colour: e.target.value })} /></td>
              <td>
                <select aria-label={`${LINE_NAMES[k]} marker`} value={options.style[k].marker} onChange={(e) => set(k, { marker: e.target.value as Marker })}>
                  {(Object.keys(MARKER_NAMES) as Marker[]).map((m) => <option key={m} value={m}>{MARKER_NAMES[m]}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row"><button onClick={() => onChange({ ...options, style: defaultStyle() })}>Set to defaults</button></div>
    </Dlg>
  );
}
