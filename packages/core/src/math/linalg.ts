/** Small dense linear algebra used by the solvers. Matrices are arrays of rows. */
export type Matrix = number[][];

export const zeros = (r: number, c: number): Matrix => Array.from({ length: r }, () => new Array(c).fill(0));

/** Solve A x = b with Gaussian elimination and partial pivoting. Returns null if singular. */
export function solveLinear(A: Matrix, b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-300) return null;
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    const p = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / p;
      if (f === 0) continue;
      const Mr = M[r];
      const Mc = M[col];
      for (let c = col; c <= n; c++) Mr[c] -= f * Mc[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * One damped Gauss-Newton (Levenberg-Marquardt) step: minimises |J dx + r|^2 + lambda |dx|^2.
 * Works for square, over- and under-determined (redundant) systems.
 */
export function lmStep(J: Matrix, r: number[], lambda: number): number[] {
  const m = J.length;
  const n = J[0]?.length ?? 0;
  const JtJ = zeros(n, n);
  const Jtr = new Array(n).fill(0);
  for (let k = 0; k < m; k++) {
    const row = J[k];
    const rk = r[k];
    for (let i = 0; i < n; i++) {
      const ji = row[i];
      if (ji === 0) continue;
      Jtr[i] += ji * rk;
      for (let j = i; j < n; j++) JtJ[i][j] += ji * row[j];
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) JtJ[i][j] = JtJ[j][i];
    JtJ[i][i] += lambda * (1 + JtJ[i][i]);
  }
  const dx = solveLinear(JtJ, Jtr.map((v) => -v));
  return dx ?? new Array(n).fill(0);
}

export const norm2 = (v: number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

/** Least-squares polynomial fit y = c0 + c1 x + ... + cn x^n. */
export function polyfit(x: number[], y: number[], order: number): number[] {
  const n = order + 1;
  const A = zeros(n, n);
  const b = new Array(n).fill(0);
  for (let k = 0; k < x.length; k++) {
    const pw = [1];
    for (let i = 1; i < 2 * n; i++) pw.push(pw[i - 1] * x[k]);
    for (let i = 0; i < n; i++) {
      b[i] += pw[i] * y[k];
      for (let j = 0; j < n; j++) A[i][j] += pw[i + j];
    }
  }
  return solveLinear(A, b) ?? new Array(n).fill(NaN);
}
