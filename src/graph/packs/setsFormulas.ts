// [[C17]] shareImpl, [[C51]] formulaNaming, [[D124]] comparisonFunctions

import type { PackFormula } from "./packShared";

// TALLY returns only the counts, because the node's frame cannot cross the formula surface.
export const SETS_PACK_FORMULAS: PackFormula[] = [
  { name: "IS", arity: [2, 2], signature: "values, x" },
  { name: "ISNOT", arity: [2, 2], signature: "values, x" },
  { name: "ABOVE", arity: [2, 2], signature: "values, x" },
  { name: "BELOW", arity: [2, 2], signature: "values, x" },
  { name: "ATLEAST", arity: [2, 2], signature: "values, x" },
  { name: "ATMOST", arity: [2, 2], signature: "values, x" },
  { name: "BETWEEN", arity: [3, 3], signature: "values, low, high" },
  { name: "SETUNION", arity: [2, 2], signature: "list1, list2" },
  { name: "SETINTERSECT", arity: [2, 2], signature: "list1, list2" },
  { name: "SETDIFFERENCE", arity: [2, 2], signature: "list1, list2" },
  { name: "SETSYMDIFF", arity: [2, 2], signature: "list1, list2" },
  { name: "SETEQUAL", arity: [2, 2], signature: "list1, list2" },
  { name: "SETSUBSET", arity: [2, 2], signature: "list1, list2" },
  { name: "SETSUPERSET", arity: [2, 2], signature: "list1, list2" },
  { name: "SETDISJOINT", arity: [2, 2], signature: "list1, list2" },
  { name: "ISIN", arity: [2, 2], signature: "values, set — mask aligned to values" },
  { name: "TALLY", arity: [1, 1], signature: "values — counts per distinct value, first seen" },
];
