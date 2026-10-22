// [[B11]] maximalMerge
import { ClassicPreset } from "rete";
import { type SocketDataType } from "../sockets";
import { trueAnyIn, strIn, numListOut, strComboOut, dateComboOut, complexOut, logicalComboOut } from "./shared";
import { type Cx } from "./complex";

import { type SolError } from "../errorValue";
import { fcUnitToUnit } from "../unitBridge";
import { fcUnitAnnotations } from "../formatAnnotationStore";
import type { Dim } from "../dimension";
import { getOwningEditor } from "../activeGraph";
import { nodeOnCore } from "../nodeOnCore";

export type CastTarget = "number" | "text" | "date" | "complex" | "logical";

export const CAST_TARGET_META: Record<CastTarget, { label: string; title: string }> = {
  number:  { label: "Number",  title: "Parse text, a logical's 1/0, or a complex value's real part. Pass numbers through" },
  text:    { label: "Text",    title: "Format numbers and dates (with the format pattern) or complex values as text" },
  date:    { label: "Date",    title: "Parse date text to an Excel serial. Numbers pass through as serials" },
  complex: { label: "Complex", title: "Parse \"a+bi\" text. Numbers become re+0i" },
  logical: { label: "Boolean", title: "Parse TRUE/FALSE text (or a nonzero number) to a logical TRUE/FALSE" },
};

export function castOutput(target: CastTarget) {
  switch (target) {
    case "number":  return numListOut("Number");
    case "text":    return strComboOut("Text");
    case "date":    return dateComboOut("Date");
    case "complex": return complexOut("Complex");
    case "logical": return logicalComboOut("Boolean");
  }
}

type CastScalar = number | string | Cx | boolean | null;

/** The typed-in arguments each target takes ([[B11]] maximalMerge: Cast absorbs the NUMBERVALUE card's separators and TEXT's format). */
const CAST_TARGET_INPUTS: Record<CastTarget, readonly { key: string; label: string }[]> = {
  text: [{ key: "format", label: "Format" }],
  number: [{ key: "decimal_sep", label: "Decimal" }, { key: "group_sep", label: "Group" }],
  date: [],
  complex: [],
  logical: [],
};

export class CastNode extends ClassicPreset.Node {
  /** What an empty separator field reads as, shown as its placeholder ([[D96]] emptySlotShowsItsValue). */
  static fieldPlaceholders: Record<string, string> = { decimal_sep: ".", group_sep: "," };
  static socketDocs: Record<string, string> = {
    value: "A date keeps its date type, so casting it to text formats it as a date.",
    format: "A pattern like 0.00, 0.00% or YYYY-MM-DD. Blank is the plain text. Excel: TEXT.",
    decimal_sep: "Defaults to a period, so 1.234,56 reads with a comma here and a period as the group.",
    group_sep: "Defaults to a comma, or none when the decimal is a comma.",
    result: "A blank input stays blank rather than failing. A value that will not parse becomes #VALUE!, per cell in a list.",
  };

  /** Text names the value's unit; every other target reads the value as it shows, unit-blind. */
  unitAware = true;
  label: string;
  target: CastTarget;
  // Unset so the card shows each default as a placeholder.
  stringLiterals: Record<string, string> = {};
  cachedResult: number | (number | null | SolError)[] | string | (string | null)[] | boolean | (boolean | null | SolError)[] | SolError | null = null;
  width = 180; height = 190;

  constructor(init?: { label?: string; target?: CastTarget }) {
    super("Cast");
    this.label = init?.label ?? "Cast";
    this.target = init?.target ?? "text";
    this.addInput("value",  trueAnyIn("Value"));
    for (const { key, label } of CAST_TARGET_INPUTS[this.target]) this.addInput(key, strIn(label));
    this.addOutput("result", castOutput(this.target));
  }

  /** The target's own inputs that a switch to `next` removes; their cables go first. */
  keysDroppedBySwitch(next: CastTarget): string[] {
    const keep = new Set(CAST_TARGET_INPUTS[next].map((i) => i.key));
    return CAST_TARGET_INPUTS[this.target].map((i) => i.key).filter((k) => !keep.has(k));
  }

  /** Retargets in place; the caller owes the cable pruning before and `retypeOutputCables` after. */
  setTarget(next: CastTarget): void {
    if (next === this.target) return;
    for (const k of this.keysDroppedBySwitch(next)) this.removeInput(k);
    for (const { key, label } of CAST_TARGET_INPUTS[next]) if (!this.inputs[key]) this.addInput(key, strIn(label));
    this.target = next;
    const out = this.outputs.result;
    if (out) out.socket = castOutput(next).socket;
  }

  /** The source socket's type is the only witness telling a date serial from a number; the body reads it here. */
  static coreFields = ["sourceType", "unitLabels"] as const;
  get sourceType(): SocketDataType | null { return this.sourceKind(); }
  /** Text names a value's unit by the FC's label, and packs register theirs at run time: each unit's id, label,
   *  whether the label leads, and its dimension. */
  get unitLabels(): [string, string, boolean, Dim | null][] | undefined {
    if (this.target !== "text") return undefined;
    return fcUnitAnnotations().map((u) => [u.id, u.label, !!u.prefix, fcUnitToUnit(u.id)?.dim ?? null]);
  }

  private sourceKind(): SocketDataType | null {
    const editor = getOwningEditor(this.id);
    if (!editor) return null;
    const conn = editor.getConnections().find(
      (c) => c.target === this.id && c.targetInput === "value",
    );
    if (!conn) return null;
    const sock = editor.getNode(conn.source)?.outputs[conn.sourceOutput]?.socket;
    return sock && "dataType" in sock ? (sock as { dataType: SocketDataType }).dataType : null;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: CastScalar | (CastScalar | SolError)[] | SolError };
  }
}
