# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-08-31 — the finance golden run + the 1.3 release tail)

**The bond/coupon family is real-Excel-verified** (the author ran the golden list by
hand; the last backlog "awaiting the author" item is CLOSED). The run confirmed COUP*,
ACCRINT b0/b1, ACCRINTM, VDB (fractional windows included) and MDURATION — where it
also settled the doc question: real Excel returns our 5.7356698, so Microsoft's
published 5.7355689 IS a typo. It caught **three real bugs, all fixed** in the shared
ops (nodes + formulas move together): ACCRINT basis 2 divided by the actual period
length instead of 360/freq; ODDLPRICE compounded the odd-last discount where Excel
uses SIMPLE interest (the PRICEMAT convention); ODDFPRICE sized the first coupon from
the quasi-period start instead of ISSUE — a long odd first coupon carried a full
extra period of interest (103.82 vs Excel's 98.57). Rewritten to Excel's documented
quasi-coupon form (DC/NL, A/NL per quasi period, exponents N + Nq + DSC/E). Every
confirmed value is pinned in `financeInvariants.test.ts`'s golden block. One noted
divergence (nodeExcel parity:false): Excel #NUM!s a first coupon off the maturity's
cycle; we compute.
**Release tail executed:** tsc + vitest green, `release:desktop` built clean (exe +
MSI + NSIS), the author smoked Script-on-desktop (CSP `'unsafe-eval'` holds: 42, no
refusal), Known Issues finalized in `release-notes-features.md`, and `develop` was
merged to `main` (6227956a; local main first fast-forwarded from origin — it had sat
339 commits stale since 1.1). Left to the author: push both branches, tag `v1.3.0`.
The deferral review's ratification of `out-of-scope.md` (DRAFT since July) was
presented and is still awaiting the author's word.
**Same day, second wave (author: all of it ships IN 1.3; the tag waits).**
**Minimap palette bug fixed**: RF's MiniMap recomputes node fills only when the
nodeColor callback identity changes; the callbacks keyed on light/dark alone, so a
palette switch kept stale accents — the palette store version is now a dep
(FlowSurface). **Function Reference reworked** (author asks): the structurally-empty
To-do tier is deleted; gap rows now partition two-way into **Superseded** (VLOOKUP
family, MATCH, SUMIF, the D* dozen, and — second author ruling, the Composable tier
retired — SUBTOTAL/AGGREGATE/CEILING.PRECISE/FLOOR.PRECISE/ISO.CEILING, all five
newly LEGACY_ALIASES-blocked with live redirects) and **Out of scope**;
`functionReferenceLibs.test.ts` pins the partition and that superseded ⇒ blocked.
The two chip rows collapsed to two dropdowns (Category with a By-pack optgroup
filtering on membership; Library) and light mode got real contrast: the panel's
semantic colors are `--fr-*` custom props with a light re-tune (was dark-tuned
hexes and border-strong-as-text). **The analytics shelf split into two
off-by-default packs**: Scientific Computing (Spectrum, Smooth, Find Peaks, Convolve,
ODE Integrate, Solve, Eigen, Polynomial Roots, Fit Distribution, Decompose) and Data
Science (K-Means, PCA, Logistic Regression, the five nonparametric tests). Everything
Excel-named and the mainstream tests stay core. First cut used tags (cross-woven);
the author then ruled the Add menu must show what a pack added, so the 18 leaves
moved out of nodeCatalog into real placements under Packs › <name> (type strings/
labels/descriptions verbatim — saves, ops, formula dispatch, parity suites all hold;
frameSurfaceNames' ghost check widened to the whole tree for the pack-homed frame
verbs). **Docked Inspector + Report tuck under the header now** (z 90 → 5, the heavy
side shadow deleted — a dock pushes the canvas, nothing sits beneath it;
layout-chrome.md reconciled). **Settings packs are an accordion** now: `Pack.group`
(Everyday / Analysis / Science & Engineering), details/summary per group with an
on-count, descriptions on the rows. What's-New slide + release-notes follow.
**Third wave.** **Add-menu search scores per query word with one-edit typo tolerance**
(author: "frane input" surfaced nothing — it ranked 19th under description noise):
each word lands as a haystack subsequence or within one Damerau-Levenshtein edit of
a leaf word; word order free; pinned in `catalogSearch.test.ts` + new `fuzzy.test.ts`
(subsystem-invariants § Add menu reconciled). **Add-menu leaves reordered
significance-first** within Output / Visuals / Tables & Frames / Lists / Logic /
Text / Date & Time — pure reorder of `nodeCatalog.ts`, no entries changed.
**Attribution shipped**: THIRD-PARTY-NOTICES.md gains React Flow (MIT text, watermark
stays on) + a bundled-libraries section naming the non-MIT ones (elkjs, dompurify,
OFL fonts); README License line credits React Flow / Rete.js / Polars. README
rewritten by the author; factual audit delivered in-session (verbs are frame-only,
Cube isn't "3D", Record outputs on the chart socket rather than "renders as a
Chart", logical↔number is a deliberate bridge) — copy fixes are the author's.
