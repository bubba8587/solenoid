import { ClassicPreset } from "rete";
import { getRecalcGen, isGraphRebuilding } from "../process";
import type { UnitSuffix } from "../unitFormat";
import { isFrameValue, isCubeValue, type FrameValue, type CubeValue } from "../frame";
import { trueAnyIn, trueAnyOut, numIn, numOut, numListIn, numListOut, strIn, broadcast } from "./shared";
import { isLambdaValue, formatLambda } from "./lambda";
import { isSolError, type SolError } from "../errorValue";
import { fireAlert } from "../alertStore";

// ─── Display ─────────────────────────────────────────────────────────────────

export class DisplayNode extends ClassicPreset.Node {
  label: string;
  // `in` is an "any" socket, so the value may also be a 2D table (number[][]),
  // a list of text (string[]), or a Frame.
  cachedValue: number | number[] | number[][] | string | string[] | FrameValue | CubeValue | SolError | null = null;
  unitSuffix: UnitSuffix = "none";
  // Display passes its value through unchanged, so it preserves the unit too:
  // the unit-flow resolver carries an upstream unit straight across it. (See
  // unitFlow.ts — any value-identical passthrough node sets this.)
  passesUnitThrough = true;
  // A bit larger by default than a compute node — it's a display surface, and it's
  // resizable (nodeResizable) so the user can grow it to show a full list/table.
  width = 220;
  height = 150;

  constructor(init?: { label?: string; unitSuffix?: UnitSuffix }) {
    super("Display");
    this.label = init?.label ?? "Display";
    this.unitSuffix = init?.unitSuffix ?? "none";
    this.addInput("in", trueAnyIn("In"));
    this.addOutput("out", trueAnyOut("Out"));
  }

  data(inputs: { in?: unknown[] }) {
    const raw = inputs.in?.[0] ?? null;
    // Display SEES errors (errorValue.ts SEES_ERRORS): show the badge in its own
    // box AND forward the error so it keeps propagating down the chain.
    if (isSolError(raw)) {
      this.cachedValue = raw;
      return { out: raw };
    }
    if (isFrameValue(raw) || isCubeValue(raw)) {
      this.cachedValue = raw;
    } else if (isLambdaValue(raw)) {
      // Show the signature; the raw closure still passes through `out`.
      this.cachedValue = formatLambda(raw);
    } else if (Array.isArray(raw)) {
      // 2D table → keep the matrix (rendered as a grid); string list and number
      // list both keep the array so the value box shows a chip → popup.
      if (Array.isArray(raw[0])) this.cachedValue = raw as number[][];
      else if (typeof raw[0] === "string") this.cachedValue = raw as string[];
      else this.cachedValue = raw as number[];
    } else {
      this.cachedValue = raw as number | string | null;
    }
    return { out: raw };
  }
}

// ─── Alert ────────────────────────────────────────────────────────────────────

// What an Alert watches for. The mode picks the trigger condition AND which input
// sockets are live (ALERT_MODE_KEYS) — like TVM hiding its solved-for input.
export type AlertMode = "range" | "equals" | "boolean" | "text";

export const ALERT_MODE_KEYS: Record<AlertMode, string[]> = {
  range:   ["value", "low", "high"], // value outside [low, high]
  equals:  ["value", "target"],      // value exactly equals target
  boolean: ["value"],                // value is true (nonzero)
  text:    ["text", "match"],        // text contains match
};

type AlertInputs = {
  value?: (number | number[])[];
  low?: (number | number[])[];
  high?: (number | number[])[];
  target?: (number | number[])[];
  text?: string[];
  match?: string[];
};

export class AlertNode extends ClassicPreset.Node {
  label: string;
  // The trigger condition (and which inputs are live). Persisted via the shared
  // `mode` init key (copyPaste extractInit whitelist).
  mode: AlertMode;
  cachedResult: number | number[] | null = null;
  literals: Record<string, number> = { value: 50, low: 0, high: 100, target: 0 };
  stringLiterals: Record<string, string> = { text: "", match: "" };
  width = 190;
  height = 220;
  // Edge-detection state. We track the STATUS (a string key), not just a boolean
  // "triggered" — so range's LOW→HIGH (1→2) re-fires even though both are alerting,
  // while HIGH→HIGH (2→2) does not. lastStatusKey starts at NO_STATUS so a node
  // born alerting fires once. A MODE CHANGE evaluates the new condition from
  // scratch (old mode's status is meaningless → compared against NO_STATUS), so
  // switching into an already-met condition surfaces it. Load/seed firing is gated
  // by isGraphRebuilding.
  private lastStatusKey = NO_STATUS;
  private lastEvalMode: AlertMode;

  constructor(init?: { label?: string; mode?: AlertMode }) {
    super("Alert");
    this.label = init?.label ?? "Alert";
    this.mode = init?.mode ?? "range";
    this.lastEvalMode = this.mode;
    this.addInput("value",  numListIn("Value"));
    this.addInput("low",    numListIn("Low"));
    this.addInput("high",   numListIn("High"));
    // key stays "target" (persisted literal key); label is the neutral "Match",
    // consistent with text mode's Match — it's the value to equal, not a goal.
    this.addInput("target", numListIn("Match"));
    this.addInput("text",   strIn("Text"));
    this.addInput("match",  strIn("Match"));
    this.addOutput("result", numListOut("Status"));
  }

  data(inputs: AlertInputs) {
    const result = this.evaluate(inputs);
    this.cachedResult = result;
    this.detectAndFire(result, inputs);
    return { result };
  }

  // Status code: 0 = calm. For "range", 1 = below Low, 2 = above High (kept for
  // back-compat / the value box). Other modes use 1 = triggered. A list yields a
  // per-element status; null = a needed input is missing (unknown — never fires).
  private evaluate(inputs: AlertInputs): number | number[] | null {
    switch (this.mode) {
      case "range": {
        const v = scalarish(inputs.value, this.literals.value);
        const lo = scalarish(inputs.low, this.literals.low);
        const hi = scalarish(inputs.high, this.literals.high);
        if (v === null || lo === null || hi === null) return null;
        // A per-cell error/missing rides through the broadcaster as a non-alerting
        // cell (status logic below only matches 1/2); the loose-list cast keeps the
        // Alert's status typed as numbers, matching broadcast's own convention.
        return broadcast((x, l, h) => (x < l ? 1 : x > h ? 2 : 0), v, lo, hi) as number | number[] | null;
      }
      case "equals": {
        const v = scalarish(inputs.value, this.literals.value);
        const t = scalarish(inputs.target, this.literals.target);
        if (v === null || t === null) return null;
        return broadcast((x, y) => (x === y ? 1 : 0), v, t) as number | number[] | null;
      }
      case "boolean": {
        const v = scalarish(inputs.value, this.literals.value);
        if (v === null) return null;
        // TRUE only — comparisons / logic ops now emit a real logical, which the
        // numeric `value` socket coerces to 1/0; accept a raw `true` too for
        // robustness. A stray 5 is NOT a boolean true (so not any-nonzero).
        return broadcast((x) => (((x as unknown) === true || x === 1) ? 1 : 0), v) as number | number[] | null;
      }
      case "text": {
        const text = inputs.text?.[0] ?? this.stringLiterals.text ?? "";
        const match = inputs.match?.[0] ?? this.stringLiterals.match ?? "";
        if (match === "") return 0; // nothing to look for → never triggered
        return text.includes(match) ? 1 : 0;
      }
    }
  }

  // Raise a toast + log a HUD event whenever the alerting STATUS changes to a new
  // alerting value — so OK→LOW, OK→HIGH and LOW↔HIGH all fire, but LOW→LOW and
  // HIGH→HIGH don't, and going back to OK is silent. A null result is "unknown":
  // it neither fires nor disturbs the baseline, so a missing input can't flap it.
  private detectAndFire(result: number | number[] | null, inputs: AlertInputs) {
    if (result === null) return;
    const key = statusKey(result);
    const alerting = isAlerting(result);
    const modeChanged = this.lastEvalMode !== this.mode;
    // A mode change discards the old mode's status (compare against NO_STATUS), so
    // switching the Alert into an already-met condition fires once.
    const prevKey = modeChanged ? NO_STATUS : this.lastStatusKey;
    this.lastEvalMode = this.mode;
    this.lastStatusKey = key;
    if (isGraphRebuilding()) return; // never fire mid load/seed
    if (alerting && key !== prevKey) {
      fireAlert({
        nodeId: this.id,
        label: (this.label ?? "").trim() || "Alert",
        kind: "warning",
        message: this.buildMessage(result, inputs),
      });
    }
  }

  // A short, human message for the toast + HUD chip.
  private buildMessage(result: number | number[], inputs: AlertInputs): string {
    const name = (this.label ?? "").trim() || "Alert";
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
    const num = (got: (number | number[])[] | undefined, lit: number) => {
      const v = got?.[0] ?? lit;
      return typeof v === "number" ? fmt(v) : "value";
    };
    switch (this.mode) {
      case "range": {
        const lo = num(inputs.low, this.literals.low);
        const hi = num(inputs.high, this.literals.high);
        if (Array.isArray(result)) {
          const below = result.filter((x) => x === 1).length;
          const above = result.filter((x) => x === 2).length;
          const parts: string[] = [];
          if (below) parts.push(`${below} below ${lo}`);
          if (above) parts.push(`${above} above ${hi}`);
          return `${name}: ${parts.join(", ") || "out of range"}`;
        }
        const v = num(inputs.value, this.literals.value);
        if (result === 1) return `${name}: ${v} below ${lo}`;
        if (result === 2) return `${name}: ${v} above ${hi}`;
        return `${name}: out of range`;
      }
      case "equals":
        return `${name}: equals ${num(inputs.target, this.literals.target)}`;
      case "boolean":
        return `${name}: is true`;
      case "text": {
        const m = inputs.match?.[0] ?? this.stringLiterals.match ?? "";
        return `${name}: contains "${m}"`;
      }
    }
  }
}

// Resolve a numeric input to its first value, else its literal fallback, else
// null. Mirrors the old `inputs.x?.[0] ?? literal ?? null` chain.
function scalarish(got: (number | number[])[] | undefined, lit: number | undefined): number | number[] | null {
  const v = got?.[0] ?? lit ?? null;
  return v;
}

// "No status seen yet" sentinel — distinct from any real status key (which are
// digits/commas), so a node born alerting (or just switched modes) fires once.
const NO_STATUS = "\u0000";

// A stable key for a status, so equal statuses compare equal and a CHANGE between
// alerting statuses (range's 1↔2) is detectable. List statuses key on contents.
function statusKey(result: number | number[]): string {
  return Array.isArray(result) ? result.join(",") : String(result);
}

// Whether a status is alerting (any nonzero element).
function isAlerting(result: number | number[]): boolean {
  return Array.isArray(result) ? result.some((x) => x !== 0) : result !== 0;
}

// ─── RAND ─────────────────────────────────────────────────────────────────────
// Consolidated RAND/RANDBETWEEN. Defaults to 0–1 float (like Excel RAND()).
// Wire in Bottom/Top for a custom range (like Excel RANDBETWEEN but float).

export class RandBetweenNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { bound1: 0, bound2: 1 };
  // Stores the raw [0,1) roll — re-rolled only when the recalc generation
  // advances. Bounds are applied from live inputs on every data() call so
  // wired Bottom/Top are always respected.
  private rawRoll = Math.random();
  private lastRollGen = -1;
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("RandBetween");
    this.label = init?.label ?? "RAND";
    this.addInput("bound1", numIn("Bound 1"));
    this.addInput("bound2", numIn("Bound 2"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { bound1?: number[]; bound2?: number[] }) {
    const gen = getRecalcGen();
    if (this.lastRollGen !== gen) {
      this.rawRoll = Math.random();
      this.lastRollGen = gen;
    }
    const bound1 = inputs.bound1?.[0] ?? this.literals.bound1 ?? 0;
    const bound2 = inputs.bound2?.[0] ?? this.literals.bound2 ?? 1;
    this.cachedResult = bound1 + this.rawRoll * (bound2 - bound1);
    return { result: this.cachedResult };
  }
}
