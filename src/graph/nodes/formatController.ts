// [[C25]] firstClassUnits, [[D40]] unitOnValue, [[D41]] formatFlowsDownstream, [[C94]] formatFamilyGates
import { ClassicPreset, type NodeEditor } from "rete";
import { formatAnnotationStore, isDateStyle, isFcUnit, type FormatStyleId, type FormatAnnotation, type TextCase, type TextAlign, type DecimalMode, type LogicalStyle, type LambdaView, type NegativeStyle, type ScaleMode } from "../formatAnnotationStore";
import { sharedAnnotationResolver } from "../unitFlow";
import { applyFcUnit, fcUnitIdForUnit } from "../unitBridge";
import { isPurePassthroughNode } from "./passthrough";
import { isUnitCell, matrixUnitOf, type UnitCell } from "../unitValue";
import { dockedNodeStore } from "../dockedNodeStore";
import { SolenoidSocket, isDateType, isWildcardRung, type SocketDataType } from "../sockets";

/** The unit a value already carries: a scalar or list's first dimensioned cell, or a matrix's grid unit. */
function heldUnit(v: unknown): Pick<UnitCell, "dim" | "display"> | null {
  if (isUnitCell(v)) return v;
  if (Array.isArray(v) && !Array.isArray(v[0])) {
    for (const c of v) if (isUnitCell(c)) return c;
  }
  return matrixUnitOf(v) ?? null;
}

class MutableSocket extends SolenoidSocket {
  constructor(type: SocketDataType) { super(type); }
  setType(type: SocketDataType) {
    // Readonly in the type only; this instance belongs to one port.
    (this as unknown as { dataType: SocketDataType }).dataType = type;
  }
}

type FcEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;

function concreteTypeOfOutput(editor: FcEditor, nodeId: string, outKey: string, seen = new Set<string>()): SocketDataType {
  const key = `${nodeId}::${outKey}`;
  if (seen.has(key)) return "trueany";
  seen.add(key);
  const sock = editor.getNode(nodeId)?.outputs[outKey]?.socket;
  if (sock instanceof SolenoidSocket && !isWildcardRung(sock.dataType)) return sock.dataType;
  for (const c of editor.getConnections()) {
    if (c.target === nodeId) {
      const t = concreteTypeOfOutput(editor, c.source, c.sourceOutput, seen);
      if (!isWildcardRung(t)) return t;
    }
  }
  return "trueany";
}

export class FormatControllerNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "The format applies to the box feeding this input, and clears when it's disconnected.",
    out: "The unit rides the value out, and the display format follows it across downstream passthrough boxes.",
  };

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

    this.addInput("in",  new ClassicPreset.Input(this._inSock, "In"));
    this.addOutput("out", new ClassicPreset.Output(this._outSock, "Out"));
  }

  /** Call once after editor.addNode: registration needs the id Rete assigns there. */
  dockSelf(editor: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>): void {
    // [[B12]] losslessSaves: a saved host that no longer exists leaves a free FC, not a dock onto nothing.
    if (this.hostNodeId && !editor.getNode(this.hostNodeId)) this.releaseDock();
    if (!this.hostNodeId) return;
    dockedNodeStore.dock(this.id, {
      hostNodeId: this.hostNodeId,
      socketKey:  this.socketKey,
      side:       this.side,
    });
    this.adaptTypeFromConnections(editor);
    this.refreshAnnotation(editor);
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

  adaptTypeFromConnections(
    editor: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>,
  ): boolean {
    let resolved: SocketDataType = "trueany";
    if (this.hostNodeId) {
      if (this.side === "output") {
        resolved = concreteTypeOfOutput(editor, this.hostNodeId, this.socketKey);
      } else {
        const sock = editor.getNode(this.hostNodeId)?.inputs[this.socketKey]?.socket;
        if (sock instanceof SolenoidSocket && !isWildcardRung(sock.dataType)) resolved = sock.dataType;
      }
    } else {
      for (const c of editor.getConnections()) {
        if (c.target === this.id && c.targetInput === "in") {
          const t = concreteTypeOfOutput(editor, c.source, c.sourceOutput);
          if (!isWildcardRung(t)) { resolved = t; break; }
        } else if (c.source === this.id && c.sourceOutput === "out") {
          const sock = editor.getNode(c.target)?.inputs[c.targetInput]?.socket;
          if (sock instanceof SolenoidSocket && !isWildcardRung(sock.dataType)) { resolved = sock.dataType; break; }
        }
      }
    }
    if (resolved === this.socketDataType) return false;
    this._applyType(resolved);
    this.refreshAnnotation(editor);
    return true;
  }

  refreshAnnotation(
    editor: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>,
  ): void {
    let inSrcId = "", inSrcSock = "";
    for (const c of editor.getConnections()) {
      if (c.target === this.id && c.targetInput === "in") { inSrcId = c.source; inSrcSock = c.sourceOutput; break; }
    }

    this.dictatedFromUnit = "";
    {
      let nid = this.id, depth = 0;
      walk: while (nid && depth++ < 32) {
        let next = "";
        for (const c of editor.getConnections()) {
          if (c.source !== nid) continue;
          const consumer = editor.getNode(c.target) as unknown as Record<string, unknown> | undefined;
          if (!consumer) continue;
          if (typeof consumer.fromUnit === "string" && typeof consumer.toUnit === "string") {
            this.dictatedFromUnit = consumer.fromUnit as string;
            break walk;
          }
          if (isPurePassthroughNode(consumer)) { next = c.target; break; }
        }
        nid = next;
      }
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

  data(inputs: { in?: unknown[] }): { out: unknown } {
    const val = inputs.in?.[0] ?? null;
    const cell = heldUnit(val);
    const inherited = cell ? cell.display ?? fcUnitIdForUnit({ dim: cell.dim, scale: 1 }) : undefined;
    const dictated = this.dictatedFromUnit && isFcUnit(this.dictatedFromUnit) ? this.dictatedFromUnit : "";
    if (dictated && this.unit === "none") this.unit = dictated;
    this.lockedByConvert = dictated !== "" && this.unit === dictated;
    this.forwarding = !!cell && !this.lockedByConvert;
    if (this.forwarding && inherited && isFcUnit(inherited) && this.unit !== inherited) this.unit = inherited;
    this.unitLocked = this.lockedByConvert || this.forwarding;
    return { out: applyFcUnit(val, this.unit, this.customUnit) };
  }
}
