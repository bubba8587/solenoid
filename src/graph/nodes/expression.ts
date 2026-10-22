import { ClassicPreset } from "rete";
import { anyDataIn, resultOut, resultSocket, type ResultType } from "./shared";
import { frameSocket, cubeSocket } from "../sockets";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { extractVariables } from "../excelFormula";
import { isSolError } from "../errorValue";
import { nodeOnCore } from "../nodeOnCore";

export type ProducedFamily = ResultType | "frame" | "cube";

type RankedProducer = ClassicPreset.Node & { resultAs?: ResultType; lastResultRank: 1 | 2; lastResultFamily?: ProducedFamily };

export function reconcileResultRank(node: RankedProducer, result: unknown, family?: ProducedFamily): void {
  if (isSolError(result)) return;
  const want: 1 | 2 = Array.isArray(result) && result.length > 0 && Array.isArray(result[0]) ? 2 : 1;
  const familyChanged = family !== undefined && node.lastResultFamily !== family;
  if (want === node.lastResultRank && !familyChanged) return;
  node.lastResultRank = want;
  if (family !== undefined) node.lastResultFamily = family;
  retypeResult(node, family ?? node.resultAs ?? "auto");
}

/** Retypes the result socket to the producer's rank and family once the pass is over, and its cables after it. */
function retypeResult(node: RankedProducer, family: ProducedFamily): void {
  queueMicrotask(() => {
    void (async () => {
      const out = node.outputs.result;
      if (!out) return;
      out.socket = family === "frame"
        ? frameSocket
        : family === "cube"
          ? cubeSocket
          : resultSocket(node.lastResultRank === 2 ? "matrix" : "combo", family);
      const editor = getOwningEditor(node.id);
      const view = getOwningView(node.id);
      if (editor?.getNode(node.id)) await retypeOutputCables(editor, view, node.id, "result");
      await view?.rerenderNode(node.id);
    })();
  });
}

export class ExpressionNode extends ClassicPreset.Node {
  unitAware = true;
  label: string;
  expr: string;
  locked: boolean;
  resultAs: ResultType;
  cachedResult: unknown = null;
  cachedError: string | null = null;
  literals: Record<string, number> = {};
  width  = 220;
  height = 210;

  varNames: string[]  = [];
  varDescriptions: Record<string, string> = {};
  /** A preset's input units: the formula reads that variable's number in this unit ([[C25]] firstClassUnits). */
  varUnits: Record<string, string> = {};
  lastResultRank: 1 | 2 = 1;

  constructor(init?: { label?: string; expr?: string; locked?: boolean; resultAs?: ResultType; literals?: Record<string, number>; varDescriptions?: Record<string, string>; varUnits?: Record<string, string> }) {
    super("Expression");
    this.label = init?.label ?? "Expression";
    this.expr  = init?.expr  ?? "";
    this.locked = init?.locked ?? false;
    this.resultAs = init?.resultAs ?? "number";
    if (init?.literals) this.literals = { ...init.literals };
    if (init?.varDescriptions) this.varDescriptions = { ...init.varDescriptions };
    if (init?.varUnits) this.varUnits = { ...init.varUnits };

    this.addOutput("result", resultOut("Result", "combo", this.resultAs));
    this._rebuild();
  }

  _rebuild(): { added: string[]; removed: string[] } {
    const prev = new Set(this.varNames);
    const next = extractVariables(this.expr);
    const nextSet = new Set(next);

    const added:   string[] = [];
    const removed: string[] = [];

    for (const v of next) {
      if (!prev.has(v)) {
        this.addInput(v, anyDataIn(v));
        added.push(v);
      }
    }
    for (const v of prev) {
      if (!nextSet.has(v)) {
        removed.push(v);
      }
    }

    this.varNames = next;
    return { added, removed };
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    const rank = this.lastResultRank;
    const out = nodeOnCore(this, inputs) as { result: unknown };
    if (this.lastResultRank !== rank) retypeResult(this, this.resultAs);
    return out;
  }
}
