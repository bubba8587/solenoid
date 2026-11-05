// [[B15]] leanCore, [[C79]] packActivationIsPresentation
import type { Pack } from "./packShared";
import {
  SpectrumNode, SmoothNode, FindPeaksNode, ConnectedRegionsNode, ConvolveNode,
  OdeIntegrateNode, MatSolveNode, MatEigenNode, PolyRootsNode,
  FitDistributionNode, DecomposeNode,
} from "../nodeClasses";

// Catalog type strings must not change: saves and formula names key on them.
const PATH = ["Packs", "Scientific Computing"];

export const SCIENTIFIC_PACK: Pack = {
  id: "scientific",
  name: "Scientific Computing",
  description: "FFT spectrum, smoothing of a series or a grid, peak finding on a series or a grid, connected regions, 1-D and 2-D convolution, ODE integration, linear solve, eigenvalues, polynomial roots, distribution fitting, seasonal decomposition.",
  builtin: true,
  defaultActive: false,
  group: "Analysis",
  nodes: [
    { path: PATH, entry: { type: "list-spectrum", label: "Spectrum (FFT)", description: "A row per bin: frequency in the sample rate's units, magnitude (a sine of amplitude A reads A), phase. `numpy.fft.rfft`, R `fft`, MATLAB `fft`.", create: () => new SpectrumNode(), parity: false, keywords: "fft fourier spectrum frequency dft periodogram harmonics signal vibration rfft" } },
    { path: PATH, entry: { type: "list-smooth", label: "Smooth", description: "Smooths a series, or a table of numbers over its rows and columns at once, by Savitzky–Golay, LOWESS, Gaussian, a moving mean or a moving median. scipy `savgol_filter` / `gaussian_filter` / `uniform_filter` / `median_filter`, statsmodels `lowess`, MATLAB `imgaussfilt` / `medfilt2`.", create: () => new SmoothNode(), parity: false, keywords: "savitzky–golay smooth smoothing savgol savitzky golay lowess loess gaussian filter denoise noise trend signal gaussian_filter uniform_filter median_filter medfilt medfilt2 imgaussfilt smoothdata2 movmean movmedian moving average rolling median box blur denoise grid 2d image heatmap surface" } },
    { path: PATH, entry: { type: "list-peaks", label: "Find Peaks", description: "Local maxima as a frame of Position and Height, filtered by minimum height, spacing and prominence; in Grid mode, the cells above every neighbor as Row, Column and Height. `scipy.signal.find_peaks`, R `pracma::findpeaks`.", create: () => new FindPeaksNode(), parity: false, keywords: "peak_local_max 2d grid maxima peaks find_peaks local maxima maximum prominence spikes signal detect" } },
    { path: PATH, entry: { type: "grid-connected-regions", label: "Connected Regions", description: "Numbers each patch of touching non-zero cells in a table: 1, 2, 3… in reading order, 0 between them. scipy `ndimage.label`, MATLAB `bwlabel`.", create: () => new ConnectedRegionsNode(), parity: false, keywords: "regions label connected components blobs islands clusters patches segment ndimage label bwlabel bwconncomp flood fill 2d grid" } },
    { path: PATH, entry: { type: "list-convolve", label: "Convolve", description: "Sliding dot-product of two lists, or of a kernel grid over a table of numbers: smoothing kernels, edge filters, moving sums. Full, Same or Valid sets how much of the answer to keep. `numpy.convolve`, scipy `convolve2d`, MATLAB `conv` / `conv2`.", create: () => new ConvolveNode(), parity: false, keywords: "convolve convolution kernel filter signal smooth moving weighted numpy fir convolve2d conv2 filter2 kernel 2d grid image blur edge same valid full" } },
    { path: PATH, entry: { type: "ode-integrate", label: "ODE Integrate", description: "RK4 from `t0` to `t1` in N steps of `dy/dt = f(t, y)`, f a lambda of t and y, as `t` and `y` columns. scipy `solve_ivp`, R `deSolve`.", create: () => new OdeIntegrateNode(), parity: false, keywords: "ode integrate rk4 solve_ivp deSolve differential equation euler runge kutta initial value lambda" } },
    { path: PATH, entry: { type: "mat-solve", label: "Solve A·x = b", description: "Solves a square linear system `A·x = b` by Gaussian elimination with pivoting. `numpy.linalg.solve`, R `solve(A, b)`. Excel: `MMULT(MINVERSE(A), b)`.", create: () => new MatSolveNode(), parity: false, keywords: "solve linear system equations gaussian elimination ax=b simultaneous" } },
    { path: PATH, entry: { type: "mat-eigen", label: "Eigen (symmetric)", description: "Eigenvalues (largest first) and unit eigenvectors, as columns, of a symmetric matrix. `numpy.linalg.eigh`, R `eigen(symmetric=TRUE)`.", create: () => new MatEigenNode(), parity: false, keywords: "eigen eigenvalues eigenvectors pca principal components symmetric jacobi spectral" } },
    { path: PATH, entry: { type: "cx-polyroots", label: "Polynomial Roots", description: "All roots of a polynomial from its coefficients (highest degree first), complex included, plus the real roots alone. `numpy.roots`, R `polyroot`.", create: () => new PolyRootsNode(), parity: false, keywords: "polynomial roots polyroot np.roots zeros solve cubic quartic complex factor" } },
    { path: PATH, entry: { type: "fit-distribution", label: "Fit Distribution", description: "Maximum-likelihood fits ranked by AIC and KS; the winner's parameters in Distribution order. scipy `fit`, R `fitdistrplus`, @RISK.", create: () => new FitDistributionNode(), parity: false, keywords: "fit distribution fitdist fitdistr mle maximum likelihood aic goodness of fit ks which distribution normal lognormal gamma weibull exponential beta poisson @risk crystal ball" } },
    { path: PATH, entry: { type: "decompose", label: "Decompose", description: "Trend, seasonal and residual parts of a series: additive, multiplicative or STL (loess). statsmodels `seasonal_decompose`, R `decompose` / `stl`.", create: () => new DecomposeNode(), parity: false, keywords: "decompose decomposition seasonal trend residual seasonality time series stl loess classical moving average deseasonalize" } },
  ],
};
