// [[C25]] firstClassUnits. Units separate at compute time as `#UNIT!`; socket `accepts()` stays unit-blind.

import { type Dim, dimEqual, isDimensionless } from "./dimension";

/** The +, − and compare contract. Aggregation is stricter: a mixed-dimension list is `#UNIT!` (`forAggregateUnits`). */
export function dimensionsAdd(a: Dim, b: Dim): boolean {
  return dimEqual(a, b) || isDimensionless(a) || isDimensionless(b);
}

export function isUniversalDim(a: Dim): boolean {
  return isDimensionless(a);
}
