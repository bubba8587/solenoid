// [[C47]]

import { ClassicPreset } from "rete";
import { numListIn, numListOut, logicalComboOut } from "./shared";
import { extractVariables } from "../excelFormula";
import { type SolError } from "../errorValue";
import { type UnitCell } from "../unitValue";
import { nodeOnCore } from "../nodeOnCore";

type Val = number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null;

export class EquationNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    holds: "Equality is judged within a small relative tolerance, cell by cell for lists.",
  };

  unitAware = true;
  label: string;
  expr: string;
  locked: boolean;
  varNames: string[] = [];
  cachedError: string | null = null;
  cachedValues: Record<string, Val> = {};
  varDescriptions: Record<string, string> = {};
  /** A preset's input units: the equation reads that variable's number in this unit ([[C25]] firstClassUnits). */
  varUnits: Record<string, string> = {};
  cachedHolds: boolean | (boolean | SolError | null)[] | SolError | null = null;
  solvedFor: string | null = null;

  width = 240;
  height = 220;

  constructor(init?: { label?: string; expr?: string; locked?: boolean; varDescriptions?: Record<string, string>; varUnits?: Record<string, string> }) {
    super("Equation");
    this.label = init?.label ?? "Equation";
    this.expr = init?.expr ?? "";
    this.locked = init?.locked ?? false;
    if (init?.varDescriptions) this.varDescriptions = { ...init.varDescriptions };
    if (init?.varUnits) this.varUnits = { ...init.varUnits };
    this.addOutput("holds", logicalComboOut("Check"));
    this._rebuild();
  }

  _rebuild(): { added: string[]; removed: string[] } {
    const prev = new Set(this.varNames);
    const next = this.expr.trim() ? extractVariables(this.expr) : [];
    const nextSet = new Set(next);

    const added: string[] = [];
    const removed: string[] = [];
    for (const v of next) {
      if (!prev.has(v)) {
        this.addInput(v, numListIn(v));
        this.addOutput(v, numListOut(v));
        added.push(v);
      }
    }
    for (const v of prev) {
      if (!nextSet.has(v)) removed.push(v);
    }

    this.varNames = next;
    return { added, removed };
  }

  data(inputs: Record<string, unknown[] | undefined>): Record<string, unknown> {
    return nodeOnCore(this, inputs);
  }
}
