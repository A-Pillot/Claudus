// Small numeric helpers shared by the tools (no dependencies).

export const DEG = Math.PI / 180;

/** Split a text line into numeric tokens. Fortran-style numbers (".5", "1.E3", "1D3") are accepted. */
export function numbersIn(line: string): number[] {
  const out: number[] = [];
  const clean = line.replace(/:.*$/, '').replace(/,/g, ' ');
  for (const tok of clean.trim().split(/\s+/)) {
    if (!tok) continue;
    const v = Number(tok.replace(/[dD]/, 'e'));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Linear interpolation of y(x) for ascending x, clamped at the ends. */
export function interp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/** Slider-crank cylinder volume function (m^3 vs deg from firing TDC). Dimensions in mm; clearance in m^3 optional. */
export function crankVolumeFn(bore: number, stroke: number, rod: number, pinOffset: number, cr: number, clearance?: number): (thetaDeg: number) => number {
  const l = rod / 1000, e = pinOffset / 1000, a = stroke / 2000;
  const area = (Math.PI / 4) * (bore / 1000) ** 2;
  const vc = clearance !== undefined ? clearance : (area * stroke / 1000) / (cr - 1);
  const height = (th: number) => a * Math.cos(th) + Math.sqrt(Math.max(l * l - (a * Math.sin(th) - e) ** 2, 0));
  let xMax = height(0);
  for (let d = -10; d <= 10; d += 0.05) xMax = Math.max(xMax, height(d * DEG));
  return (thetaDeg) => vc + area * (xMax - height(thetaDeg * DEG));
}

export interface NelderMeadOptions {
  maxIter?: number;
  tol?: number; // on the function spread
  step?: number[]; // initial simplex step per variable
}

export interface MinResult {
  x: number[];
  f: number;
  iterations: number;
  evaluations: number;
}

/** Bounded Nelder-Mead minimiser (bounds applied by clamping). Synchronous. */
export function nelderMead(f: (x: number[]) => number, x0: number[], lo: number[], hi: number[], opt: NelderMeadOptions = {}): MinResult {
  const n = x0.length;
  const maxIter = opt.maxIter ?? 200 * n;
  const tol = opt.tol ?? 1e-9;
  const clamp = (x: number[]) => x.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
  let evals = 0;
  const ev = (x: number[]) => { evals++; const v = f(x); return Number.isFinite(v) ? v : 1e300; };
  let pts = [clamp(x0)];
  for (let i = 0; i < n; i++) {
    const p = pts[0].slice();
    const st = opt.step?.[i] ?? ((hi[i] - lo[i]) * 0.1 || 0.1);
    p[i] = p[i] + st > hi[i] ? p[i] - st : p[i] + st;
    pts.push(clamp(p));
  }
  let fs = pts.map(ev);
  let it = 0;
  for (; it < maxIter; it++) {
    const order = fs.map((_, i) => i).sort((a, b) => fs[a] - fs[b]);
    pts = order.map((i) => pts[i]);
    fs = order.map((i) => fs[i]);
    if (Math.abs(fs[n] - fs[0]) <= tol * (1 + Math.abs(fs[0]))) break;
    const cen = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += pts[i][j] / n;
    const along = (t: number) => clamp(cen.map((c, j) => c + t * (pts[n][j] - c)));
    const xr = along(-1), fr = ev(xr);
    if (fr < fs[0]) {
      const xe = along(-2), fe = ev(xe);
      if (fe < fr) { pts[n] = xe; fs[n] = fe; } else { pts[n] = xr; fs[n] = fr; }
    } else if (fr < fs[n - 1]) {
      pts[n] = xr; fs[n] = fr;
    } else {
      const xc = fr < fs[n] ? along(-0.5) : along(0.5), fc = ev(xc);
      if (fc < Math.min(fr, fs[n])) { pts[n] = xc; fs[n] = fc; } else {
        for (let i = 1; i <= n; i++) { pts[i] = clamp(pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]))); fs[i] = ev(pts[i]); }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i <= n; i++) if (fs[i] < fs[bi]) bi = i;
  return { x: pts[bi], f: fs[bi], iterations: it, evaluations: evals };
}

/** Golden-section minimiser of a unimodal 1-D function on [a, b]. */
export function goldenSection(f: (x: number) => number, a: number, b: number, tol = 1e-6, maxIter = 200): { x: number; f: number; evaluations: number } {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = f(c), fd = f(d), evals = 2;
  for (let i = 0; i < maxIter && Math.abs(b - a) > tol; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
    evals++;
  }
  const x = (a + b) / 2;
  return { x, f: f(x), evaluations: evals + 1 };
}

/** Linear least squares: solves min |A c - y| for the given basis functions. */
export function polyFit(xs: number[], ys: number[], basis: ((x: number) => number)[]): number[] {
  const m = basis.length;
  const ata = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const aty = new Array<number>(m).fill(0);
  for (let k = 0; k < xs.length; k++) {
    const row = basis.map((b) => b(xs[k]));
    for (let i = 0; i < m; i++) {
      aty[i] += row[i] * ys[k];
      for (let j = 0; j < m; j++) ata[i][j] += row[i] * row[j];
    }
  }
  // Gaussian elimination with partial pivoting.
  for (let i = 0; i < m; i++) {
    let p = i;
    for (let r = i + 1; r < m; r++) if (Math.abs(ata[r][i]) > Math.abs(ata[p][i])) p = r;
    [ata[i], ata[p]] = [ata[p], ata[i]];
    [aty[i], aty[p]] = [aty[p], aty[i]];
    const piv = ata[i][i] || 1e-30;
    for (let r = i + 1; r < m; r++) {
      const fct = ata[r][i] / piv;
      for (let c = i; c < m; c++) ata[r][c] -= fct * ata[i][c];
      aty[r] -= fct * aty[i];
    }
  }
  const c = new Array<number>(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    let s = aty[i];
    for (let j = i + 1; j < m; j++) s -= ata[i][j] * c[j];
    c[i] = s / (ata[i][i] || 1e-30);
  }
  return c;
}
