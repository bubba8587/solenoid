// Shared pack-authoring types + helpers. A pack file may import ONLY this module,
// ../rete-nodes, and type-only app seams — never core internals.

import type { NodeCatalogEntry, ExcelEquiv } from "../AddNodeMenu";
import type { PackUnit, PackFormat } from "../formatAnnotationStore";
import type { ResultType } from "../nodes/shared";
import type { ExcelReturn, ExcelRank } from "../excelFunctions";
import { ExpressionNode, EquationNode } from "../rete-nodes";

// The ONE core error seam packs may reach, re-exported so pack files stay inside
// the import rule.
export { solError, isSolError } from "../errorValue";
export type { SolError } from "../errorValue";

// A declared function is callable inside any Expression/LAMBDA. Names follow the
// formulaNaming rule (bare, spaces removed; Excel-named ops keep their Excel name), and
// `formulaExtensions.ts` fails loudly rather than shadowing a core name.
export interface PackFormula {
  /** Dispatch name, UPPERCASE. */
  name: string;
  /** The implementation. Same contract as a core `registerInternal` impl:
   *  return a value, or a `SolError` for a domain failure — never throw. */
  impl: (...args: unknown[]) => unknown;
  returns: ExcelReturn;
  /** Output rank (default "scalar"), mirrored into `EXCEL_IMPL_META.rank` so the
   *  result types like any core list/matrix native. */
  rank?: ExcelRank;
  /** Takes whole LISTS as arguments — the evaluator hands vectors over intact
   *  instead of broadcasting the call. */
  listArgs?: boolean;
  /** [min, max] argument count, for the editor's hint. */
  arity: [number, number];
  /** Curated argument hint ("radius, height"); falls back to a bare count. */
  signature?: string;
}

// A formula pack is pure data compiled into pre-set Expression nodes, so a preset
// serializes as a plain ExpressionNode and reloads even with the pack switched off.
// Reach for a real node class only when the Expression compiler can't do the job.
export interface FormulaPackEntry {
  type: string;          // unique catalog id, prefixed by pack ("geo-circle-area")
  label: string;
  description: string;
  expr: string;          // compiled by the core formula engine; vars → input sockets
  /** A locked EQUATION rather than a directional Expression: every variable is both
   *  input and output, so one preset replaces several solved forms. Numeric only —
   *  `resultAs` doesn't apply. */
  equation?: boolean;
  /** Result element type when the formula yields text/date (default number). */
  resultAs?: ResultType;
  /** Excel function(s) the preset stands in for (most pack formulas have none). */
  excel?: ExcelEquiv[];
  /** Extra Add-menu search synonyms (space-separated, never displayed). */
  keywords?: string;
  /** Per-variable prose for the hover tooltip + formula-popup legend; display-only. */
  varDescriptions?: Record<string, string>;
}

export function formulaNode(e: FormulaPackEntry): NodeCatalogEntry {
  return {
    type: e.type,
    label: e.label,
    description: e.description,
    excel: e.excel,
    keywords: e.keywords,
    // No `accent`: the Add-menu highlight is reserved for key nodes, not presets.
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
  /** Settings accordion group ("Everyday", "Analysis", "Science & Engineering"). */
  group?: string;
  /** Nodes this pack inserts into the Add-menu tree while active. */
  nodes?: PackPlacement[];
  /** Other pack ids this pack needs — activating it activates them too. */
  dependsOn?: string[];
  /** EXISTING catalog types this pack CLAIMS — hidden when all their claiming packs
   *  are off. Unlike `nodes`, these add no new entries. */
  tags?: string[];
  /** Formula functions this pack adds: registered for RESOLUTION always, advertised
   *  only while active. */
  formulas?: PackFormula[];
  /** Extra Format Controller units this pack adds (shown while active). */
  units?: PackUnit[];
  /** Extra Format Controller number formats this pack adds (shown while active). */
  formats?: PackFormat[];
}
