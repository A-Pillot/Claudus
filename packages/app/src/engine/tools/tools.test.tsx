import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { EngineToolsDialog, type EngineTool } from './index';

describe('engine tool dialogs', () => {
  for (const t of ['combustion', 'friction', 'portflow', 'concept', 'parametric'] as EngineTool[]) {
    it(`renders ${t}`, () => {
      const html = renderToString(<EngineToolsDialog tool={t} onClose={() => {}} />);
      expect(html).toContain('etools');
    });
  }
});
