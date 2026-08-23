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
running / rank / lag / share columns — JS-eager; the Polars `.over()` mirror is the open
follow-up in backlog B5). Reference overlay chips (numpy / pandas / scipy / R / SQL / Excel)
let a refugee filter to what they know. Tests: `pythonRGap.test.ts`, `statsParity.test.ts`,
`distributionFormula.test.ts`, `dateParity.test.ts`, `functionReferenceLibs.test.ts`.

## Tier 2 — valuable, moderate cost or narrower audience

17. **Text template / glue** (`str_glue`, f-strings, `sprintf`): "Hello {name}, total {total:0.00}"
    over a frame → a text column / list. Report does documents; there's no per-row string
    builder. Cheap.
18. **Text pad / truncate / wrap / unaccent / slugify** (`str_pad`, `str_trunc`, `str_wrap`,
    `unidecode`, `janitor::make_clean_names`): a few Transform leaves; unaccent is the
    join-key cleaner people need. Trivial.
19. **Positions where** (`np.flatnonzero`, `which`, `argsort`/`order`): List Filter keeps
    values, not positions; ARGMAX is a single index. A "positions" output on List Filter and
    an "order (argsort)" op on List Sort. Cheap.
20. **Weighted random choice / sample** (`np.random.choice(p=)`, `sample(prob=)`, `rnorm` N
    draws): a "Sample" op on the Distribution node (N draws, seeded per recalc like RAND) and
    a weighted pick on Shuffle/Take. Cheap; the Monte Carlo run mode has its own sampler.
21. **Savitzky–Golay / LOWESS smoothing, peak finding** (`savgol_filter`, `lowess`,
    `find_peaks`): signal users; SG is a convolution with computed coefficients (cheap),
    LOWESS moderate, find_peaks (prominence/distance) cheap.
22. **Drawdown / Sharpe / rolling volatility / log returns** (quant one-liners): ops on a
    "Returns" node; all compose today from Running + LN but nobody knows the recipe. Cheap.
23. **Seasonal decomposition** (`seasonal_decompose`, R `decompose`/`stl`): trend (moving
    average) / seasonal / residual frames. Moderate; pairs with Holt-Winters.
24. **Distribution fitting** (`scipy.stats.fit`, `fitdistrplus`) — already queued (backlog B2).
25. **Logistic regression** (`LogisticRegression`, `glm(binomial)`): IRLS on the existing
    linear-algebra kernels; the LINEST sibling. Moderate.
26. **K-means (1-D/2-D) and PCA** (`KMeans`, `prcomp`): k-means trivial; PCA = eigh of the
    covariance matrix (item 14). Moderate; "data science" edge of the audience.
27. **ODE integrate** (`solve_ivp`, `deSolve`): dy/dt = Expression(t, y) → RK4 frame over a
    range. The simulation run mode is the discrete sibling. Moderate.
28. **Roots of a polynomial / general root find** (`np.roots`, `uniroot`, `fsolve`):
    Quadratic Roots exists; a Durand–Kerner polynomial roots node is cheap; `uniroot` is the
    Equation node.
29. **Cross join / cartesian product** (`merge(how="cross")`, `expand.grid`): a Join `how`.
    Trivial once the engine exposes it (Polars has it).
30. **Bind columns / zip frames side by side** (`bind_cols`, `pd.concat(axis=1)`): HSTACK is
    matrices; a frame-level column bind by position. Cheap.
31. **Histogram 2-D / heatmap binning** (`histogram2d`, `hexbin`): scatter → counts grid for
    the Heatmap figure. Cheap.
32. **Hash / UUID / anonymize** (`hashlib`, `uuid`, `digest`): hash a column for joins
    without PII. Sync hash needs a small lib (or FNV/xxhash inline). Cheap, niche-but-sticky.

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
