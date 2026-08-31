import type { Pack } from "./packShared";
import {
  SpectrumNode, SmoothNode, FindPeaksNode, ConvolveNode,
  OdeIntegrateNode, MatSolveNode, MatEigenNode, PolyRootsNode,
  FitDistributionNode, DecomposeNode,
} from "../rete-nodes";

// The scipy-shaped toolkit, out of the base Add menu: these nodes live under
// Packs › Scientific Computing while the pack is on and nowhere while it is off.
// Real placements (not tags), so enabling the pack shows exactly what it added.
// Catalog type strings are historical and must not change (saves + formula names).
const PATH = ["Packs", "Scientific Computing"];

export const SCIENTIFIC_PACK: Pack = {
  id: "scientific",
  name: "Scientific Computing",
  description: "Signal processing and numerical methods: FFT spectrum, smoothing, peak finding, convolution, ODE integration, linear-system solve, eigenvalues, polynomial roots, distribution fitting, and seasonal decomposition.",
  builtin: true,
  defaultActive: false,
  group: "Analysis",
  nodes: [
    { path: PATH, entry: { type: "list-spectrum", label: "Spectrum (FFT)", description: "The frequency content of a signal: one row per bin with frequency (in the sample-rate's units), magnitude (a pure sine of amplitude A reads A) and phase. Any length, via Bluestein's FFT. `numpy.fft.rfft`, R `fft`, MATLAB `fft`.", create: () => new SpectrumNode(), parity: false, keywords: "fft fourier spectrum frequency dft periodogram harmonics signal vibration rfft" } },
    { path: PATH, entry: { type: "list-smooth", label: "Smooth", description: "Smooths a series: Savitzky–Golay (polynomial window), LOWESS (robust local regression) or Gaussian. scipy `savgol_filter` / `gaussian_filter1d`, statsmodels `lowess`, R `loess`.", create: () => new SmoothNode(), parity: false, keywords: "savitzky–golay smooth smoothing savgol savitzky golay lowess loess gaussian filter denoise noise trend signal" } },
    { path: PATH, entry: { type: "list-peaks", label: "Find Peaks", description: "The local maxima as a frame with Position and Height columns, filtered by minimum height, spacing and prominence. `scipy.signal.find_peaks`, R `pracma::findpeaks`.", create: () => new FindPeaksNode(), parity: false, keywords: "peaks find_peaks local maxima maximum prominence spikes signal detect" } },
    { path: PATH, entry: { type: "list-convolve", label: "Convolve", description: "Sliding dot-product of two lists (full convolution): smoothing kernels, moving sums, signal filtering. `numpy.convolve`.", create: () => new ConvolveNode(), parity: false, keywords: "convolve convolution kernel filter signal smooth moving weighted numpy fir" } },
    { path: PATH, entry: { type: "ode-integrate", label: "ODE Integrate", description: "Integrates `dy/dt = f(t, y)` with classic fixed-step RK4, from `t0` to `t1` in a set number of steps. Give the derivative as a lambda of t and y. Outputs one frame with `t` and `y` columns. scipy `solve_ivp`, R `deSolve`.", create: () => new OdeIntegrateNode(), parity: false, keywords: "ode integrate rk4 solve_ivp deSolve differential equation euler runge kutta initial value lambda" } },
    { path: PATH, entry: { type: "mat-solve", label: "Solve A·x = b", description: "Solves a square linear system: the x with `A·x = b` (Gaussian elimination with pivoting). `numpy.linalg.solve`, R `solve(A, b)`. In Excel: `MMULT(MINVERSE(A), b)`.", create: () => new MatSolveNode(), parity: false, keywords: "solve linear system equations gaussian elimination ax=b simultaneous" } },
    { path: PATH, entry: { type: "mat-eigen", label: "Eigen (symmetric)", description: "Eigenvalues (largest first) and unit eigenvectors (as columns) of a symmetric matrix, like a covariance or correlation matrix for PCA, or a Laplacian. Jacobi rotations. `numpy.linalg.eigh`, R `eigen` with `symmetric=TRUE`.", create: () => new MatEigenNode(), parity: false, keywords: "eigen eigenvalues eigenvectors pca principal components symmetric jacobi spectral" } },
    { path: PATH, entry: { type: "cx-polyroots", label: "Polynomial Roots", description: "Every root of a polynomial from its coefficient list (highest degree first), complex pairs included, with the real roots alone as a second output. `numpy.roots`, R `polyroot`.", create: () => new PolyRootsNode(), parity: false, keywords: "polynomial roots polyroot np.roots zeros solve cubic quartic complex factor" } },
    { path: PATH, entry: { type: "fit-distribution", label: "Fit Distribution", description: "Which distribution fits a sample? Fits Normal, Lognormal, Exponential, Gamma, Weibull, Uniform, Beta and Poisson by maximum likelihood (moments where standard), ranks them by AIC with the KS distance, and hands the winner's parameters back in the Distribution node's own order. `scipy.stats.<dist>.fit`, R `fitdistrplus`, @RISK / Crystal Ball fit.", create: () => new FitDistributionNode(), parity: false, keywords: "fit distribution fitdist fitdistr mle maximum likelihood aic goodness of fit ks which distribution normal lognormal gamma weibull exponential beta poisson @risk crystal ball" } },
    { path: PATH, entry: { type: "decompose", label: "Decompose", description: "Splits a seasonal series into trend, a repeating seasonal pattern and the residual: additive, multiplicative, or STL (loess). statsmodels `seasonal_decompose`, R `decompose` / `stl`.", create: () => new DecomposeNode(), parity: false, keywords: "decompose decomposition seasonal trend residual seasonality time series stl loess classical moving average deseasonalize" } },
  ],
};
