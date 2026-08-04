// Unit lattice — dimensional separation is enforced at COMPUTE time as `#UNIT!`
// (socket `accepts()` stays unit-blind); these predicates are its single source of truth.

import { type Dim, dimEqual, isDimensionless } from "./dimension";

/** Always true — ×/÷ are total over the dimension lattice (the result is a derived dim). */
export function dimensionsMultiply(_a: Dim, _b: Dim): boolean {
  return true;
}

/** The +/−/compare contract only: equal or either-dimensionless combines, else `#UNIT!`.
 *  Aggregation is STRICTER (a mixed-dim list is `#UNIT!`) — see `forAggregateUnits`. */
export function dimensionsAdd(a: Dim, b: Dim): boolean {
  return dimEqual(a, b) || isDimensionless(a) || isDimensionless(b);
}

/** The universal (dimensionless) element — combines with anything under every op. */
export function isUniversalDim(a: Dim): boolean {
  return isDimensionless(a);
}
