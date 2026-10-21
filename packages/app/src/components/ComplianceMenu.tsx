import { useEffect, useRef, useState } from 'react';
import { useApp, type ComplianceDialogId } from '../store';

function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return { open, setOpen, ref };
}

const DATA: [ComplianceDialogId, string][] = [
  ['bushes', 'Bush properties…'],
  ['bushSliders', 'Bush stiffness sliders…'],
  ['springs', 'Spring properties…'],
  ['dampers', 'Damper properties…'],
  ['tyre', 'Tyre vertical stiffness…'],
  ['rollbar', 'Roll bar rate…'],
  ['general', 'General data…'],
  ['forces', 'External forces…'],
];

/** SHARK's compliant solver switch, the Data / Compliance Data menu and the compliance Results menu. */
export function ComplianceMenus() {
  const compliant = useApp((s) => s.compliant);
  const setCompliant = useApp((s) => s.setCompliant);
  const forcesOn = useApp((s) => s.forcesOn);
  const setForcesOn = useApp((s) => s.setForcesOn);
  const includeSpring = useApp((s) => s.model.compliance?.settings.includeSpring ?? true);
  const editCompliance = useApp((s) => s.editCompliance);
  const setDialog = useApp((s) => s.setDialog);
  const data = useMenu();
  const res = useMenu();
  const show = (id: ComplianceDialogId, m: ReturnType<typeof useMenu>) => () => { m.setOpen(false); setDialog(id); };
  return (
    <>
      <button className={compliant ? 'on' : ''} aria-pressed={compliant} title="Solve with compliance (bushes, springs, tyres and external forces)" onClick={() => setCompliant(!compliant)}>
        3D Compliance
      </button>
      <div className="menu" ref={data.ref}>
        <button onClick={() => data.setOpen(!data.open)} className={data.open ? 'on' : ''}>Compliance ▾</button>
        {data.open && (
          <div className="menulist" role="menu">
            {DATA.map(([id, label]) => <button key={id} onClick={show(id, data)}>{label}</button>)}
            <hr />
            <button role="menuitemcheckbox" aria-checked={includeSpring} onClick={() => editCompliance((c) => { c.settings.includeSpring = !c.settings.includeSpring; })}>
              <span className="tick">{includeSpring ? '✓' : ''}</span>Include spring force
            </button>
            <button role="menuitemcheckbox" aria-checked={forcesOn} onClick={() => setForcesOn(!forcesOn)}>
              <span className="tick">{forcesOn ? '✓' : ''}</span>External forces
            </button>
          </div>
        )}
      </div>
      <div className="menu" ref={res.ref}>
        <button onClick={() => res.setOpen(!res.open)} className={res.open ? 'on' : ''}>Results ▾</button>
        {res.open && (
          <div className="menulist" role="menu">
            <button onClick={show('coefficients', res)}>Compliance coefficients…</button>
            <button disabled={!compliant} onClick={show('joints', res)}>Joint deflections and forces…</button>
            <button disabled={!compliant} onClick={show('loads', res)}>Spring and tyre loads…</button>
          </div>
        )}
      </div>
    </>
  );
}
