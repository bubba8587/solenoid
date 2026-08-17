import { ClassicPreset } from "rete";
import { trueAnyIn, trueAnyOut, numIn, strIn, anyListIn, readInput } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { isSolError } from "../errorValue";
import { fireAlert } from "../alertStore";
import { isGraphRebuilding } from "../process";
import { isFrameValue, frameRowCount, type FrameValue } from "../frame";

// Expect is always PASS-THROUGH: a failed expectation badges the node and fires an
// alert on the rising edge of a NEW failure signature, but never blocks the value.

function safeRegex(pattern: string): RegExp | null {
  try { return new RegExp(pattern); } catch { return null; }
}

export type ExpectCheck = "notNull" | "unique" | "range" | "regex" | "allowed";

export class ExpectNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    out: "The value passes through unchanged even when a check fails. A failure badges the node and raises an alert.",
    min: "A blank on the cable skips this bound's check instead of falling back to the card; the other bound still applies.",
    max: "A blank on the cable skips this bound's check instead of falling back to the card; the other bound still applies.",
    pattern: "The pattern is a regular expression and tests text cells only. An empty or invalid pattern skips the check.",
    allowed: "Membership compares by text form, so the number 5 matches the text 5. Blank cells pass; the not-null check covers them.",
  };
  label: string;
  checkNotNull: boolean;
  checkUnique: boolean;
  checkRange: boolean;
  checkRegex: boolean;
  checkAllowed: boolean;
  cachedValue: unknown = null;
  // PURE passthrough on `in` — min/max/pattern/allowed are check parameters, not
  // value branches — so the value's type + unit carry through.
  passthrough(): PassthroughSpec[] { return [{ output: "out", inputs: ["in"], combine: "single", pure: true }]; }
  /** Which checks currently fail (empty = passing) — the component's red badge. */
  violations: ExpectCheck[] = [];
  literals: Record<string, number> = { min: 0, max: 100 };
  // `pattern` = regex source; `allowed` = comma-separated allowlist, used when the
  // `allowed` socket is unwired.
  stringLiterals: Record<string, string> = { pattern: "", allowed: "" };
  width = 220;
  height = 258;
  // Edge-detect on the SET of failing checks, so the same failure doesn't refire.
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
    // anyListIn, not listIn: the allowlist is element-agnostic, and the number-only
    // `list` socket would block a strlist/datelist cable.
    this.addInput("allowed", anyListIn("Allowed"));
    this.addOutput("out", trueAnyOut("Out"));
  }

  data(inputs: { in?: unknown[]; min?: number[]; max?: number[]; pattern?: string[]; allowed?: unknown[][] }) {
    const raw = inputs.in?.[0] ?? null;
    this.cachedValue = raw;

    // Expect checks DATA quality, not error propagation — no second badge on an error.
    if (isSolError(raw)) {
      this.violations = [];
      this.lastStatusKey = "";
      return { out: raw };
    }

    // A wired blank bound/pattern leaves the CHECK undefined rather than reverting to
    // the value typed on the card.
    const min = readInput(inputs.min, this.literals.min ?? 0);
    const max = readInput(inputs.max, this.literals.max ?? 100);
    const pattern = readInput(inputs.pattern, this.stringLiterals.pattern ?? "");
    // A Frame checks its CELLS; without this branch it falls into the `[raw]` arm and
    // every check silently no-ops.
    const frame: FrameValue | null = isFrameValue(raw) ? raw : null;
    const values: unknown[] = frame
      ? frame.columns.flatMap((c) => c.values as unknown[])
      : raw === null ? [null] : Array.isArray(raw) ? raw.flat(1) : [raw];

    const violations: ExpectCheck[] = [];

    // Not-null also catches a per-cell error, or a table of errored cells would pass
    // the gate as clean (range/regex skip them as wrong-typed).
    if (this.checkNotNull && values.some((v) => v === null || v === undefined || isSolError(v))) {
      violations.push("notNull");
    }
    if (this.checkUnique && frame) {
      // Unique for a table means unique ROWS — per-cell uniqueness is meaningless.
      const seen = new Set<string>();
      for (let i = 0; i < frameRowCount(frame); i++) {
        const k = JSON.stringify(frame.columns.map((c) => c.values[i] ?? null));
        if (seen.has(k)) { violations.push("unique"); break; }
        seen.add(k);
      }
    } else if (this.checkUnique && Array.isArray(raw)) {
      const seen = new Set<string>();
      for (const v of values) {
        if (v === null || v === undefined) continue;
        const k = typeof v === "object" ? JSON.stringify(v) : String(v);
        if (seen.has(k)) { violations.push("unique"); break; }
        seen.add(k);
      }
    }
    // A missing bound is unevaluatable, not failing, and each bound is skipped
    // independently: a blank floor doesn't disable the ceiling.
    if (this.checkRange && (min !== null || max !== null)) {
      const bad = values.some((v) => typeof v === "number" && Number.isFinite(v) &&
        ((min !== null && v < min) || (max !== null && v > max)));
      if (bad) violations.push("range");
    }
    if (this.checkRegex && pattern !== null && pattern.trim() !== "") {
      const re = safeRegex(pattern);
      if (re) {
        const bad = values.some((v) => typeof v === "string" && !re.test(v));
        if (bad) violations.push("regex");
      }
    }
    if (this.checkAllowed) {
      // Compare by string form, so number, date-serial and text all match by their
      // rendered token.
      const wired = inputs.allowed?.[0];
      const allowVals: unknown[] = Array.isArray(wired)
        ? wired.flat(1)
        : (this.stringLiterals.allowed ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
      if (allowVals.length > 0) {
        const set = new Set(allowVals.map((v) => String(v)));
        // A null cell is the not-null check's job, not membership's — skip it here.
        const bad = values.some((v) => v !== null && v !== undefined && !isSolError(v) && !set.has(String(v)));
        if (bad) violations.push("allowed");
      }
    }

    this.violations = violations;
    const key = violations.join(",");
    if (violations.length > 0 && key !== this.lastStatusKey && !isGraphRebuilding()) {
      const name = (this.label ?? "").trim() || "Expect";
      fireAlert({
        nodeId: this.id,
        label: name,
        kind: "warning",
        message: `${name}: failed ${violations.join(", ")}`,
      });
    }
    this.lastStatusKey = key;

    return { out: raw };
  }
}

export const EXPECT_CHECK_LABEL: Record<ExpectCheck, string> = {
  notNull: "not-null",
  unique: "unique",
  range: "range",
  regex: "regex",
  allowed: "in-list",
};
