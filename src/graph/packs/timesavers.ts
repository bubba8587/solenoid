// Common Excel Timesavers — Solenoid conveniences that aren't single Excel
// functions. Mostly a reclassification pack (`tags` re-homes existing core
// nodes) plus the cross-domain HYPOTENUSE claim.

import { HYPOTENUSE_ENTRY } from "./geometry";
import type { Pack } from "./packShared";

export const TIMESAVERS_PACK: Pack = {
  id: "timesavers",
  name: "Common Excel Timesavers",
  description: "Solenoid conveniences that aren't single Excel functions (rolling aggregates, weighted stats, list utilities, extended logic…). On by default; turn off to declutter.",
  builtin: true,
  defaultActive: true,
  nodes: [
    { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
  ],
  // Reclassification of EXISTING core catalog nodes into this pack. Because
  // Timesavers ships on, nothing disappears by default.
  //
  // Best-effort first pass (auto-derived: not core primitives, not Excel
  // matchers). Fundamental list ops (Range, LinSpace, Reverse, Slice, Length)
  // are intentionally left as core. Refine freely.
  tags: [
    // Rolling window aggregates — Excel does these by hand with OFFSET/ranges.
    "rolling-sum", "rolling-avg", "rolling-min",
    "rolling-max", "rolling-stdev", "rolling-median",
    // Weighted statistics — no single Excel function.
    "weighted-wavg", "weighted-wstdev", "weighted-wvar",
    // Position-of-extreme — Excel uses INDEX/MATCH.
    "arg-argmax", "arg-argmin",
    // List utilities with no direct Excel equivalent.
    "list-contains", "list-diff", "list-normalize",
    "list-shuffle", "list-interleave", "list-nthelement",
    "list-geometric", "list-fibonacci", "list-repeat",
    // List-wise text transforms (Solenoid extras).
    "text-map", "text-filter",
    // Excel ships ENCODEURL but not a decoder.
    "url-decode",
    // Extended boolean logic (Excel has AND/OR/NOT/XOR, not these).
    "logic-xnor", "logic-nand", "logic-nor",
  ],
};
