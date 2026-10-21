/** Reading a data file into the app: shared by Open, the recent files list and anything else that loads text. */
import { DatParseError, isTwoDText, readDat, readTwoD, TwoDParseError, type OptimiserFileData } from '@claudus/core';
import { useApp } from './store';
import { useLab } from './lab';
import { useSettings } from './settings';
import { useTwoD } from './twod/store2d';

/** Put saved optimiser set-up (Include Optimiser Settings in Data Files) into the optimiser and kinematic sum. */
export function applyOptimiser(o: OptimiserFileData): void {
  const lab = useLab.getState();
  lab.setOptParams(o.parameters);
  lab.setOptSettings(o.settings);
  lab.setSumTargets(o.targets);
}

/** What the optimiser and kinematic sum hold now, as it is saved in a file. */
export function optimiserSnapshot() {
  const lab = useLab.getState();
  return structuredClone({ parameters: lab.optParams, settings: lab.optSettings, targets: lab.sumTargets });
}

/** Load a file's text as a 2D or 3D model. Returns an error message, or null when it worked. */
export function loadFileText(f: { name: string; text: string }): string | null {
  try {
    const two = useTwoD.getState();
    if (isTwoDText(f.text)) {
      two.load(readTwoD(f.text), f.name);
    } else {
      const m = readDat(f.text);
      useApp.getState().setModel(m, f.name);
      if (m.optimiser) applyOptimiser(m.optimiser);
      two.deactivate();
    }
    useSettings.getState().addRecent({ name: f.name, text: f.text });
    return null;
  } catch (e) {
    return e instanceof DatParseError || e instanceof TwoDParseError ? e.message : `Could not read ${f.name}: ${(e as Error).message}`;
  }
}
