import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { isGraphRebuilding } from "../process";
import type { PassthroughSpec } from "./passthrough";
import type { UnitSuffix } from "../unitFormat";
import { isFrameValue, isCubeValue, type FrameValue, type CubeValue } from "../frame";
import { trueAnyIn, trueAnyOut, numIn, numOut, numListIn, numListOut, strIn } from "./shared";
import { nodeWire } from "../nodeWire";
import { isLambdaValue, type LambdaValue } from "./lambda";
import { type SolError } from "../errorValue";
import { fireAlert } from "../alertStore";

export class DisplayNode extends GraphNode {
  label: string;
  cachedValue: number | number[] | number[][] | string | string[] | FrameValue | CubeValue | LambdaValue | SolError | null = null;
  unitSuffix: UnitSuffix = "none";
  // Pure, so a downstream Format Controller's lock carries across a run of Displays.
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

  data(inputs: Record<string, unknown[] | undefined>) {
    const raw = inputs.in?.[0] ?? null;
    if (staysOffCore(raw)) {
      this.cachedValue = raw as DisplayNode["cachedValue"];
      return { out: raw };
    }
    return nodeOnCore(this, inputs) as { out: unknown };
  }
}

/** A value a pass-through card hands on in TS: a LAMBDA can't come back from the core, and an object the card wire
 *  doesn't carry can't reach it. A pass-through has nothing to compute on either. */
export function staysOffCore(v: unknown): boolean {
  if (isLambdaValue(v)) return true;
  return v !== null && typeof v === "object" && !Array.isArray(v) && !isFrameValue(v) && !isCubeValue(v) && nodeWire(v) === undefined;
}

export type AlertMode = "range" | "equals" | "boolean" | "text";

export const ALERT_MODE_KEYS: Record<AlertMode, string[]> = {
  range:   ["value", "low", "high"],
  equals:  ["value", "target"],
  boolean: ["value"],
  text:    ["text", "match"],
};

export class AlertNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    value: "A blank arriving on the cable makes the status unknown, and an unknown status never fires the alert.",
    result: "The status is 0 when calm and 1 when triggered. Out of range instead emits 1 below Low and 2 above High.",
  };
  label: string;
  condition: AlertMode;
  cachedResult: number | number[] | null = null;
  literals: Record<string, number> = { value: 50, low: 0, high: 100, target: 0 };
  stringLiterals: Record<string, string> = { text: "", match: "" };
  width = 190;
  height = 220;
  /** The condition and status the body last read, and what that status fires (null when calm). */
  alertKey: string | null = null;
  alertMessage: string | null = null;

  constructor(init?: { label?: string; condition?: AlertMode }) {
    super("Alert");
    this.label = init?.label ?? "Alert";
    this.condition = init?.condition ?? "range";
    this.addInput("value",  numListIn("Value"));
    this.addInput("low",    numListIn("Low"));
    this.addInput("high",   numListIn("High"));
    // The key stays `target` because saves use it; the label is the neutral "Match".
    this.addInput("target", numListIn("Match"));
    this.addInput("text",   strIn("Text"));
    this.addInput("match",  strIn("Match"));
    this.addOutput("result", numListOut("Status"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | number[] | null };
  }

  static coreWatch = "alertKey";
  coreWatched(): void {
    raiseWatched(this, "Alert");
  }
}

/** The body's status changed ([[D79]] effectsEdgeTriggered): raise what it fires (`alertMessage`), unless the graph
 *  is rebuilding. */
export function raiseWatched(node: GraphNode & { alertMessage: string | null }, fallback: string): void {
  if (!node.alertMessage || isGraphRebuilding()) return;
  fireAlert({ nodeId: node.id, label: (node.label ?? "").trim() || fallback, kind: "warning", message: node.alertMessage });
}

// A blank or error cell in a list status is unknown, so it never alerts.
export function isAlertMet(cell: unknown): boolean {
  return typeof cell === "number" && cell !== 0;
}

export class RandBetweenNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    result: "A fresh draw comes only from Recalculate. Changing a bound rescales the current draw.",
  };
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { bound1: 0, bound2: 1 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("RandBetween");
    this.label = init?.label ?? "RAND";
    this.addInput("bound1", numIn("Bound 1"));
    this.addInput("bound2", numIn("Bound 2"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | null };
  }
}
