// [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream, [[C24]] arraySemantics
import type { GraphEditor } from "../graphEditor";
import { GraphConnection, GraphNode } from "../graphModel";
import { numListIn, numListOut } from "./shared";
import { isFcUnit, type FormatStyle } from "../formatAnnotationStore";
import { registerDisplayUnits } from "../unitBridge";
import { type SolError } from "../errorValue";
import { CONVERT_UNIT_DEFS } from "./convertUnits";
import { nodeOnCore } from "../nodeOnCore";
export { CONVERT_UNIT_DEFS, convertValue, convertUnitKey, CONVERT_CATEGORY_LABELS, type ConvertCategory, type ConvertUnitDef } from "./convertUnits";
import { type UnitCell } from "../unitValue";


registerDisplayUnits(Object.fromEntries(Object.entries(CONVERT_UNIT_DEFS).map(([id, d]) => [id, d.dim])));


export class ConvertNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    in: "From applies only to plain numbers. A value with a unit keeps its magnitude and is relabeled when the dimensions match, #UNIT! when they differ.",
  };

  unitAware = true;
  label: string;
  fromUnit: string;
  toUnit: string;
  inFormat: FormatStyle = "auto";
  outFormat: FormatStyle = "auto";
  cachedInput: number | number[] | UnitCell | (number | UnitCell)[] | null = null;
  cachedResult: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null = null;
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

  get unit(): string {
    return isFcUnit(this.toUnit) ? this.toUnit : "none";
  }

  syncUnitArrows(
    editor: GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>,
  ): void {
    let up = false, down = false;
    for (const c of editor.getConnections()) {
      if (c.target === this.id && c.targetInput === "in")    up = true;
      if (c.source === this.id && c.sourceOutput === "out")  down = true;
    }
    this.imposesUp = up;
    this.imposesDown = down;
  }

  data(inputs: Record<string, unknown[] | undefined>): { out: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null } {
    return nodeOnCore(this, inputs) as { out: number | UnitCell | (number | UnitCell | SolError | null)[] | SolError | null };
  }
}
