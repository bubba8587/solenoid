// [[B15]] leanCore, [[C76]] formulaPackDefault, [[C79]] packActivationIsPresentation
// A pack file may import only this module, its <id>Formulas.ts, ../nodeClasses and type-only app seams, never core internals;
// <id>Formulas.ts imports only graph-free kernels ([[C17]] shareImpl).

import type { NodeCatalogEntry, ExcelEquiv } from "../AddNodeMenu";
import { PHYS_CONSTANTS, type PhysConstOp } from "../nodes/physicsConstantsOps";
import type { PackUnit, PackFormat } from "../formatAnnotationStore";
import { ExpressionNode, EquationNode, PhysicsConstantNode } from "../nodeClasses";
import { indentFormula } from "../formulaLayout";

/** A pack's formula function: the core carries its body (`fns_packs.rs`); the pack declares how the editor shows it. */
export interface PackFormula {
  /** Dispatch name, UPPERCASE. */
  name: string;
  arity: [number, number];
  signature?: string;
  /** An empty slot marks the unknown to solve for, so it reads as the argument left out ([[C80]] blankArgIsExcelBlank). */
  emptySlotsLeftOut?: boolean;
  /** The placeholder such a slot shows ([[D96]] emptySlotShowsItsValue); "solve" when unset. */
  emptySlotShown?: string;
}

export interface FormulaPackEntry {
  type: string;          // prefixed by pack: "geo-circle-area"
  label: string;
  description: string;
  expr: string;
  /** A locked Equation instead of an Expression. */
  equation?: boolean;
  excel?: ExcelEquiv[];
  /** Space-separated search synonyms, never displayed. */
  keywords?: string;
  varDescriptions?: Record<string, string>;
  /** The unit each variable's number is read in; a wired value converts to it, another dimension is #UNIT!. */
  units?: Record<string, string>;
  /** Seeded literals; an unseeded variable defaults to 0. */
  literals?: Record<string, number>;
  /** Variables that are physical constants: placing the card places a Physics Constant cabled into each. An
   *  Expression also keys the value as the variable's literal, so it still computes with the cable cut. */
  constants?: Record<string, PhysConstOp>;
}

export function formulaNode(e: FormulaPackEntry): NodeCatalogEntry {
  const consts = Object.entries(e.constants ?? {});
  // Laid out by its parentheses, as Shift+Alt+F would in the editor.
  const expr = indentFormula(e.expr);
  const literals = consts.length ? { ...Object.fromEntries(consts.map(([v, op]) => [v, PHYS_CONSTANTS[op].value])), ...e.literals } : e.literals;
  const descriptions = consts.length
    ? { ...Object.fromEntries(consts.map(([v, op]) => [v, `${PHYS_CONSTANTS[op].label} (${PHYS_CONSTANTS[op].unit})`])), ...e.varDescriptions }
    : e.varDescriptions;
  return {
    type: e.type,
    label: e.label,
    description: e.description,
    excel: e.excel,
    keywords: e.keywords,
    // No `accent`: the Add-menu highlight is reserved for key nodes.
    create: () => e.equation
      ? new EquationNode({ label: e.label, expr, locked: true, varDescriptions: descriptions, varUnits: e.units })
      : new ExpressionNode({ label: e.label, expr, locked: true, varDescriptions: descriptions, varUnits: e.units, literals }),
    companions: consts.length
      ? () => consts.map(([input, op]) => ({ node: new PhysicsConstantNode({ op }), output: "value", input }))
      : undefined,
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
  /** The pack's example seed graph (`seedGraphs/packs/<seed>.json`), offered in the seed menus while the pack is on. */
  seed: string;
}
