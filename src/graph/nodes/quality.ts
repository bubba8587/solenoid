import { ClassicPreset } from "rete";
import { anyIn, anyOut, numIn, strIn, listIn } from "./shared";
import { isSolError } from "../errorValue";
import { fireAlert } from "../alertStore";
import { isGraphRebuilding } from "../process";
import { isFrameValue, frameRowCount, type FrameValue } from "../frame";

// ─── Expect — the data-quality gate ────────────────────────────────────────────
// "Data Validation, generalized": four checks (not-null / unique / range / regex)
// against whatever flows through it. Strictly opt-in (every check defaults off
// except Not null) and always PASS-THROUGH — a failed expectation never blocks
// the value, it just badges the node (red, ErrorChip styling — see
// components/ExpectNode.tsx) and fires an alert on the rising edge of a NEW
// failure signature (so a continuously-failing node doesn't spam the HUD).

function safeRegex(pattern: string): RegExp | null {
  try { return new RegExp(pattern); } catch { return null; }
}

export type ExpectCheck = "notNull" | "unique" | "range" | "regex" | "allowed";

export class ExpectNode extends ClassicPreset.Node {
  label: string;
  checkNotNull: boolean;
  checkUnique: boolean;
  checkRange: boolean;
  checkRegex: boolean;
  checkAllowed: boolean;
  cachedValue: unknown = null;
  /** Which checks currently fail (empty = passing) — the component's red badge. */
  violations: ExpectCheck[] = [];
  literals: Record<string, number> = { min: 0, max: 100 };
  // `pattern` = regex source; `allowed` = comma-separated allowlist (used when the
  // `allowed` list socket is unwired — like Excel data-validation's typed list).
  stringLiterals: Record<string, string> = { pattern: "", allowed: "" };
  width = 220;
  height = 258;
  // Edge-detect on the SET of failing checks (like Alert's statusKey) so a value
  // that keeps failing the same way doesn't refire every recompute.
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
    this.addInput("in", anyIn("Value"));
    this.addInput("min", numIn("Min"));
    this.addInput("max", numIn("Max"));
    this.addInput("pattern", strIn("Pattern"));
    this.addInput("allowed", listIn("Allowed"));
    this.addOutput("out", anyOut("Out"));
  }

  data(inputs: { in?: unknown[]; min?: number[]; max?: number[]; pattern?: string[]; allowed?: unknown[][] }) {
    const raw = inputs.in?.[0] ?? null;
    this.cachedValue = raw;

    // An error already flowing through is its own signal — Expect checks DATA
    // quality, not error propagation, so it doesn't pile a second badge on top.
    if (isSolError(raw)) {
      this.violations = [];
      this.lastStatusKey = "";
      return { out: raw };
    }

    const min = inputs.min?.[0] ?? this.literals.min ?? 0;
    const max = inputs.max?.[0] ?? this.literals.max ?? 100;
    const pattern = inputs.pattern?.[0] ?? this.stringLiterals.pattern ?? "";
    // A Frame checks its CELLS (a lazy FrameRef was already materialized by
    // coerceInputs — Expect isn't a lazy verb node, so `raw` is a FrameValue
    // here). Without this branch a frame fell into the `[raw]` arm and every
    // check silently no-opped on the app's core data shape.
    const frame: FrameValue | null = isFrameValue(raw) ? raw : null;
    const values: unknown[] = frame
      ? frame.columns.flatMap((c) => c.values as unknown[])
      : raw === null ? [null] : Array.isArray(raw) ? raw.flat(1) : [raw];

    const violations: ExpectCheck[] = [];

    // Not-null also catches a per-cell error: a #DIV/0!/#N/A cell isn't a valid
    // present value, and the range/regex checks skip it (wrong type), so without
    // this a table with errored cells would pass the quality gate as "clean".
    if (this.checkNotNull && values.some((v) => v === null || v === undefined || isSolError(v))) {
      violations.push("notNull");
    }
    if (this.checkUnique && frame) {
      // Unique for a table means unique ROWS (the Distinct notion) — per-cell
      // uniqueness across columns of different types is meaningless.
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
    if (this.checkRange) {
      const bad = values.some((v) => typeof v === "number" && Number.isFinite(v) && (v < min || v > max));
      if (bad) violations.push("range");
    }
    if (this.checkRegex && pattern.trim() !== "") {
      const re = safeRegex(pattern);
      if (re) {
        const bad = values.some((v) => typeof v === "string" && !re.test(v));
        if (bad) violations.push("regex");
      }
    }
    if (this.checkAllowed) {
      // Membership against an allowlist. A wired `allowed` list wins; otherwise
      // parse the typed comma-separated literal. Compare by string form so a
      // number, date-serial, or text value all match by their rendered token.
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
