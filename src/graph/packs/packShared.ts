// Shared pack-authoring types + helpers. Each pack definition lives in its own
// file in this folder (geometry.ts, electricity.ts, …) and builds on these; the
// registry/store side stays in ../packs.ts. This split is the level-2 isolation
// direction from docs/pack-architecture.md: a pack file may import ONLY this
// module, ../rete-nodes (node classes), and type-only app seams — never core
// internals.

import type { NodeCatalogEntry, ExcelEquiv } from "../AddNodeMenu";
import type { PackUnit, PackFormat } from "../formatAnnotationStore";
import type { ResultType } from "../nodes/shared";
import type { ExcelReturn, ExcelRank } from "../excelFunctions";
import { ExpressionNode, EquationNode } from "../rete-nodes";

// The ONE core error seam packs may reach: a custom-logic formula impl mints a
// domain failure with this (never throws) — re-exported here so pack files
// stay inside the import rule (packShared / ../rete-nodes / type-only seams).
export { solError, isSolError } from "../errorValue";
export type { SolError } from "../errorValue";

// ─── Pack-contributed formula functions (D19 decision 4) ─────────────────────
// A pack ships its node surface and its FORMULA surface together: declare a
// function here and it becomes callable inside any Expression/LAMBDA, exactly
// like a built-in.
//
// Naming follows the D19 rule for Solenoid-native functions — bare, unified with
// the node's hover hint, spaces removed. Excel-named ops keep their Excel name.
// A pack must not claim a name the core already registers; `formulaExtensions.ts`
// fails loudly on a collision rather than letting one surface silently shadow
// the other.
export interface PackFormula {
  /** Dispatch name, UPPERCASE. */
  name: string;
  /** The implementation. Same contract as a core `registerInternal` impl:
   *  return a value, or a `SolError` for a domain failure — never throw. */
  impl: (...args: unknown[]) => unknown;
  returns: ExcelReturn;
  /** Output rank (default "scalar"): "list"/"matrix" for functions returning a
   *  1-D/2-D value, mirrored into `EXCEL_IMPL_META.rank` so the evaluator and
   *  socket typing treat the result like any core list/matrix native. */
  rank?: ExcelRank;
  /** The function takes whole LISTS as arguments (position-preserving, carries
   *  cell errors in place) — mirrored into `EXCEL_IMPL_META.listArgs` so the
   *  evaluator hands vectors over intact instead of broadcasting the call. */
  listArgs?: boolean;
  /** [min, max] argument count, for the editor's hint. */
  arity: [number, number];
  /** Curated argument hint ("radius, height"); falls back to a bare count. */
  signature?: string;
}

// ─── Formula packs: the default, no-new-code pack shape ─────────────────────────
// A formula pack is pure data: {label, expr} records compiled into pre-set
// Expression nodes, whose variables become input sockets automatically.
//
// Because the result is a plain ExpressionNode, it serializes as one and reloads
// even when the pack is switched off — the "a formula node is just data"
// guarantee in docs/pack-architecture.md. Reach for a real node class ONLY when a
// node needs logic the Expression compiler can't evaluate.
export interface FormulaPackEntry {
  type: string;          // unique catalog id (prefix by pack, e.g. "geo-circle-area")
  label: string;         // node title
  description: string;   // hover text — show the formula, Excel-style where it helps
  expr: string;          // compiled by the core formula engine; vars → input sockets
  /** The preset is a locked EQUATION ("v = i * r") rather than a directional
   *  Expression: every variable is an input AND an output, the node solves for
   *  whichever is left unknown (or truth-checks when all are known). Use for a
   *  relation the pack would otherwise ship as several solved forms — the Ohm's
   *  law trio is ONE equation preset. `resultAs` doesn't apply (numeric only). */
  equation?: boolean;
  /** Result element type when the formula yields text/date (default number). */
  resultAs?: ResultType;
  /** Excel function(s) the preset stands in for (most pack formulas have none). */
  excel?: ExcelEquiv[];
  /** Extra Add-menu search synonyms (space-separated, never displayed). */
  keywords?: string;
  /** Optional prose explaining each variable (var name → description) — the
   *  card hover tooltip + the formula-popup legend. Display-only; kept out of
   *  the formula string. */
  varDescriptions?: Record<string, string>;
}

export function formulaNode(e: FormulaPackEntry): NodeCatalogEntry {
  return {
    type: e.type,
    label: e.label,
    description: e.description,
    excel: e.excel,
    keywords: e.keywords,
    // No `accent`: the Add-menu highlight is reserved for key nodes (Number, List,
    // the core Expression node…), not these presets.
    create: () => e.equation
      ? new EquationNode({ label: e.label, expr: e.expr, locked: true, varDescriptions: e.varDescriptions })
      : new ExpressionNode({ label: e.label, expr: e.expr, locked: true, resultAs: e.resultAs, varDescriptions: e.varDescriptions }),
  };
}

/** Map formula entries to placements under one category path. */
export function placeFormulas(path: string[], entries: FormulaPackEntry[]): PackPlacement[] {
  return entries.map((e) => ({ path, entry: formulaNode(e) }));
}

// A pack node + where it lands in the core category tree. `path` is the chain of
// category labels to insert under (created if missing); omitted/empty → "Other".
export interface PackPlacement {
  path?: string[];
  entry: NodeCatalogEntry;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  /** Whether the pack starts active the first time it's seen. */
  defaultActive: boolean;
  /** Nodes this pack inserts into the Add-menu tree while active. */
  nodes?: PackPlacement[];
  /** Other pack ids this pack needs — activating it activates them too. */
  dependsOn?: string[];
  /** EXISTING core catalog node types this pack claims (reclassification): the
   *  catalog builder marks them with the pack indicator and hides them when all
   *  their claiming packs are off. Unlike `nodes`, these add no new entries. */
  tags?: string[];
  /** Formula functions this pack adds to Expression/LAMBDA (D19 decision 4).
   *  Registered for RESOLUTION always, advertised only while active — see
   *  `formulaExtensions.ts`. */
  formulas?: PackFormula[];
  /** Extra Format Controller units this pack adds (shown while active). */
  units?: PackUnit[];
  /** Extra Format Controller number formats this pack adds (shown while active). */
  formats?: PackFormat[];
}
