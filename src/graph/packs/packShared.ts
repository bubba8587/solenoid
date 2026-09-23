// [[B15]] leanCore, [[C76]] formulaPackDefault, [[C79]] packActivationIsPresentation
// A pack file may import only this module, its <id>Formulas.ts, ../rete-nodes and type-only app seams, never core internals;
// <id>Formulas.ts imports only rete-free kernels ([[D19]] implReteFree).

import type { NodeCatalogEntry, ExcelEquiv } from "../AddNodeMenu";
import type { PackUnit, PackFormat } from "../formatAnnotationStore";
import type { ResultType } from "../nodes/shared";
import type { ExcelReturn, ExcelRank } from "../excelFunctions";
import { ExpressionNode, EquationNode } from "../rete-nodes";

export interface PackFormula {
  /** Dispatch name, UPPERCASE. */
  name: string;
  /** Returns a value or a `SolError`, never throws, like a core `registerInternal` impl. */
  impl: (...args: unknown[]) => unknown;
  returns: ExcelReturn;
  /** Default "scalar". */
  rank?: ExcelRank;
  /** The evaluator hands whole lists over instead of broadcasting the call. */
  listArgs?: boolean;
  arity: [number, number];
  signature?: string;
}

export interface FormulaPackEntry {
  type: string;          // prefixed by pack: "geo-circle-area"
  label: string;
  description: string;
  expr: string;
  /** A locked Equation instead of an Expression; numeric only, so `resultAs` does not apply. */
  equation?: boolean;
  resultAs?: ResultType;
  excel?: ExcelEquiv[];
  /** Space-separated search synonyms, never displayed. */
  keywords?: string;
  varDescriptions?: Record<string, string>;
  /** Seeded literals; an unseeded variable defaults to 0. */
  literals?: Record<string, number>;
}

export function formulaNode(e: FormulaPackEntry): NodeCatalogEntry {
  return {
    type: e.type,
    label: e.label,
    description: e.description,
    excel: e.excel,
    keywords: e.keywords,
    // No `accent`: the Add-menu highlight is reserved for key nodes.
    create: () => e.equation
      ? new EquationNode({ label: e.label, expr: e.expr, locked: true, varDescriptions: e.varDescriptions })
      : new ExpressionNode({ label: e.label, expr: e.expr, locked: true, resultAs: e.resultAs, varDescriptions: e.varDescriptions, literals: e.literals }),
  };
}

export function placeFormulas(path: string[], entries: FormulaPackEntry[]): PackPlacement[] {
  return entries.map((e) => ({ path, entry: formulaNode(e) }));
}

export interface PackPlacement {
  /** Category labels to insert under, created if missing; empty means "Docs & Files". */
  path?: string[];
  entry: NodeCatalogEntry;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  defaultActive: boolean;
  group?: string;
  nodes?: PackPlacement[];
  /** Activating this pack activates these too. */
  dependsOn?: string[];
  /** Existing catalog types this pack claims, hidden when every claiming pack is off. */
  tags?: string[];
  /** Always registered for resolution, advertised only while active. */
  formulas?: PackFormula[];
  units?: PackUnit[];
  formats?: PackFormat[];
}
