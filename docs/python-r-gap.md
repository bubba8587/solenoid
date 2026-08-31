# Python / R gap — functions Solenoid could carry as nodes (survey 2026-08-23)

Author ask: cast a wide net over numpy / pandas / scipy / statsmodels and base R / stats /
dplyr / tidyr / stringr / lubridate — "a specific node existing may be the difference in
retaining a user", especially where the thing is impossible or impractical to compose from
what exists. Every candidate below was checked ABSENT from `nodeCatalog.ts` (the 2026-08-23
build: 493 leaves) and against the composition that does exist. Each line: what it is, the
closest current composition (so we don't duplicate), a build-cost call. Node + formula on a
shared rete-free kernel, per capabilityParity, is assumed for everything numeric.

Ranking = (how often the function appears in real notebooks / Excel-refugee workflows) ×
(how painful the current workaround is) ÷ cost. Tier 1 is the "build next" list.

## Tier 1 — LANDED 2026-08-23 (all sixteen; each a node + formula on a rete-free kernel, pinned)

Shipped in the order built: Aggregate one-liners (PTP/IQR/MAD/SEM/CV/RMS) + SPEARMAN/KENDALL;
quantile Bin (NTILE), Outliers, Epoch ↔ Date, Truncate Date, Haversine; Describe, Correlation
Matrix, Amortization Schedule; the eight Hypothesis-Test ops (ANOVA, Kruskal–Wallis,
Mann–Whitney, Wilcoxon, Fisher exact, KS exact, two-proportion z, binomial); TRACE /
MATRIXRANK / NORM + Solve + Eigen (symmetric); Spectrum (FFT, Bluestein); Text Similarity +
Fuzzy Match; Forecast (ETS) = Holt–Winters + FORECAST.ETS family; **Window** (per-group
running / rank / lag / share columns — a lazy FrameOp: Polars `.over()` on desktop, the JS
oracle on web, `window.json` in the parity corpus). Reference overlay chips (numpy / pandas / scipy / R / SQL / Excel)
let a refugee filter to what they know. Tests: `pythonRGap.test.ts`, `statsParity.test.ts`,
`distributionFormula.test.ts`, `dateParity.test.ts`, `functionReferenceLibs.test.ts`.

## Tier 2 — LANDED 2026-08-23 except the items marked open (#20's weighted pick, #27, #31)

17. **Text template / glue** — LANDED 2026-08-23 (Template node: {name} / {name:spec} grow a
    socket per name, lists broadcast, date-typed inputs format as dates; TEMPLATE(text, v0, …)
    positional formula).
18. **Text pad / truncate / unaccent / slugify** — LANDED 2026-08-23 (UNACCENT + SLUGIFY ops
    on Text Transform; Pad Text + Truncate Text nodes; PADTEXT / TRUNCATETEXT formulas).
    `str_wrap` (text → lines) — LANDED 2026-08-24 (Wrap Text node, WRAPTEXT(text, width) formula
    returning a string list; a list output, so its own node, not a Transform op).
19. **Positions where** — LANDED 2026-08-23 (ARGSORT / ARGSORT DESC / WHICH ops on the ARGMAX
    card, sockets retyping with the op; ARGSORT(list, [desc]) + WHICH(flags) formulas).
20. **Weighted random choice / sample** — LANDED 2026-08-23 (Distribution node `Sample` form:
    N draws by inverse CDF, seeded per recalculation; RANDDIST formula). A weighted pick on
    Shuffle / Take (`np.random.choice(p=)`) stays open.
21. **Savitzky–Golay / LOWESS / Gaussian smoothing, peak finding** — LANDED 2026-08-23 (Smooth
    card with per-op parameter sockets; Find Peaks card with height / distance / prominence;
    SAVGOL / LOWESS / GAUSSIANSMOOTH / FINDPEAKS; scipy-pinned).
22. **Drawdown / Sharpe / volatility / log returns** — LANDED 2026-08-23 (Returns card: log /
    simple / cumulative returns, drawdown, max drawdown, CAGR, volatility, Sharpe, Sortino —
    op swaps the rf / periods sockets and the output rank; LOGRETURNS … SORTINO formulas).
23. **Seasonal decomposition** — LANDED 2026-08-23 (Decompose card: trend / seasonal /
    residual, additive or multiplicative, the classical 2×MA filter; DECOMPOSE(list, period,
    component, [model]) formula). STL (loess) — LANDED 2026-08-24 as the `stl` model (R
    stl s.window="periodic": exactly-periodic seasonal + a loess trend with no blank ends;
    `stlDecompose` in forecastOps.ts, node selector + the DECOMPOSE formula's stl model).
24. **Distribution fitting** — LANDED 2026-08-23 (Fit Distribution node + FITDIST; MLE for normal / lognormal / exponential / gamma / Weibull / uniform / Poisson, moments for beta; AIC ranking + KS).
25. **Logistic regression** — LANDED 2026-08-23 (Logistic Regression card: 0/1 or logical
    target + the other number columns → coefficient frame with Wald SE / z / p and fitted
    probabilities; unregularized IRLS like glm(binomial), references transcribed and pinned).
26. **K-means and PCA** — LANDED 2026-08-23 (K-Means card: k-means++ seeded restarts, a
    cluster per row + a centers frame; PCA card: scores / loadings / explained, centered or
    standardized; both over a frame's number columns, numpy-pinned).
27. **ODE integrate** — LANDED 2026-08-24 (ODE Integrate card: dy/dt as a LAMBDA of t and y
    → classic fixed-step RK4 over [t0, t1], one `{t, y}` frame output; rete-free `rk4` kernel in
    `odeOps.ts`. Node-only — no formula compiles a lambda/expression argument on the formula surface).
28. **Roots of a polynomial** — LANDED 2026-08-23 (Polynomial Roots card: coefficient list →
    complex roots + the real ones, Durand–Kerner, numpy.roots-pinned; POLYROOTS formula).
    General root-finding on an Expression (`uniroot` / `fsolve`) stays with the Equation node.
29. **Cross join** — LANDED 2026-08-23 (Join `how = cross`: no keys, all columns, left-major;
    oracle + Polars cross_join, corpus-pinned).
30. **Bind columns** — LANDED 2026-08-23 (Bind Columns node, Append's sibling for the other
    axis: positional, headers deduped, ragged pads; backend seam `bindColumns` on both
    engines, corpus-pinned).
31. **Histogram 2-D / heatmap binning** — LANDED 2026-08-24 (`histogram2d` kernel; a 2-D MODE
    on the Histogram node, not a second node — paired X/Y → count grid drawn as a contour
    density plot; HISTOGRAM2D(xs, ys, kx, ky) formula returns the bordered-grid matrix).
32. **Hash / UUID / Base64** — LANDED 2026-08-23 (Hash card: SHA-256 / SHA-1 / MD5 / CRC-32 /
    FNV-1a, pure sync implementations pinned against hashlib; UUID source node (volatile);
    ENCODEBASE64 / DECODEBASE64 on the url-encode card; HASH / UUID formulas).

## Tier 3 — out of character or already covered by composition (recorded so nobody re-asks)

- `apply`/`map`/`reduce`/`scan` → MAP / BYROW / REDUCE / SCAN exist. `cut` → Bin. `scale` →
  Normalize z. `paste` → CONCAT/TEXTJOIN. `table`/`value_counts` → Group By / Group Lists.
  `crosstab` → PIVOTBY. `melt`/`pivot_wider` → Unpivot / PIVOTBY. `separate`/`unite` →
  Split/Merge Columns. `fill`/`drop_na`/`replace_na` → Fill Down / Drop Blank Rows / Replace.
  `lag`/`lead`/`diff`/`pct_change`/`cumsum`/`rolling`/`ewm` → Shift / DIFF / Running / EWMA
  (lists; the per-group forms are item 1). `interp`/`polyfit`/`trapz`/`gradient`/`convolve`/
  `outer`/`cross`/`diag`/`digitize`/`isclose` → landed 2026-08-23. `which.max` → ARGMAX.
  `rev`/`rep`/`seq`/`unique`/set ops → present. `rnorm`/`qnorm`/`pnorm`… → Distribution.
  `lm` → LINEST (multiple x: verify), `t.test`/`chisq.test`/`var.test` → Hypothesis Test.
- Time zones, locale-aware formatting, regex flags beyond the REGEX node, and anything
  needing a network service (geocoding, FX rates) stay with the widget-nodes decision.
- Decision trees / random forests / neural nets: not this app (out-of-scope.md spirit).

## How to run it
Each Tier-1 item is one backlog line when picked up: kernel in a rete-free `*Ops.ts`, node +
formula on it, parity pin, catalog keywords carrying the numpy/pandas/R names (search is how
a refugee finds it: type `cumsum`, land on Running). Node-combining rule applies — ops on the
existing family card (Aggregate, Correl, Hypothesis Test, Distribution, Bin, List Sort)
before any new card.
