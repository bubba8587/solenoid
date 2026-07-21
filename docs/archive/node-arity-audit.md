# Node arity audit — verdicts (anti-relapse record)

The variadic upgrades shipped (IFS/SWITCH/CHOOSE extensible rows, the
LogicalNode → BooleanOpNode + IfNode split). The governing labeled-slots-vs-list
rule lives in `node-coverage.md` + CLAUDE.md. What remains here is the verdict
record so a later pass doesn't re-litigate the KEEPs.

## Explicitly KEPT as-is (do not "fix")

- **All single-list aggregators** (SUM/AVERAGE/MIN/MAX/PRODUCT/…): one list
  socket is correct by design — elements are interchangeable.
- **`GcdNode` (GCD/LCM), 2 list-aware inputs**: it broadcasts element-wise
  (`gcd([12,18],[8,12]) → [4,6]`). Excel's variadic `GCD(a,b,c,…)` reduces N
  scalars — a different operation. A true N-ary GCD/LCM would be an Aggregate
  op (one list in, scalar out), not an extra socket.
- **`SumProductNode` (2 lists)**: 2 is the overwhelming case; low value.
- **`IFERROR`/`IFNA`, `Comparison`, `Range`, `RollingNode`**: fixed arity is
  correct (not variadic in Excel, or the extra args are already list-shaped).

## The litmus test (duplicated from node-coverage for grep-ability)

Labeled, individually-wireable scalar rows when each input plays a DISTINCT
role (positional or paired — CHOOSE/IFS/SWITCH); a single list socket only when
elements are interchangeable (SUM). If explaining the list would require "the
2nd element means X," it should be labeled slots.
