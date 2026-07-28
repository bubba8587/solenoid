import { ClassicPreset, type NodeEditor } from "rete";
import { broadcastUnit, numListIn, numListOut, type UnitOperand } from "./shared";
import { isFcUnit, type FormatStyle } from "../formatAnnotationStore";
import { registerDisplayUnits, fcUnitToUnit } from "../unitBridge";
import { solError, type SolError } from "../errorValue";
import { commensurable, dimEqual, formatDim, type Unit } from "../dimension";
import { CONVERT_UNIT_DEFS, convertValue } from "./convertUnits";
export { CONVERT_UNIT_DEFS, convertValue, CONVERT_CATEGORY_LABELS, type ConvertCategory, type ConvertUnitDef } from "./convertUnits";
import { isUnitCell, fromUnit, withDisplay, unitError, type UnitCell } from "../unitValue";

// ─── Convert ─────────────────────────────────────────────────────────────────
// Excel equivalent: =CONVERT(number, from_unit, to_unit)
//
// The conversion MATH is delegated to the dimensional-algebra core (dimension.ts,
// Bundle 05) — the single source of truth for unit magnitudes. Each unit here
// gets a `dim` Unit (dimension vector + SI scale); `convertValue` runs through
// `dimConvert`, and the cross-family guard is a real commensurability check
// (m² vs m is now caught by unequal dimension vectors, not just a category
// label). The `category` stays for the dropdown's grouping + the legacy
// toBase/fromBase pair for any direct caller.

registerDisplayUnits(Object.fromEntries(Object.entries(CONVERT_UNIT_DEFS).map(([id, d]) => [id, d.dim])));


export class ConvertNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  fromUnit: string;
  toUnit: string;
  // Convert's own display formats for its in/out boxes (independent of any FC).
  inFormat: FormatStyle = "auto";
  outFormat: FormatStyle = "auto";
  cachedInput: number | number[] | UnitCell | (number | UnitCell)[] | null = null;
  cachedResult: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
  // Convert is a hybrid node+FC with primacy over units in an FC→Convert→FC
  // chain: its own from/to dropdowns are the authority and dictate the units of
  // adjacent FCs (upstream FC locks to fromUnit, downstream FC locks to toUnit).
  // These flags say whether such an FC is actually attached, so the node can
  // show the imposing-arrow markers (◀ toward its input, ▶ toward its output).
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

  /**
   * Convert's output carries its toUnit forward — a downstream FC locks to it,
   * exactly as it would to an upstream FC. Exposed as `unit` (an FC unit id) so
   * FC.refreshAnnotation can treat Convert as a unit forwarder. "none" when the
   * toUnit has no matching FC unit.
   */
  get unit(): string {
    return isFcUnit(this.toUnit) ? this.toUnit : "none";
  }

  /**
   * Convert always imposes its unit semantics: it reads its input as fromUnit
   * and emits toUnit. That push is a property of the value (unitFlow carries
   * toUnit downstream on its own — it does NOT need an adjacent FC), so the
   * arrows track whether each socket is simply connected, not whether an FC is
   * sitting next to it. A downstream FC anywhere past here still locks to toUnit.
   */
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
    // Cross-family conversion (meters → kilograms) measures different things —
    // Excel's CONVERT returns #N/A. This is the NODE's unit pick, not a per-cell
    // condition, so it's a whole-value error at every dimensionality (a scalar OR
    // an entire list becomes #N/A — no point per-celling a node-level mistake).
    const from = CONVERT_UNIT_DEFS[this.fromUnit];
    const to   = CONVERT_UNIT_DEFS[this.toUnit];
    // Incommensurable units (meters → kilograms, m² → m) measure different
    // things — a real dimension-vector check, not just a category label. Excel's
    // CONVERT returns #N/A; kept as #N/A (not #UNIT!) so IFNA/ISNA still catch a
    // bad Convert pick, matching the node's long-standing contract.
    if (from && to && !commensurable(from.dim, to.dim)) {
      const err = solError("#N/A", `Can't convert ${from.category} to ${to.category}: the units measure different things`);
      this.cachedResult = err;
      return { out: err };
    }
    // A same-family conversion whose result overflows is #OVERFLOW!, tagged per-cell
    // in a list exactly as the scalar tags (array-semantics: lists carry per-cell
    // errors).
    const rangeErr = () => solError("#OVERFLOW!", "The converted value is too large to represent");
    // FC A4 — Convert AUTHORS the value's unit: its output is a base-SI `UnitCell`
    // tagged with toUnit's dimension + display (so a downstream Display renders the
    // converted number and a downstream FC agrees on the value's unit). `display`
    // is the toUnit key when it maps to an FC unit id, else undefined (derived
    // symbol). A bare input is interpreted through fromUnit → toUnit; an ALREADY
    // dimensioned input (from an upstream FC) is base-SI, so Convert just re-labels
    // it to toUnit when commensurable, else the source clashes with the target.
    const toDim: Unit | undefined = to?.dim;
    // Any registered id works as a display (the bridge resolves Convert's own ids
    // too), so Convert's toUnit ALWAYS wins on the outgoing value's rendering.
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
