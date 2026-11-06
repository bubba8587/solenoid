// [[B15]] leanCore, [[C79]] packActivationIsPresentation
import type { Pack } from "./packShared";
import { SpectrumNode, SmoothNode, FindPeaksNode, ConnectedRegionsNode, ConvolveNode } from "../nodeClasses";

// Catalog type strings must not change: saves and formula names key on them.
const PATH = ["Packs", "Signals & Grids"];

export const SIGNALS_PACK: Pack = {
  id: "signals",
  seed: "pack-signals",
  name: "Signals & Grids",
  description: "For a series of readings or a table of numbers like a height map: FFT spectrum, smoothing, peak finding, connected regions, and 1-D and 2-D convolution.",
  builtin: true,
  defaultActive: false,
  group: "Analysis",
  nodes: [
    { path: PATH, entry: { type: "list-spectrum", label: "Spectrum (FFT)", description: "A row per bin: frequency in the sample rate's units, magnitude (a sine of amplitude A reads A), phase. `numpy.fft.rfft`, R `fft`, MATLAB `fft`.", create: () => new SpectrumNode(), parity: false, keywords: "fft fourier spectrum frequency dft periodogram harmonics signal vibration rfft" } },
    { path: PATH, entry: { type: "list-smooth", label: "Smooth", description: "Smooths a series, or a table of numbers over its rows and columns at once, by Savitzky–Golay, LOWESS, Gaussian, a moving mean or a moving median. scipy `savgol_filter` / `gaussian_filter` / `uniform_filter` / `median_filter`, statsmodels `lowess`, MATLAB `imgaussfilt` / `medfilt2`.", create: () => new SmoothNode(), parity: false, keywords: "savitzky–golay smooth smoothing savgol savitzky golay lowess loess gaussian filter denoise noise trend signal gaussian_filter uniform_filter median_filter medfilt medfilt2 imgaussfilt smoothdata2 movmean movmedian moving average rolling median box blur denoise grid 2d image heatmap surface" } },
    { path: PATH, entry: { type: "list-peaks", label: "Find Peaks", description: "Local maxima as a frame of Position and Height, filtered by minimum height, spacing and prominence; in Grid mode, the cells above every neighbor as Row, Column and Height. `scipy.signal.find_peaks`, R `pracma::findpeaks`.", create: () => new FindPeaksNode(), parity: false, keywords: "peak_local_max 2d grid maxima peaks find_peaks local maxima maximum prominence spikes signal detect" } },
    { path: PATH, entry: { type: "grid-connected-regions", label: "Connected Regions", description: "Numbers each patch of touching non-zero cells in a table: 1, 2, 3… in reading order, 0 between them. scipy `ndimage.label`, MATLAB `bwlabel`.", create: () => new ConnectedRegionsNode(), parity: false, keywords: "regions label connected components blobs islands clusters patches segment ndimage label bwlabel bwconncomp flood fill 2d grid" } },
    { path: PATH, entry: { type: "list-convolve", label: "Convolve", description: "Sliding dot-product of two lists, or of a kernel grid over a table of numbers: smoothing kernels, edge filters, moving sums. Full, Same or Valid sets how much of the answer to keep. `numpy.convolve`, scipy `convolve2d`, MATLAB `conv` / `conv2`.", create: () => new ConvolveNode(), parity: false, keywords: "convolve convolution kernel filter signal smooth moving weighted numpy fir convolve2d conv2 filter2 kernel 2d grid image blur edge same valid full" } },
  ],
};
