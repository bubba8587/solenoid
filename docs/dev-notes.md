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
