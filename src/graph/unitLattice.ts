// Unit lattice — the dimensional separation contract. The socket `accepts()` layer
// stays unit-blind (a value's DIMENSION is a runtime property), so the separation is
// enforced at COMPUTE time as `#UNIT!`. The predicates below are the single source of
// truth the algebra (unitValue.ts) and the unitLattice.test.ts sweep both reference,
// so the contract can't drift from the implementation.

import { type Dim, dimEqual, isDimensionless } from "./dimension";

/** Do two dimensions combine freely under ×/÷ ? Always — the multiplicative ops are
 *  total over the dimension lattice (the result is a new, possibly-derived dim). */
export function dimensionsMultiply(_a: Dim, _b: Dim): boolean {
  return true;
}

/** Do two dimensions combine under +/−/compare ? When EQUAL, or when either is
 *  DIMENSIONLESS — a bare number adopts the other's unit (`$5 + 2 = $7`).
 *  Two genuinely different real dimensions still separate
 *  (→ `#UNIT!`). NOTE: aggregation stays STRICTER (a mixed-dim list is `#UNIT!`) —
 *  see `forAggregateUnits`; this helper is the +/−/compare contract only. */
export function dimensionsAdd(a: Dim, b: Dim): boolean {
  return dimEqual(a, b) || isDimensionless(a) || isDimensionless(b);
}

/** Is a dimension the universal (dimensionless) element — freely multiplicative with
 *  anything, and the additive identity that still separates against a real unit? */
export function isUniversalDim(a: Dim): boolean {
  return isDimensionless(a);
}
