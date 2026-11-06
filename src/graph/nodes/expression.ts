import { GraphNode } from "../graphModel";
import { anyDataIn, resultOut, type CastTo } from "./shared";
import { extractVariables } from "../excelFormula";
import { nodeOnCore } from "../nodeOnCore";

export class ExpressionNode extends GraphNode {
  unitAware = true;
  label: string;
  expr: string;
  locked: boolean;
  /** The InlineCast's pick on the result ([[D113]] inlineCast). */
  castTo: CastTo;
  cachedResult: unknown = null;
  cachedError: string | null = null;
  literals: Record<string, number> = {};
  width  = 220;
  height = 210;

  varNames: string[]  = [];
  varDescriptions: Record<string, string> = {};
  /** A preset's input units: the formula reads that variable's number in this unit ([[C25]] firstClassUnits). */
  varUnits: Record<string, string> = {};
  /** Variables with no default: unwired and untyped, the card answers #SYNTAX! naming it (a preset's physical constants). */
  varRequired: string[] = [];

  constructor(init?: { label?: string; expr?: string; locked?: boolean; castTo?: CastTo; literals?: Record<string, number>; varDescriptions?: Record<string, string>; varUnits?: Record<string, string>; varRequired?: string[] }) {
    super("Expression");
    this.label = init?.label ?? "Expression";
    this.expr  = init?.expr  ?? "";
    this.locked = init?.locked ?? false;
    this.castTo = init?.castTo ?? "none";
    if (init?.literals) this.literals = { ...init.literals };
    if (init?.varDescriptions) this.varDescriptions = { ...init.varDescriptions };
    if (init?.varUnits) this.varUnits = { ...init.varUnits };
    if (init?.varRequired) this.varRequired = [...init.varRequired];

    this.addOutput("result", resultOut("Result", "combo", this.castTo === "none" ? "auto" : this.castTo));
    this._rebuild();
  }

  _rebuild(): { added: string[]; removed: string[] } {
    const prev = new Set(this.varNames);
    const next = extractVariables(this.expr);
    const nextSet = new Set(next);

    const added:   string[] = [];
    const removed: string[] = [];

    for (const v of next) {
      if (!prev.has(v)) {
        this.addInput(v, anyDataIn(v));
        added.push(v);
      }
    }
    for (const v of prev) {
      if (!nextSet.has(v)) {
        removed.push(v);
      }
    }

    this.varNames = next;
    return { added, removed };
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}
