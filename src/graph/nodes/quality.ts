import { ClassicPreset } from "rete";
import { anyIn, anyOut, numIn, strIn } from "./shared";
import { isSolError } from "../errorValue";
import { fireAlert } from "../alertStore";
import { isGraphRebuilding } from "../process";

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

export type ExpectCheck = "notNull" | "unique" | "range" | "regex";

export class ExpectNode extends ClassicPreset.Node {
  label: string;
  checkNotNull: boolean;
  checkUnique: boolean;
  checkRange: boolean;
  checkRegex: boolean;
  cachedValue: unknown = null;
  /** Which checks currently fail (empty = passing) — the component's red badge. */
  violations: ExpectCheck[] = [];
  literals: Record<string, number> = { min: 0, max: 100 };
  stringLiterals: Record<string, string> = { pattern: "" };
  width = 220;
  height = 235;
  // Edge-detect on the SET of failing checks (like Alert's statusKey) so a value
  // that keeps failing the same way doesn't refire every recompute.
  private lastStatusKey = "";

  constructor(init?: {
    label?: string;
    checkNotNull?: boolean;
    checkUnique?: boolean;
    checkRange?: boolean;
    checkRegex?: boolean;
  }) {
    super("Expect");
    this.label = init?.label ?? "Expect";
    this.checkNotNull = init?.checkNotNull ?? true;
    this.checkUnique = init?.checkUnique ?? false;
    this.checkRange = init?.checkRange ?? false;
    this.checkRegex = init?.checkRegex ?? false;
    this.addInput("in", anyIn("Value"));
    this.addInput("min", numIn("Min"));
    this.addInput("max", numIn("Max"));
    this.addInput("pattern", strIn("Pattern"));
    this.addOutput("out", anyOut("Out"));
  }

  data(inputs: { in?: unknown[]; min?: number[]; max?: number[]; pattern?: string[] }) {
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
    const values: unknown[] = raw === null ? [null] : Array.isArray(raw) ? raw.flat(1) : [raw];

    const violations: ExpectCheck[] = [];

    if (this.checkNotNull && values.some((v) => v === null || v === undefined)) {
      violations.push("notNull");
    }
    if (this.checkUnique && Array.isArray(raw)) {
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
};
