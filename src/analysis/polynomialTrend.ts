export interface PolynomialFit {
  requestedDegree: number;
  degree: number;
  coefficients: number[]; // a0 + a1*x + a2*x^2 + ... in original x units
  r2: number;
  points: number;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];
    const divisor = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-18) continue;
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function multiplyPolynomials(a: number[], b: number[]): number[] {
  const out = Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) out[i + j] += a[i] * b[j];
  }
  return out;
}

function convertCenteredCoefficients(centered: number[], meanX: number, scaleX: number): number[] {
  // centered polynomial uses z=(x-meanX)/scaleX. Expand into original x units.
  let out = [0];
  const zPoly = [-meanX / scaleX, 1 / scaleX];
  let power = [1];
  for (let k = 0; k < centered.length; k += 1) {
    if (out.length < power.length) out.push(...Array(power.length - out.length).fill(0));
    for (let i = 0; i < power.length; i += 1) out[i] += centered[k] * power[i];
    power = multiplyPolynomials(power, zPoly);
  }
  return out;
}

export function evaluatePolynomial(coefficients: number[], x: number): number {
  let y = 0;
  for (let i = coefficients.length - 1; i >= 0; i -= 1) y = y * x + coefficients[i];
  return y;
}

/**
 * Ordinary least-squares polynomial fit over the whole supplied series.
 * Requested degree is capped at 3 and automatically reduced if too few
 * distinct X values are available or the normal equations become singular.
 */
export function fitPolynomialLeastSquares(
  points: Array<{ x: number; y: number }>,
  requestedDegree: number,
): PolynomialFit | null {
  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length < 2) return null;
  const distinctX = new Set(clean.map((p) => p.x)).size;
  let degree = Math.max(1, Math.min(3, Math.floor(requestedDegree), distinctX - 1, clean.length - 1));

  const meanX = clean.reduce((sum, p) => sum + p.x, 0) / clean.length;
  const maxAbs = Math.max(...clean.map((p) => Math.abs(p.x - meanX)), 1);
  const normalized = clean.map((p) => ({ x: (p.x - meanX) / maxAbs, y: p.y }));

  let centered: number[] | null = null;
  while (degree >= 1 && !centered) {
    const size = degree + 1;
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    const vector = Array(size).fill(0);
    for (const p of normalized) {
      const powers = Array(2 * degree + 1).fill(1);
      for (let k = 1; k < powers.length; k += 1) powers[k] = powers[k - 1] * p.x;
      for (let row = 0; row < size; row += 1) {
        vector[row] += p.y * powers[row];
        for (let col = 0; col < size; col += 1) matrix[row][col] += powers[row + col];
      }
    }
    centered = solveLinearSystem(matrix, vector);
    if (!centered) degree -= 1;
  }
  if (!centered || degree < 1) return null;

  const coefficients = convertCenteredCoefficients(centered, meanX, maxAbs);
  const meanY = clean.reduce((sum, p) => sum + p.y, 0) / clean.length;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of clean) {
    const predicted = evaluatePolynomial(coefficients, p.x);
    ssRes += (p.y - predicted) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const r2 = ssTot <= 1e-15 ? (ssRes <= 1e-15 ? 1 : 0) : 1 - ssRes / ssTot;
  return { requestedDegree, degree, coefficients, r2, points: clean.length };
}
