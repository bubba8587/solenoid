import { ClassicPreset, type NodeEditor } from "rete";
import { broadcastUnit, numListIn, numListOut, type UnitOperand } from "./shared";
import { isFcUnit, type FormatStyle } from "../formatAnnotationStore";
import { registerDisplayUnits, fcUnitToUnit } from "../unitBridge";
import { solError, type SolError } from "../errorValue";
import { commensurable, dimEqual, formatDim, type Unit } from "../dimension";
import { CONVERT_UNIT_DEFS, convertValue } from "./convertUnits";
export { CONVERT_UNIT_DEFS, convertValue, CONVERT_CATEGORY_LABELS, type ConvertCategory, type ConvertUnitDef } from "./convertUnits";
import { isUnitCell, fromUnit, withDisplay, unitError, type UnitCell } from "../unitValue";

// The conversion MATH belongs to dimension.ts — the single source of truth for unit
// magnitudes; `category` survives only for the dropdown's grouping.

registerDisplayUnits(Object.fromEntries(Object.entries(CONVERT_UNIT_DEFS).map(([id, d]) => [id, d.dim])));


export class ConvertNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "The From unit applies only to plain numbers. A value that already carries a unit keeps its magnitude and is relabeled when the dimensions match, or is #UNIT! when they differ.",
  };

  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  fromUnit: string;
  toUnit: string;
  inFormat: FormatStyle = "auto";
  outFormat: FormatStyle = "auto";
  cachedInput: number | number[] | UnitCell | (number | UnitCell)[] | null = null;
  cachedResult: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
  // In an FC→Convert→FC chain Convert's dropdowns are the authority; these flags
  // drive the imposing-arrow markers.
  imposesUp = false;
  imposesDown = false;
  width = 200;
  height = 300;

  constructor(init?: { label?: string; fromUnit?: string; toUnit?: string; inFormat?: FormatStyle; outFormat?: FormatStyle }) {
    super("Convert");
    this.label    = init?.label    ?? "Convert";
    this.fromUnit = init?.fromUnit ?? "deg";
    this.toUnit   = init?.toUnit   ?? "rad";
    if (init?.inFormat)  this.inFormat  = init.inFormat;
    if (init?.outFormat) this.outFormat = init.outFormat;
    this.addInput("in",  numListIn("In"));
    this.addOutput("out", numListOut("Out"));
  }

  /** The toUnit as an FC unit id, so FC.refreshAnnotation treats Convert as a unit
   *  forwarder; "none" when toUnit has no matching FC unit. */
  get unit(): string {
    return isFcUnit(this.toUnit) ? this.toUnit : "none";
  }

  /** The unit push is a property of the VALUE, so the arrows track whether each
   *  socket is connected at all, not whether an FC sits next to it. */
  syncUnitArrows(
    editor: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>,
  ): void {
    let up = false, down = false;
    for (const c of editor.getConnections()) {
      if (c.target === this.id && c.targetInput === "in")    up = true;
      if (c.source === this.id && c.sourceOutput === "out")  down = true;
    }
    this.imposesUp = up;
    this.imposesDown = down;
  }

  data(inputs: { in?: unknown[] }): { out: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null } {
    const x = (inputs.in?.[0] ?? null) as UnitOperand | UnitOperand[] | null;
    this.cachedInput = x;
    if (x === null) { this.cachedResult = null; return { out: null }; }
    // A bad unit pick is the NODE's, not a per-cell condition, so an entire list
    // becomes one #N/A.
    const from = CONVERT_UNIT_DEFS[this.fromUnit];
    const to   = CONVERT_UNIT_DEFS[this.toUnit];
    // Incommensurable units are #N/A, not #UNIT!, so IFNA/ISNA still catch a bad
    // Convert pick (and it matches Excel's CONVERT).
    if (from && to && !commensurable(from.dim, to.dim)) {
      const err = solError("#N/A", `Can't convert ${from.category} to ${to.category}: the units measure different things`);
      this.cachedResult = err;
      return { out: err };
    }
    // An overflowing conversion tags per-cell in a list, as array semantics require.
    const rangeErr = () => solError("#OVERFLOW!", "The converted value is too large to represent");
    // Convert AUTHORS the value's unit: a bare input runs fromUnit → toUnit, while an
    // already-dimensioned (base-SI) input is only re-labelled when commensurable.
    const toDim: Unit | undefined = to?.dim;
    // Convert's toUnit ALWAYS wins on the outgoing value's rendering.
    const display = fcUnitToUnit(this.toUnit) ? this.toUnit : undefined;
    const convertCell = (v: UnitOperand): number | UnitCell | SolError => {
      if (isUnitCell(v)) {
        if (toDim && dimEqual(v.dim, toDim.dim)) return display ? (withDisplay(v, display) as UnitCell) : v;
        return unitError(`This value is ${formatDim(v.dim) || "a plain number"}, but Convert targets ${formatDim(toDim?.dim ?? {}) || "a plain number"}.`);
      }
      const conv = convertValue(v, this.fromUnit, this.toUnit);
      if (conv === null) return rangeErr();
      return toDim ? fromUnit(conv, toDim, display) : conv;
    };
    const result = broadcastUnit(convertCell, x);
    this.cachedResult = result;
    return { out: result };
  }
}
