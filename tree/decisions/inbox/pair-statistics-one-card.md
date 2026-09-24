---
title: "CORREL, COVARIANCE and the regression statistics merge into one card"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[B11]]"]
---
## Decision

`CorrelNode` (CORREL, RSQ, SPEARMAN, KENDALL), `CovarianceNode` (COVARIANCE.P, COVARIANCE.S) and `RegressionNode` (SLOPE, INTERCEPT, STEYX) become one card with nine ops. The leaf types stay, so `NODE_EXCEL` and the Function Reference don't move. The X and Y rows keep their keys, so an op switch keeps both cables. Only the row labels follow the op: the regression ops keep Excel's Known Ys before Known Xs order.

Smaller candidates found in the same sweep, each a sibling pair with identical sockets:

- **FIXED and DOLLAR** (number, decimals to text): one card, with a currency op beside the no-commas toggle.
- **REDUCE and SCAN** (initial, table, lambda): SCAN is REDUCE that returns every step. One card with a Final / Every step toggle, the way Running folds its window.
- **Append and Bind Columns**: node-coverage calls Bind Columns "Append's positional sibling". One card with By name (rows) / By position (columns), matching VSTACK / HSTACK.
- **Web Source, Import HTML and Import XML**: three URL fetchers. One card with a format op (auto CSV/JSON, HTML table, XPath). The ops own the Table and XPath rows.
- **Group Lists**: keys and values as parallel list sockets, which the aligned-columns rule forbids. Retire it for GROUPBY behind Frame from Lists, or keep it as the 1-D fast path.

## Why

All three cards read two paired lists through `forPair`, apply the same pair policy and return one number. They differ only in the kernel, which is what [[B11]] maximalMerge says an op is. Nothing differs in value: every op keeps its own formula name and answer.

**Owner's call:** merge the pair statistics now, and which of the smaller candidates to take (Group Lists is the one where retiring and keeping both have a case).

## What ratifying means

- **Ratify the main merge:** the Add menu shows one pair-statistics card where there are three now. Picking CORREL, SLOPE or COVARIANCE.S is an op switch on it, cables stay attached, and every formula name and answer is unchanged. Saves with the old three cards break (pre-alpha).
- **The smaller pairs** are separate yes/no answers. You can take any subset.
- **Lean:** ratify the main merge; of the smaller ones, REDUCE/SCAN and Append/Bind Columns are the clearest; keep Group Lists as the 1-D fast path.
