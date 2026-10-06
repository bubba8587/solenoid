// [[D79]] effectsEdgeTriggered, [[C25]] firstClassUnits, [[C45]] excelComparisons
import { ClassicPreset } from "rete";
import { trueAnyIn, trueAnyOut, numIn, strIn, anyListIn, readInput } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { isSolError } from "../errorValue";
import { fireAlert } from "../alertStore";
import { isGraphRebuilding } from "../process";
import { isFrameValue, isCubeValue, frameRowCount, type FrameValue, type CubeValue } from "../frame";
import { isUnitCell, type UnitCell } from "../unitValue";
import { fcUnitToUnit } from "../unitBridge";
import { parseDate } from "./date";

/** A unit-tagged number as the card shows it: in its display unit, else its base unit. */
function shownMagnitude(c: UnitCell): number {
  const u = c.display ? fcUnitToUnit(c.display) : null;
  return u ? (c.value - (u.offset ?? 0)) / u.scale : c.value;
}

/** Every scalar cell, descending into lists, Frames, Cubes and the tables nested in a Cube's cells. */
function scalarCells(v: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) for (const c of v) scalarCells(c, out);
  else if (isFrameValue(v)) for (const col of v.columns) for (const c of col.values as unknown[]) scalarCells(c, out);
  else if (isCubeValue(v)) for (const col of v.columns) for (const c of col.cells) scalarCells(c, out);
  else out.push(isUnitCell(v) ? shownMagnitude(v) : v);
  return out;
}

/** A row's identity for the unique check: a quantity by its base value, so 5 m and 500 cm collide; text keeps its case ([[C45]] excelComparisons). */
function cellKey(v: unknown): string {
  if (isUnitCell(v)) return `u:${v.value}`;
  return typeof v === "object" && v !== null ? JSON.stringify(v) : `${typeof v}:${String(v)}`;
}

/** Membership by meaning: numbers compare as numbers, TRUE/FALSE and text ignore case ([[C45]] excelComparisons), a typed date matches its serial. */
function allowMatcher(allowVals: unknown[]): (cell: unknown) => boolean {
  const texts = new Set<string>();
  const nums = new Set<number>();
  const bools = new Set<boolean>();
  for (const a of scalarCells(allowVals)) {
    if (a === null || a === undefined || isSolError(a)) continue;
    if (typeof a === "boolean") { bools.add(a); continue; }
    if (typeof a === "number") { nums.add(a); continue; }
    const t = String(a).trim();
    texts.add(t.toLowerCase());
    if (/^(true|false)$/i.test(t)) bools.add(/^true$/i.test(t));
    const n = t === "" ? NaN : Number(t);
    if (Number.isFinite(n)) nums.add(n);
    else {
      const d = parseDate(t);
      if (typeof d === "number" && Number.isFinite(d)) nums.add(Math.floor(d));
    }
  }
  return (cell) => {
    if (typeof cell === "boolean") return bools.has(cell) || texts.has(String(cell));
    if (typeof cell === "number") return nums.has(cell) || texts.has(String(cell));
    return texts.has(String(cell).trim().toLowerCase());
  };
}

function safeRegex(pattern: string): RegExp | null {
  try { return new RegExp(pattern); } catch { return null; }
}

export type ExpectCheck = "notNull" | "unique" | "range" | "regex" | "allowed";

export class ExpectNode extends ClassicPreset.Node {
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

  data(inputs: { in?: unknown[]; min?: number[]; max?: number[]; pattern?: string[]; allowed?: unknown[][] }) {
    const raw = inputs.in?.[0] ?? null;
    this.cachedValue = raw;

    if (isSolError(raw)) {
      this.violations = [];
      this.lastStatusKey = "";
      return { out: raw };
    }

    const min = readInput(inputs.min, this.literals.min ?? 0);
    const max = readInput(inputs.max, this.literals.max ?? 100);
    const pattern = readInput(inputs.pattern, this.stringLiterals.pattern ?? "");
    const frame: FrameValue | null = isFrameValue(raw) ? raw : null;
    const cube: CubeValue | null = isCubeValue(raw) ? raw : null;
    const values = scalarCells(raw === null ? [null] : raw);

    const violations: ExpectCheck[] = [];

    if (this.checkNotNull && values.some((v) => v === null || v === undefined || isSolError(v))) {
      violations.push("notNull");
    }
    if (this.checkUnique && (frame || cube)) {
      // A table is unique by whole rows.
      const cols = frame ? frame.columns.map((c) => c.values as unknown[]) : cube!.columns.map((c) => c.cells as unknown[]);
      const rows = frame ? frameRowCount(frame) : Math.max(0, ...cols.map((c) => c.length));
      const seen = new Set<string>();
      for (let i = 0; i < rows; i++) {
        const k = cols.map((c) => cellKey(c[i] ?? null)).join("|");
        if (seen.has(k)) { violations.push("unique"); break; }
        seen.add(k);
      }
    } else if (this.checkUnique && Array.isArray(raw)) {
      const seen = new Set<string>();
      for (const v of raw.flat(1) as unknown[]) {
        if (v === null || v === undefined) continue;
        const k = cellKey(v);
        if (seen.has(k)) { violations.push("unique"); break; }
        seen.add(k);
      }
    }
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
      const wired = inputs.allowed;
      let allowVals: unknown[] | null;
      if (wired === undefined || wired.length === 0) {
        allowVals = (this.stringLiterals.allowed ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
      } else {
        const v = wired[0];
        allowVals = v == null ? null : Array.isArray(v) ? v : [v];
      }
      if (allowVals && allowVals.length > 0) {
        const allowed = allowMatcher(allowVals);
        const bad = values.some((v) => v !== null && v !== undefined && !isSolError(v) && !allowed(v));
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
