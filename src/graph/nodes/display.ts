import { ClassicPreset } from "rete";
import { getRecalcGen, isGraphRebuilding } from "../process";
import type { PassthroughSpec } from "./passthrough";
import type { UnitSuffix } from "../unitFormat";
import { isFrameValue, isCubeValue, type FrameValue, type CubeValue } from "../frame";
import { trueAnyIn, trueAnyOut, numIn, numOut, numListIn, numListOut, strIn, broadcast, readInput } from "./shared";
import { isLambdaValue, type LambdaValue } from "./lambda";
import { isSolError, type SolError } from "../errorValue";
import { fireAlert } from "../alertStore";

export class DisplayNode extends ClassicPreset.Node {
  label: string;
  // `in` is an "any" socket, so the value may be a table, a text list or a Frame.
  cachedValue: number | number[] | number[][] | string | string[] | FrameValue | CubeValue | LambdaValue | SolError | null = null;
  unitSuffix: UnitSuffix = "none";
  // A PURE passthrough: it adopts the input's type/unit/format and carries a
  // downstream FC's lock across a run of Displays.
  passthrough(): PassthroughSpec[] { return [{ output: "out", inputs: ["in"], combine: "single", pure: true }]; }
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
    // Display SEES errors (SEES_ERRORS): badge it here AND forward it downstream.
    if (isSolError(raw)) {
      this.cachedValue = raw;
      return { out: raw };
    }
    if (isFrameValue(raw) || isCubeValue(raw)) {
      this.cachedValue = raw;
    } else if (isLambdaValue(raw)) {
      // Keep the VALUE — stringifying here would make the component's lambda branch
      // (and so the FC's lambdaView) unreachable.
      this.cachedValue = raw;
    } else if (Array.isArray(raw)) {
      if (Array.isArray(raw[0])) this.cachedValue = raw as number[][];
      else if (typeof raw[0] === "string") this.cachedValue = raw as string[];
      else this.cachedValue = raw as number[];
    } else {
      this.cachedValue = raw as number | string | null;
    }
    return { out: raw };
  }
}

// The mode picks the trigger condition AND which input sockets are live.
export type AlertMode = "range" | "equals" | "boolean" | "text";

export const ALERT_MODE_KEYS: Record<AlertMode, string[]> = {
  range:   ["value", "low", "high"], // value outside [low, high]
  equals:  ["value", "target"],      // value exactly equals target
  boolean: ["value"],                // value is TRUE (a real true or === 1, not any nonzero)
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
  static socketDocs: Record<string, string> = {
    value: "A blank arriving on the cable makes the status unknown, and an unknown status never fires the alert.",
    result: "The status is 0 when calm and 1 when triggered. Out of range instead emits 1 below Low and 2 above High.",
  };
  label: string;
  // The op selector, named `op` per VAL-12 so the family can declare it.
  op: AlertMode;
  cachedResult: number | number[] | null = null;
  literals: Record<string, number> = { value: 50, low: 0, high: 100, target: 0 };
  stringLiterals: Record<string, string> = { text: "", match: "" };
  width = 190;
  height = 220;
  // Edge-detect on the STATUS key, not a boolean, so range's LOW→HIGH re-fires;
  // starting at NO_STATUS (and resetting on a mode change) makes a node born
  // alerting fire once.
  private lastStatusKey = NO_STATUS;
  private lastEvalOp: AlertMode;

  constructor(init?: { label?: string; op?: AlertMode }) {
    super("Alert");
    this.label = init?.label ?? "Alert";
    this.op = init?.op ?? "range";
    this.lastEvalOp = this.op;
    this.addInput("value",  numListIn("Value"));
    this.addInput("low",    numListIn("Low"));
    this.addInput("high",   numListIn("High"));
    // key stays "target" (persisted literal key); the label is the neutral "Match".
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

  // Status code: 0 = calm. For "range", 1 = below Low, 2 = above High; other modes
  // use 1 = triggered. A list yields a per-element status; null = a needed input is
  // missing (unknown — never fires).
  private evaluate(inputs: AlertInputs): number | number[] | null {
    switch (this.op) {
      case "range": {
        const v = scalarish(inputs.value, this.literals.value);
        const lo = scalarish(inputs.low, this.literals.low);
        const hi = scalarish(inputs.high, this.literals.high);
        if (v === null || lo === null || hi === null) return null;
        // A per-cell error/missing rides through as a non-alerting cell; the cast
        // keeps the status typed as numbers, per broadcast's own convention.
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
        // TRUE only — a real `true` or the socket's 1/0 coercion; a stray 5 is NOT
        // a boolean true.
        return broadcast((x) => (((x as unknown) === true || x === 1) ? 1 : 0), v) as number | number[] | null;
      }
      case "text": {
        const text = readInput(inputs.text, this.stringLiterals.text ?? "");
        const match = readInput(inputs.match, this.stringLiterals.match ?? "");
        if (text === null || match === null) return null;
        if (match === "") return 0; // nothing to look for → never triggered
        return text.includes(match) ? 1 : 0;
      }
    }
  }

  // Fires only when the alerting STATUS CHANGES (so LOW↔HIGH fires, LOW→LOW does
  // not); a null result is unknown — it neither fires nor disturbs the baseline.
  private detectAndFire(result: number | number[] | null, inputs: AlertInputs) {
    if (result === null) return;
    const key = statusKey(result);
    const alerting = isAlerting(result);
    const opChanged = this.lastEvalOp !== this.op;
    const prevKey = opChanged ? NO_STATUS : this.lastStatusKey;
    this.lastEvalOp = this.op;
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

  private buildMessage(result: number | number[], inputs: AlertInputs): string {
    const name = (this.label ?? "").trim() || "Alert";
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
    const num = (got: (number | number[])[] | undefined, lit: number) => {
      const v = got?.[0] ?? lit;
      return typeof v === "number" ? fmt(v) : "value";
    };
    switch (this.op) {
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
        const m = readInput(inputs.match, this.stringLiterals.match ?? "") ?? "";
        return `${name}: contains "${m}"`;
      }
    }
  }
}

// A CONNECTED cable wins even when blank — the status is then unknown and never
// fires; only an UNWIRED slot falls back to the card's literal (VAL-1).
function scalarish(got: (number | number[])[] | undefined, lit: number | undefined): number | number[] | null {
  return readInput(got, lit ?? null);
}

// Distinct from any real status key (digits/commas), so a node born alerting fires.
const NO_STATUS = "\u0000";

// A stable key, so a CHANGE between alerting statuses (range's 1↔2) is detectable.
function statusKey(result: number | number[]): string {
  return Array.isArray(result) ? result.join(",") : String(result);
}

function isAlerting(result: number | number[]): boolean {
  return Array.isArray(result) ? result.some((x) => x !== 0) : result !== 0;
}

// Consolidated RAND/RANDBETWEEN: a 0–1 float by default, Bottom/Top for a range.

export class RandBetweenNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "A fresh draw comes only from Recalculate. Changing a bound rescales the current draw.",
  };
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { bound1: 0, bound2: 1 };
  // The raw [0,1) roll re-rolls only when the recalc generation advances; bounds
  // apply from live inputs on every data() call.
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
    // A blank bound leaves the range undefined, so there is no number to draw.
    const bound1 = readInput(inputs.bound1, this.literals.bound1 ?? 0);
    const bound2 = readInput(inputs.bound2, this.literals.bound2 ?? 1);
    if (bound1 === null || bound2 === null) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = bound1 + this.rawRoll * (bound2 - bound1);
    return { result: this.cachedResult };
  }
}
