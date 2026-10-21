// Data Checking panel and cylinder firing order display.
import type { Issue } from './check';
import { firingOrder } from './testpoints';
import { useEngine } from './store';

export function CheckPanel({ issues }: { issues: Issue[] }) {
  const setSelection = useEngine((s) => s.setSelection);
  const model = useEngine((s) => s.model);
  if (!model) return null;
  const firing = firingOrder(model);
  return (
    <div className="props">
      <h3>Data checking</h3>
      {issues.length === 0 && <p className="ok">No problems found.</p>}
      <ul className="issues">
        {issues.map((i, n) => (
          <li key={n} className={i.severity} onClick={() => i.key && setSelection([i.key])} style={{ cursor: i.key ? 'pointer' : 'default' }}>
            <b>{i.severity === 'error' ? 'Error' : 'Warning'}</b> {i.message}
          </li>
        ))}
      </ul>
      <h3>Cylinder timing</h3>
      <table className="etable">
        <thead><tr><th>Order</th><th>Cylinder</th><th>Fires (deg)</th><th>Interval</th></tr></thead>
        <tbody>{firing.map((f) => <tr key={f.id}><td>{f.order}</td><td>{f.label}</td><td>{f.angle.toFixed(1)}</td><td>{f.interval.toFixed(1)}</td></tr>)}</tbody>
      </table>
      <p className="muted small">Firing order: {firing.map((f) => f.id).join('-')}</p>
    </div>
  );
}
