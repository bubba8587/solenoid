// [[C25]] firstClassUnits, [[C118]] formatTravelsWithValue
import type { GraphEditor } from "../graphEditor";
import { GraphConnection, GraphInput, GraphNode, GraphOutput } from "../graphModel";
import { formatAnnotationStore, isDateStyle, type FormatStyleId, type FormatAnnotation, type TextCase, type TextAlign, type DecimalMode, type LogicalStyle, type LambdaView, type NegativeStyle, type ScaleMode } from "../formatAnnotationStore";
import { sharedAnnotationResolver } from "../unitFlow";
import { dockedNodeStore } from "../dockedNodeStore";
import { nodeOnCore } from "../nodeOnCore";
import { staysOffCore } from "./display";
import { MutableSocket, isDateType, isWildcardRung, type SocketDataType } from "../sockets";

export class FormatControllerNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    in: "The format applies to the box feeding this input, and clears when it's disconnected.",
    out: "The unit rides the value out, and the display format follows it across downstream passthrough boxes.",
  };
  /** The Convert this FC feeds names its from-unit at run time, which no save keeps. */
  static coreFields = ["dictatedFromUnit"] as const;

  label: string;
  hostNodeId: string;
  socketKey: string;
  side: "input" | "output";
  format: FormatStyleId;
  customPattern: string;
  decimalDigits: number;
  decimalMode: DecimalMode;
  unit: string;
  customUnit: string;
  textCase: TextCase;
  bold: boolean;
  italic: boolean;
  textScale: number;
  textAlign: TextAlign;
  textMarkdown: boolean;
  textMono: boolean;
  chip: boolean;
  logicalStyle: LogicalStyle;
  lambdaView: LambdaView;
  chartFontScale: number;
  grouping: boolean;
  negativeStyle: NegativeStyle;
  scaleMode: ScaleMode;
  advancedOpen: boolean;
  inheritFormat: boolean;
  inheritedAnnotation?: FormatAnnotation;
  socketDataType: SocketDataType = "trueany";
  private _written: Array<{ nodeId: string; socketKey: string }> = [];
  forwarding = false;
  lockedByConvert = false;
  unitLocked = false;
  dictatedFromUnit = "";
  unitAware = true;
  width = 116;
  height = 64;

  private readonly _inSock  = new MutableSocket("trueany");
  private readonly _outSock = new MutableSocket("trueany");

  constructor(init?: {
    label?: string;
    hostNodeId?: string;
    socketKey?: string;
    side?: "input" | "output";
    format?: FormatStyleId;
    customPattern?: string;
    decimalDigits?: number;
    decimalMode?: DecimalMode;
    unit?: string;
    customUnit?: string;
    textCase?: TextCase;
    bold?: boolean;
    italic?: boolean;
    textScale?: number;
    textAlign?: TextAlign;
    textMarkdown?: boolean;
    textMono?: boolean;
    chip?: boolean;
    logicalStyle?: LogicalStyle;
    lambdaView?: LambdaView;
    chartFontScale?: number;
    grouping?: boolean;
    negativeStyle?: NegativeStyle;
    scaleMode?: ScaleMode;
    advancedOpen?: boolean;
    inheritFormat?: boolean;
    socketDataType?: SocketDataType;
  }) {
    super("FormatController");
    this.label = init?.label ?? "Format Controller";
    this.hostNodeId = init?.hostNodeId ?? "";
    this.socketKey  = init?.socketKey  ?? "";
    this.side       = init?.side       ?? "output";
    this.format     = init?.format     ?? "auto";
    this.customPattern = init?.customPattern ?? "0.00";
    this.decimalDigits = init?.decimalDigits ?? 2;
    this.decimalMode   = init?.decimalMode   ?? "places";
    this.unit       = init?.unit       ?? "none";
    this.customUnit = init?.customUnit ?? "";
    this.textCase   = init?.textCase   ?? "none";
    this.bold       = init?.bold       ?? false;
    this.italic     = init?.italic     ?? false;
    this.textScale  = init?.textScale  ?? 14;
    this.textAlign    = init?.textAlign    ?? "right";
    this.textMarkdown = init?.textMarkdown ?? false;
    this.textMono     = init?.textMono     ?? false;
    this.chip         = init?.chip         ?? false;
    this.logicalStyle = init?.logicalStyle ?? "truefalse";
    this.lambdaView     = init?.lambdaView     ?? "signature";
    this.chartFontScale = init?.chartFontScale ?? 1;
    this.grouping      = init?.grouping      ?? true;
    this.negativeStyle = init?.negativeStyle ?? "minus";
    this.scaleMode     = init?.scaleMode     ?? "none";
    this.advancedOpen  = init?.advancedOpen  ?? false;
    this.inheritFormat = init?.inheritFormat ?? false;
    if (init?.socketDataType) {
      this.socketDataType = init.socketDataType;
      this._inSock.setType(init.socketDataType);
      this._outSock.setType(init.socketDataType);
    }

    this.addInput("in",  new GraphInput(this._inSock, "In"));
    this.addOutput("out", new GraphOutput(this._outSock, "Out"));
  }

  /** Call once after editor.addNode (registration needs the node in the editor), then `reconcileFcs`. */
  dockSelf(editor: GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>): void {
    // [[B12]] losslessSaves: a saved host that no longer exists leaves a free FC, not a dock onto nothing.
    if (this.hostNodeId && !editor.getNode(this.hostNodeId)) this.releaseDock();
    if (!this.hostNodeId) return;
    dockedNodeStore.dock(this.id, {
      hostNodeId: this.hostNodeId,
      socketKey:  this.socketKey,
      side:       this.side,
    });
  }

  /** Never re-default `format` here: an off-family pick stays saved and is inert through effectiveFormat(). */
  private _applyType(dataType: SocketDataType): void {
    this.socketDataType = dataType;
    this._inSock.setType(dataType);
    this._outSock.setType(dataType);
  }

  effectiveFormat(): FormatStyleId {
    if (isWildcardRung(this.socketDataType)) return this.format;
    const isDate = isDateType(this.socketDataType);
    if (isDate && !isDateStyle(this.format)) return "date_dmy";
    if (!isDate && isDateStyle(this.format)) return "auto";
    return this.format;
  }

  /** Takes the reconcile's answer (`fc.rs`): its type, and the from-unit a Convert ahead dictates; `true` when retyped. */
  settle(type: SocketDataType, dictatedFromUnit: string): boolean {
    this.dictatedFromUnit = dictatedFromUnit;
    if (type === this.socketDataType) return false;
    this._applyType(type);
    return true;
  }

  refreshAnnotation(
    editor: GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>,
  ): void {
    let inSrcId = "", inSrcSock = "";
    for (const c of editor.getConnections()) {
      if (c.target === this.id && c.targetInput === "in") { inSrcId = c.source; inSrcSock = c.sourceOutput; break; }
    }

    const targets: Array<{ nodeId: string; socketKey: string }> = [];
    if (inSrcId) targets.push({ nodeId: inSrcId, socketKey: inSrcSock });

    this.inheritedAnnotation = this.inheritFormat && inSrcId
      ? sharedAnnotationResolver(editor).outAnnotation(inSrcId, inSrcSock)
      : undefined;
    const ann = this.resolveAnnotation(this.inheritedAnnotation);
    for (const w of this._written) {
      if (!targets.some((t) => t.nodeId === w.nodeId && t.socketKey === w.socketKey)) {
        formatAnnotationStore.delete(w.nodeId, w.socketKey);
      }
    }
    for (const t of targets) formatAnnotationStore.set(t.nodeId, t.socketKey, ann);
    this._written = targets;
  }

  /** Chip, inherit and the letter cases share one style dropdown, so a pick clears the others. */
  pickTextStyle(pick: TextCase | "" | "chip"): void {
    this.chip = pick === "chip";
    this.inheritFormat = pick === "";
    if (pick === "chip") this.textCase = "none";
    else if (pick !== "") this.textCase = pick;
  }

  annotation(): FormatAnnotation {
    return {
      format:        this.effectiveFormat(),
      customPattern: this.customPattern,
      decimalDigits: this.decimalDigits,
      decimalMode:   this.decimalMode,
      unit:          this.unit,
      customUnit:    this.customUnit,
      textCase:      this.textCase,
      bold:          this.bold,
      italic:        this.italic,
      textScale:     this.textScale,
      textAlign:     this.textAlign,
      textMarkdown:  this.textMarkdown,
      textMono:      this.textMono,
      chip:          this.chip,
      logicalStyle:  this.logicalStyle,
      lambdaView:    this.lambdaView,
      chartFontScale: this.chartFontScale,
      grouping:      this.grouping,
      negativeStyle: this.negativeStyle,
      scaleMode:     this.scaleMode,
    };
  }

  resolveAnnotation(inherited: FormatAnnotation | undefined): FormatAnnotation {
    if (this.inheritFormat && inherited) {
      return { ...inherited, unit: this.unit, customUnit: this.customUnit };
    }
    return this.annotation();
  }

  annotatedSocket(): { nodeId: string; socketKey: string } | null {
    return this._written[0] ?? null;
  }

  undock(): void {
    for (const w of this._written) formatAnnotationStore.delete(w.nodeId, w.socketKey);
    this._written = [];
    dockedNodeStore.undock(this.id);
    this.hostNodeId = "";
    this.socketKey = "";
  }

  /** Clear hostNodeId, or a load-time dockSelf() resurrects the dock from the saved stale id. */
  releaseDock(): void {
    dockedNodeStore.undock(this.id);
    this.hostNodeId = "";
    this.socketKey = "";
  }

  data(inputs: Record<string, unknown[] | undefined>): { out: unknown } {
    const raw = inputs.in?.[0];
    // A value the core can't take back holds no unit: the card reads it as a blank and hands it on.
    return staysOffCore(raw) ? (nodeOnCore(this, { ...inputs, in: [null] }), { out: raw }) : (nodeOnCore(this, inputs) as { out: unknown });
  }

  /** The unit the card shows: the Convert's from-unit, else the one the value carries in. The card keeps it. */
  adoptedUnit = "none";
}
