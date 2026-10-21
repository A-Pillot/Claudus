import { it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createDefaultModel, parseSim } from '@claudus/engine';
it('dump', () => {
  const show = (n: string, m: any) => { const v = Object.entries(m.layout) as any; const xs = v.map((e: any) => e[1].x), ys = v.map((e: any) => e[1].y); console.log(n, v.length, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), JSON.stringify(v.slice(0,3))); };
  show('default', createDefaultModel({}));
  const d = 'packages/engine/test/fixtures/';
  for (const f of readdirSync(d).filter((x) => x.endsWith('.sim')).slice(0, 18)) show(f, parseSim(readFileSync(d + f, 'utf8')));
});
