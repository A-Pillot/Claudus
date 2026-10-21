import { it } from 'vitest';
import { Pipe1D } from '../src/pipes/index';
it('bench', () => {
  const p = new Pipe1D({ length: 0.5, diameterAt: () => 0.04, cellLength: 0.01, gamma: 1.4, R: 287, wallTemperature: 320, frictionFactor: 0.004, heatTransfer: true, initial: { p: 1.2e5, T: 300 } });
  const a = { p0: 1e5, T0: 300, gamma: 1.4, R: 287, burnt: 0, effArea: 0 };
  const b = { p0: 1.5e5, T0: 300, gamma: 1.4, R: 287, burnt: 0, effArea: 0 };
  for (let k = 0; k < 2; k++) {
    const t0 = performance.now(); let n = 0;
    for (let i = 0; i < 20000; i++) { const dt = Math.min(p.maxStableDt(), 1e-5); p.step(dt, a, b); n++; }
    console.log('us/step', ((performance.now() - t0) * 1000) / n);
  }
});
