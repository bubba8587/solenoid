// [[alert-node-alerts-hud#An alert fires when its status changes, and never on load]], [[C25]] firstClassUnits, [[C45]] excelComparisons
import { GraphInput, GraphNode } from "../graphModel";
import { MutableSocket, SolenoidSocket, elementFamilyOf, type SocketDataType } from "../sockets";
import { trueAnyIn, trueAnyOut, strIn, anyListIn } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { nodeOnCore } from "../nodeOnCore";
import { staysOffCore, raiseWatched } from "./display";

type ExpectCheck = "notNull" | "unique" | "range" | "regex" | "allowed";

type ExpectInputs = Record<string, unknown[] | undefined>;

export class ExpectNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    out: "The value passes through unchanged even when a check fails. A failure badges the node and raises an alert.",
    min: "Takes the kind of value being checked: a date for dates, a number otherwise. A value with a unit is checked in the unit it shows. A blank on the cable skips this bound's check instead of falling back to the card. The other bound still applies.",
    max: "Takes the kind of value being checked: a date for dates, a number otherwise. A blank on the cable skips this bound's check instead of falling back to the card. The other bound still applies.",
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
  /** A date bound is typed as a date and kept beside the number bound, so the card keeps both as its value moves. */
  stringLiterals: Record<string, string> = { pattern: "", allowed: "", min: "", max: "" };
  width = 220;
  height = 258;
  /** The checks the body last found failing, and what they fire (null when all pass). */
  alertKey = "";
  alertMessage: string | null = null;

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
    this.addInput("min", new GraphInput(new MutableSocket("number"), "Min"));
    this.addInput("max", new GraphInput(new MutableSocket("number"), "Max"));
    this.addInput("pattern", strIn("Pattern"));
    // anyListIn, because the number-only `list` socket would block a text or date allowlist.
    this.addInput("allowed", anyListIn("Allowed"));
    this.addOutput("out", trueAnyOut("Out"));
  }

  data(inputs: ExpectInputs) {
    const raw = inputs.in?.[0];
    // No check reads a value the core can't take back.
    if (staysOffCore(raw)) {
      this.cachedValue = raw;
      this.violations = [];
      this.alertKey = "";
      this.alertMessage = null;
      return { out: raw };
    }
    return nodeOnCore(this, inputs) as { out: unknown };
  }

  /** Min and Max take the kind of the value checked: dates for a date, numbers otherwise ([[date-values#A range check bounds a date by dates and a number by numbers]]).
   *  Answers the bounds that retyped. */
  settleFollowers(): string[] {
    const t = (this.inputs.in?.socket as SolenoidSocket | undefined)?.dataType;
    const want: SocketDataType = t && elementFamilyOf(t) === "date" ? "date" : "number";
    return ["min", "max"].filter((k) => {
      const s = this.inputs[k]?.socket;
      if (!(s instanceof MutableSocket) || s.dataType === want) return false;
      s.setType(want);
      return true;
    });
  }

  static coreWatch = "alertKey";
  coreWatched(): void {
    raiseWatched(this, "Expect");
  }
}

export const EXPECT_CHECK_LABEL: Record<ExpectCheck, string> = {
  notNull: "not-null",
  unique: "unique",
  range: "range",
  regex: "regex",
  allowed: "in-list",
};
