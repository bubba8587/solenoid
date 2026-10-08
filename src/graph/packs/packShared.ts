// [[B15]] leanCore, [[C76]] formulaPackDefault, [[C79]] packActivationIsPresentation
// A pack file may import only this module, its <id>Formulas.ts, ../rete-nodes and type-only app seams, never core internals;
// <id>Formulas.ts imports only rete-free kernels ([[C17]] shareImpl).

import type { NodeCatalogEntry, ExcelEquiv } from "../AddNodeMenu";
import type { PackUnit, PackFormat } from "../formatAnnotationStore";
import type { ResultType } from "../nodes/shared";
import type { ExcelReturn, ExcelRank, VectorOrient } from "../excelFunctions";
import { ExpressionNode, EquationNode } from "../rete-nodes";

interface PackFormulaBase {
  /** Dispatch name, UPPERCASE. */
  name: string;
  /** Returns a value or a `SolError`, never throws, like a core `registerInternal` impl. */
  impl: (...args: unknown[]) => unknown;
  returns: ExcelReturn;
  /** Default "scalar". */
  rank?: ExcelRank;
  arity: [number, number];
  signature?: string;
  /** An empty slot marks the unknown to solve for, so it reads as the argument left out ([[C80]] blankArgIsExcelBlank). */
  emptySlotsLeftOut?: boolean;
  /** The placeholder such a slot shows ([[D96]] emptySlotShowsItsValue); "solve" when unset. */
  emptySlotShown?: string;
}

/** A formula that takes whole lists declares whether a vector's direction matters to it ([[D85]] columnsStayColumns). */
export type PackFormula = PackFormulaBase & (
  | { listArgs?: false; orient?: undefined }
  | { listArgs: true; orient: VectorOrient }
);

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
  /** The unit each variable's number is read in; a wired value converts to it, another dimension is #UNIT!. */
  units?: Record<string, string>;
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
      ? new EquationNode({ label: e.label, expr: e.expr, locked: true, varDescriptions: e.varDescriptions, varUnits: e.units })
      : new ExpressionNode({ label: e.label, expr: e.expr, locked: true, resultAs: e.resultAs, varDescriptions: e.varDescriptions, varUnits: e.units, literals: e.literals }),
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
