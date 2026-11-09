// [[B15]] leanCore, [[C79]] packActivationIsPresentation
import type { Pack } from "./packShared";
import {
  OdeIntegrateNode, MatSolveNode, MatEigenNode, PolyRootsNode,
  FitDistributionNode, DecomposeNode,
} from "../nodeClasses";

// Catalog type strings must not change: saves and formula names key on them.
const PATH = ["Packs", "Scientific Computing"];

export const SCIENTIFIC_PACK: Pack = {
  id: "scientific",
  seed: "pack-scientific",
  name: "Scientific Computing",
  description: "ODE integration, linear solve, eigenvalues and singular values, polynomial roots, distribution fitting, seasonal decomposition.",
  builtin: true,
  defaultActive: false,
  group: "Analysis",
  nodes: [
    { path: PATH, entry: { type: "ode-integrate", label: "ODE Integrate", description: "RK4 from `t0` to `t1` in N steps of `dy/dt = f(t, y)`, f a lambda of t and y, as `t` and `y` columns. scipy `solve_ivp`, R `deSolve`.", create: () => new OdeIntegrateNode(), parity: false, keywords: "ode integrate rk4 solve_ivp deSolve differential equation euler runge kutta initial value lambda" } },
    { path: PATH, entry: { type: "mat-solve", label: "Solve A·x = b", description: "Solves a square linear system `A·x = b` by Gaussian elimination with pivoting. `numpy.linalg.solve`, R `solve(A, b)`. Excel: `MMULT(MINVERSE(A), b)`.", create: () => new MatSolveNode(), parity: false, keywords: "solve linear system equations gaussian elimination ax=b simultaneous" } },
    { path: PATH, entry: { type: "mat-eigen", label: "Eigen (symmetric)", description: "Eigenvalues (largest first) and unit eigenvectors of a symmetric matrix, or the singular values and right singular vectors of any matrix. numpy `linalg.eigh` / `linalg.svd`, R `eigen` / `svd`.", create: () => new MatEigenNode(), parity: false, keywords: "eigen eigenvalues eigenvectors pca principal components symmetric jacobi spectral" } },
    { path: PATH, entry: { type: "cx-polyroots", label: "Polynomial Roots", description: "All roots of a polynomial from its coefficients (highest degree first), complex included, plus the real roots alone. `numpy.roots`, R `polyroot`.", create: () => new PolyRootsNode(), parity: false, keywords: "polynomial roots polyroot np.roots zeros solve cubic quartic complex factor" } },
    { path: PATH, entry: { type: "fit-distribution", label: "Fit Distribution", description: "Maximum-likelihood fits ranked by AIC and KS; the winner's parameters in Distribution order. scipy `fit`, R `fitdistrplus`, @RISK.", create: () => new FitDistributionNode(), parity: false, keywords: "fit distribution fitdist fitdistr mle maximum likelihood aic goodness of fit ks which distribution normal lognormal gamma weibull exponential beta poisson @risk crystal ball" } },
    { path: PATH, entry: { type: "decompose", label: "Decompose", description: "Trend, seasonal and residual parts of a series: additive, multiplicative or STL (loess). statsmodels `seasonal_decompose`, R `decompose` / `stl`.", create: () => new DecomposeNode(), parity: false, keywords: "decompose decomposition seasonal trend residual seasonality time series stl loess classical moving average deseasonalize" } },
  ],
};
