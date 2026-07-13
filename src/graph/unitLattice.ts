// ─── Unit lattice — the dimensional separation contract (Bundle 05: FC A4, step 7) ─
// Units are the FINER-GRAINED sibling of the element-family socket separation. The
// element lattice (sockets.ts) enforces TYPE separation statically at connect time —
// a number never auto-crosses to a string. Units can't be enforced there: a value's
// DIMENSION is a runtime property (a `numlist` cable carries metre cells or second
// cells indistinguishably), so the socket `accepts()` layer stays unit-blind and the
// separation is enforced at COMPUTE time instead — the same place the element
// families' `#TYPE!` lives, one rung finer as `#UNIT!`.
//
// This module states that contract as a small predicate set, machine-checked by the
// full sweep in unitLattice.test.ts (the socketConnect.test.ts analog for units):
//
//   • ×, ÷      — ALWAYS combine (add / subtract exponents). Never a unit error;
//                 this is the "dimensional flow" half (a length ÷ a time IS a speed).
//   • +, −, compare, aggregate — require the SAME dimension, else `#UNIT!`. This is
//                 the "type separation" half (metres + seconds is meaningless).
//   • dimensionless is UNIVERSAL for the multiplicative ops and the IDENTITY the
//                 additive ops still separate against (a bare number + a length is a
//                 `#UNIT!`, exactly like a string + a number is a `#TYPE!`).
//
// The predicates below are the single source of truth the algebra (unitValue.ts) and
// the sweep both reference, so the contract can't drift from the implementation.

import { type Dim, dimEqual, isDimensionless } from "./dimension";

/** Do two dimensions combine freely under ×/÷ ? Always — the multiplicative ops are
 *  total over the dimension lattice (the result is a new, possibly-derived dim). */
export function dimensionsMultiply(_a: Dim, _b: Dim): boolean {
  return true;
}

/** Do two dimensions combine under +/−/compare ? When EQUAL, or when either is
 *  DIMENSIONLESS — a bare number adopts the other's unit (`$5 + 2 = $7`, author
 *  decision 2026-07-13). Two genuinely different real dimensions still separate
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
