// Shared pack-authoring types + helpers. Each pack definition lives in its own
// file in this folder (geometry.ts, electricity.ts, …) and builds on these; the
// registry/store side stays in ../packs.ts. This split is the level-2 isolation
// direction from docs/pack-architecture.md: a pack file may import ONLY this
// module, ../rete-nodes (node classes), and type-only app seams — never core
// internals.

import type { NodeCatalogEntry, ExcelEquiv } from "../AddNodeMenu";
import type { PackUnit, PackFormat } from "../formatAnnotationStore";
import type { ResultType } from "../nodes/shared";
import { ExpressionNode, EquationNode } from "../rete-nodes";

// ─── Formula packs: the default, no-new-code pack shape ─────────────────────────
// A formula pack is pure data: a list of {label, expr} records that base Solenoid
// compiles. Each node is a pre-set Expression node — the SAME node the user could
// type by hand, with the formula and its label fixed. The variables in `expr`
// become the node's input sockets automatically (see ExpressionNode._rebuild), so
// no per-node class, component, or registry entry is needed.
//
// Because the result is a plain ExpressionNode, it serializes as one
// (type "ExpressionNode", formula in init.expr) and reloads even when the pack is
// switched off — the "a formula node is just data" guarantee in
// docs/pack-architecture.md. Reach for a real node class ONLY when a node needs
// logic the Expression compiler can't evaluate (root-finding, embedded datasets,
// list reduction, multi-output); those are the declared exceptions, not the
// common case.
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
    // `locked`: a preset's formula is fixed (the pack's promise — the node stays
    // reliable); the title stays editable.
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
  /** Extra Format Controller units this pack adds (shown while active). */
  units?: PackUnit[];
  /** Extra Format Controller number formats this pack adds (shown while active). */
  formats?: PackFormat[];
}
