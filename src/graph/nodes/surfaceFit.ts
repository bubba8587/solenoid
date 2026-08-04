// A THIN-PLATE SPLINE fit through scattered (x, y, z) points: exact through every
// point, extrapolating a LINEAR trend at the edges (the "forecast"). Degenerate
// inputs fall back to a ridge-regularised least-squares plane.

export interface FitPoint { x: number; y: number; z: number; }

// Solve A·x = b by Gauss–Jordan with partial pivoting. Returns null if singular.
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let k = col; k <= n; k++) M[col][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f !== 0) for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row) => row[n]);
}

// r²·log(r), the thin-plate kernel (= ½·r²·log r²); 0 at r = 0.
const phi = (r2: number): number => (r2 <= 1e-12 ? 0 : 0.5 * r2 * Math.log(r2));

// The slope terms are regularised so the plane is always solvable.
function planeFit(P: Array<[number, number]>, z: number[]): (nx: number, ny: number) => number {
  const n = P.length;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rhs = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const g = [1, P[i][0], P[i][1]];
    for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) A[a][b] += g[a] * g[b]; rhs[a] += g[a] * z[i]; }
  }
  const lambda = 1e-6 * (A[0][0] + A[1][1] + A[2][2] + 1);
  A[1][1] += lambda; A[2][2] += lambda;
  const mean = n > 0 ? z.reduce((s, v) => s + v, 0) / n : 0;
  const c = solveLinear(A, rhs) ?? [mean, 0, 0];
  return (nx, ny) => c[0] + c[1] * nx + c[2] * ny;
}

// Above this the O(n³) spline solve isn't worth it — fall back to the plane.
const TPS_MAX_POINTS = 220;

export function fitSurface(points: FitPoint[]): ((x: number, y: number) => number) | null {
  const n = points.length;
  if (n === 0) return null;
  // Normalize x,y for numerical stability; a loop, not Math.min(...spread), so a
  // huge wired grid can't blow the argument limit.
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of points) {
    if (p.x < xmin) xmin = p.x;
    if (p.x > xmax) xmax = p.x;
    if (p.y < ymin) ymin = p.y;
    if (p.y > ymax) ymax = p.y;
  }
  const sx = xmax > xmin ? 1 / (xmax - xmin) : 0, sy = ymax > ymin ? 1 / (ymax - ymin) : 0;
  const nx = (x: number) => (x - xmin) * sx, ny = (y: number) => (y - ymin) * sy;
  const P = points.map((p) => [nx(p.x), ny(p.y)] as [number, number]);
  const z = points.map((p) => p.z);

  if (n >= 3 && n <= TPS_MAX_POINTS) {
    // Thin-plate spline system: [K P; Pᵀ 0]·[w; a] = [z; 0].
    const m = n + 3;
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    const b = new Array(m).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) { const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1]; A[i][j] = phi(dx * dx + dy * dy); }
      A[i][n] = 1; A[i][n + 1] = P[i][0]; A[i][n + 2] = P[i][1];
      A[n][i] = 1; A[n + 1][i] = P[i][0]; A[n + 2][i] = P[i][1];
      b[i] = z[i];
    }
    const c = solveLinear(A, b);
    if (c) {
      const w = c.slice(0, n), a0 = c[n], a1 = c[n + 1], a2 = c[n + 2];
      return (x, y) => {
        const X = nx(x), Y = ny(y);
        let f = a0 + a1 * X + a2 * Y;
        for (let k = 0; k < n; k++) { const dx = X - P[k][0], dy = Y - P[k][1]; f += w[k] * phi(dx * dx + dy * dy); }
        return f;
      };
    }
    // singular (collinear points) → fall through to the plane
  }
  const plane = planeFit(P, z);
  return (x, y) => plane(nx(x), ny(y));
}
