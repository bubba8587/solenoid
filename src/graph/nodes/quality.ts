// [[D79]] effectsEdgeTriggered, [[C25]] firstClassUnits, [[C45]] excelComparisons
import { GraphNode } from "../graphModel";
import { trueAnyIn, trueAnyOut, numIn, strIn, anyListIn } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { nodeOnCore } from "../nodeOnCore";
import { staysOffCore } from "./display";
import { fireAlert } from "../alertStore";
import { isGraphRebuilding } from "../process";

export type ExpectCheck = "notNull" | "unique" | "range" | "regex" | "allowed";

type ExpectInputs = Record<string, unknown[] | undefined>;

export class ExpectNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    out: "The value passes through unchanged even when a check fails. A failure badges the node and raises an alert.",
    min: "A value with a unit is checked in the unit it shows. A blank on the cable skips this bound's check instead of falling back to the card. The other bound still applies.",
    max: "A blank on the cable skips this bound's check instead of falling back to the card. The other bound still applies.",
    pattern: "The pattern is a regular expression and tests text cells only. An empty or invalid pattern skips the check.",
    allowed: "A blank input skips this check instead of falling back to the card's list. Membership goes by meaning: 5 matches 5.0 and a 5 m value, TRUE matches true, a typed date matches that day, and text ignores case. Blank cells pass; the not-null check covers them.",
  };
  label: string;
  checkNotNull: boolean;
  checkUnique: boolean;
  checkRange: boolean;
  checkRegex: boolean;
  checkAllowed: boolean;
  cachedValue: unknown = null;
  passthrough(): PassthroughSpec[] { return [{ output: "out", inputs: ["in"], combine: "single", pure: true }]; }
  violations: ExpectCheck[] = [];
  literals: Record<string, number> = { min: 0, max: 100 };
  stringLiterals: Record<string, string> = { pattern: "", allowed: "" };
  width = 220;
  height = 258;
  private lastStatusKey = "";

  constructor(init?: {
    label?: string;
    checkNotNull?: boolean;
    checkUnique?: boolean;
    checkRange?: boolean;
    checkRegex?: boolean;
    checkAllowed?: boolean;
  }) {
    super("Expect");
    this.label = init?.label ?? "Expect";
    this.checkNotNull = init?.checkNotNull ?? true;
    this.checkUnique = init?.checkUnique ?? false;
    this.checkRange = init?.checkRange ?? false;
    this.checkRegex = init?.checkRegex ?? false;
    this.checkAllowed = init?.checkAllowed ?? false;
    this.addInput("in", trueAnyIn("Value"));
    this.addInput("min", numIn("Min"));
    this.addInput("max", numIn("Max"));
    this.addInput("pattern", strIn("Pattern"));
    // anyListIn, because the number-only `list` socket would block a text or date allowlist.
    this.addInput("allowed", anyListIn("Allowed"));
    this.addOutput("out", trueAnyOut("Out"));
  }

  data(inputs: ExpectInputs) {
    const raw = inputs.in?.[0];
    let out: { out: unknown };
    // No check reads a value the core can't take back.
    if (staysOffCore(raw)) {
      this.cachedValue = raw;
      this.violations = [];
      out = { out: raw };
    } else out = nodeOnCore(this, inputs) as { out: unknown };
    const key = this.violations.join(",");
    if (this.violations.length > 0 && key !== this.lastStatusKey && !isGraphRebuilding()) {
      const name = (this.label ?? "").trim() || "Expect";
      fireAlert({
        nodeId: this.id,
        label: name,
        kind: "warning",
        message: `${name}: failed ${this.violations.join(", ")}`,
      });
    }
    this.lastStatusKey = key;
    return out;
  }
}

export const EXPECT_CHECK_LABEL: Record<ExpectCheck, string> = {
  notNull: "not-null",
  unique: "unique",
  range: "range",
  regex: "regex",
  allowed: "in-list",
};
