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

## Tier 1 — common, no honest composition today, cheap-to-moderate

1. **Window functions by group** (`groupby().transform` / `cumsum`-`lag`-`rank`-`row_number`
   `.over(partition)` / dplyr `group_by %>% mutate`, SQL `OVER (PARTITION BY … ORDER BY …)`).
   A frame verb: partition columns, order column, function (running sum/avg/min/max/count,
   lag/lead, rank/dense rank/row number, percent of group, cumulative share). Polars `.over`
   natively; JS oracle in `frameVerbs.ts`; cargo parity corpus. THE pandas staple with no
   Solenoid answer — Group By collapses rows, Running is list-only. Moderate.
2. **Describe / Summary** (`df.describe()`, R `summary()`): per numeric column count / mean /
   std / min / 25 / 50 / 75 / max (+ null count, distinct); text columns count / distinct /
   top. One verb → a frame. Composable only by a dozen Group-By-less aggregates. Cheap.
3. **Correlation / covariance MATRIX** (`df.corr()`, `cor(df)`): frame → symmetric matrix
   (Pearson; Spearman as a mode). Pairwise CORREL exists only. Cheap on `statsOps.pearson`.
4. **Spearman & Kendall correlation** (`spearmanr`, `cor(method=)`): rank both + pearson;
   Kendall τ-b O(n²). Add as ops on the Correl node (CORREL / RSQ / SPEARMAN / KENDALL). Cheap.
5. **More one-liners on Aggregate** (pandas/R basics missing from the 21 ops): `range`, `IQR`,
   `MAD` (median absolute deviation), `sem` (std error), `cv` (coefficient of variation),
   `rms`, `mode` (the Mode node exists; an op is the discoverable place), `nunique` exists
   (countdistinct), `first`/`last`. Trivial each; every one a `statsOps.aggregate` case.
6. **Quantile bins** (`pd.qcut`, `dplyr::ntile`): Bin has breakpoints only; a "by quantiles
   (n)" mode returns the n-tile index. Cheap.
7. **Outliers** (`scipy.stats.zscore > 3`, IQR 1.5 rule, `boxplot.stats$out`): one node,
   method toggle (z / IQR / MAD), output = flags or the cleaned list. Data-quality magnet,
   sits beside Expect. Cheap.
8. **Fuzzy match / string distance** (`rapidfuzz`, `stringdist`, R `agrep`, Excel's Fuzzy
   Lookup add-in): Levenshtein / Damerau / Jaro-Winkler similarity node, and a **fuzzy
   XLOOKUP mode** (best match above a threshold). Data-cleaning users live on this; no
   composition exists. Cheap kernel, moderate node wiring (lookup mode).
9. **Unix epoch ↔ date serial** (`pd.to_datetime(unit="s")`, `as.POSIXct(origin=)`): every
   API/CSV import carries epoch seconds/ms; today it's hand arithmetic with a magic constant.
   A Convert-like "Epoch" node (s / ms, both directions). Trivial.
10. **Date truncation / period bucketing** (`floor_date`, `dt.to_period`, `resample("M")`):
    truncate a date to day/week(Mon|Sun)/month/quarter/year (+ ceiling), and its twin "date
    sequence / complete" (`seq.Date`, `asfreq`, tidyr `complete`) to fill missing periods so
    a Group By becomes a resample. Cheap; Add-Months family is the home.
11. **Holt-Winters / ETS forecasting** (`statsmodels ExponentialSmoothing`, R `HoltWinters`/
    `forecast::ets`, AND Excel's `FORECAST.ETS` family — an Excel-parity gap too):
    additive trend + seasonality, seasonality detection (ETS.SEASONALITY), prediction
    interval (ETS.CONFINT). Moderate (~200 lines incl. a small grid/Nelder-Mead on α/β/γ).
12. **Amortization schedule** (numpy_financial loop / R `amort.table`): period, payment,
    interest, principal, balance → a frame, from the IPMT/PPMT kernels already here. Every
    loan spreadsheet rebuilds it. Cheap.
13. **FFT / spectrum** (`numpy.fft.rfft`, R `fft`, `spectrum`): list → frame of frequency /
    magnitude / phase (+ inverse). Mixed-radix or Bluestein so length is free. The
    engineering users' single biggest "can't do that here". Moderate (~150 lines).
14. **Solve linear system / eigen (symmetric) / trace / rank / norm** (`np.linalg.solve`,
    `eigh`, `trace`, `matrix_rank`, `norm`): solve = the Gaussian kernel already in listOps;
    eigh = Jacobi rotation (~60 lines); trace/rank/norm trivial. One "Matrix" op node or
    four small leaves beside MINVERSE. Cheap–moderate.
15. **Haversine distance** (`geopy`, R `geosphere::distHaversine`): lat/lon pairs → km/mi,
    broadcasting; with the Geometry pack's Distance nodes. Trivial; very common in business data.
16. **Cohort-style tests users actually reach for**: one-way **ANOVA** (F p-value — `fCDF`
    is here), **Mann-Whitney U / Wilcoxon signed-rank / Kruskal-Wallis** (rank sums +
    normal/chisq approximations — kernels here), **Fisher exact** (hypgeom PMF is here),
    **proportion z-test / binomial test**, **KS** (one/two sample), **Shapiro-Wilk** (skip;
    D'Agostino-Pearson instead). All as ops on the ONE Hypothesis Test node (nodeCombiningRound1
    precedent). Cheap each.

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
