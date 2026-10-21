/**
 * Small dense symmetric eigen solvers for modal analysis.
 */
import type { Matrix } from './linalg.js';

/** Eigenvalues and eigenvectors (as columns of V) of a symmetric matrix by cyclic Jacobi rotations. */
export function symmetricEigen(A0: Matrix, tol = 1e-12, maxSweeps = 100): { values: number[]; vectors: Matrix } {
  const n = A0.length;
  const A = A0.map((r) => [...r]);
  const V: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const scale = Math.max(1e-300, ...A.map((r, i) => Math.abs(r[i])));
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (Math.sqrt(off) < tol * scale) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = A[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

/** Cholesky factor L (lower) of a symmetric positive definite matrix, or null. */
export function cholesky(M: Matrix): Matrix | null {
  const n = M.length;
  const L: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = M[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  return L;
}

/** Inverse of a lower-triangular matrix. */
function invLower(L: Matrix): Matrix {
  const n = L.length;
  const X: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    X[j][j] = 1 / L[j][j];
    for (let i = j + 1; i < n; i++) {
      let s = 0;
      for (let k = j; k < i; k++) s += L[i][k] * X[k][j];
      X[i][j] = -s / L[i][i];
    }
  }
  return X;
}

/**
 * Generalized symmetric eigenproblem K x = λ M x with M positive definite. Returns eigenvalues in ascending
 * order and M-normalised eigenvectors (xᵀ M x = 1), one per entry.
 */
export function generalizedEigen(K: Matrix, M: Matrix): { values: number[]; vectors: number[][] } {
  const n = K.length;
  const L = cholesky(M);
  if (!L) throw new Error('The mass matrix is not positive definite: every part needs a mass and inertia.');
  const Li = invLower(L);
  // A = Li K Liᵀ
  const T = Li.map((row) => Array.from({ length: n }, (_, j) => row.reduce((s, x, k) => s + x * K[k][j], 0)));
  const A = T.map((row) => Array.from({ length: n }, (_, j) => row.reduce((s, x, k) => s + x * Li[j][k], 0)));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) A[i][j] = A[j][i] = 0.5 * (A[i][j] + A[j][i]);
  const { values, vectors } = symmetricEigen(A);
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  return {
    values: order.map((i) => values[i]),
    // x = Liᵀ y
    vectors: order.map((i) => Array.from({ length: n }, (_, r) => Li.reduce((s, row, k) => s + row[r] * vectors[k][i], 0))),
  };
}

/** Solve a complex linear system (A + iB) x = f + ig, returning real and imaginary parts. */
export function solveComplex(A: Matrix, B: Matrix, f: number[], g: number[], solve: (M: Matrix, b: number[]) => number[] | null): { re: number[]; im: number[] } | null {
  const n = A.length;
  const big: Matrix = Array.from({ length: 2 * n }, (_, i) =>
    Array.from({ length: 2 * n }, (_, j) => {
      const [bi, ri] = [i >= n, i % n];
      const [bj, rj] = [j >= n, j % n];
      if (!bi && !bj) return A[ri][rj];
      if (!bi && bj) return -B[ri][rj];
      if (bi && !bj) return B[ri][rj];
      return A[ri][rj];
    }),
  );
  const x = solve(big, [...f, ...g]);
  return x ? { re: x.slice(0, n), im: x.slice(n) } : null;
}
