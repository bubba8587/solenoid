import { ClassicPreset, type NodeEditor } from "rete";
import { formatAnnotationStore, isDateStyle, isFcUnit, type FormatStyleId, type FormatAnnotation, type TextCase, type TextAlign, type DecimalMode, type LogicalStyle, type LambdaView, type NegativeStyle, type ScaleMode } from "../formatAnnotationStore";
import { applyFcUnit, fcUnitIdForUnit } from "../unitBridge";
import { isPurePassthroughNode } from "./passthrough";
import { isUnitCell, type UnitCell } from "../unitValue";
import { dockedNodeStore } from "../dockedNodeStore";
import { SolenoidSocket, isDateType, isWildcardRung, type SocketDataType } from "../sockets";

/** The first dimensioned cell in a scalar-or-list value — the lock-state probe:
 *  its presence means an upstream (FC / Convert / unit source) authored the unit. */
function firstUnitCell(v: unknown): UnitCell | null {
  if (isUnitCell(v)) return v;
  if (Array.isArray(v) && !Array.isArray(v[0])) {
    for (const c of v) if (isUnitCell(c)) return c;
  }
  return null;
}

// Each FC owns its socket instances, so setType never mutates a shared singleton.
class MutableSocket extends SolenoidSocket {
  constructor(type: SocketDataType) { super(type); }
  setType(type: SocketDataType) {
    // dataType is readonly in the type signature but we own this instance.
    (this as unknown as { dataType: SocketDataType }).dataType = type;
  }
}

type FcEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;

// The concrete type on an output socket, resolved THROUGH passthrough wildcards, so
// an FC on a Display fed by a Text input adapts to text, not number.
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
    in: "The format lands on the box feeding this input and clears when the cable is removed.",
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
  logicalStyle: LogicalStyle;
  lambdaView: LambdaView;
  chartFontScale: number;
  grouping: boolean;
  negativeStyle: NegativeStyle;
  scaleMode: ScaleMode;
  advancedOpen: boolean;
  socketDataType: SocketDataType = "trueany";
  // Sockets this FC currently annotates — tracked so they clear when the wiring
  // changes. Docking is positional only; the wiring decides all of this.
  private _written: Array<{ nodeId: string; socketKey: string }> = [];
  // Unit inherited from the value flowing in; drives the → inward marker.
  forwarding = false;
  // Unit dictated by a Convert this FC FEEDS; drives the ← ← marker.
  lockedByConvert = false;
  // True whenever the unit dropdown is locked (forwarding OR lockedByConvert).
  unitLocked = false;
  // Convert primacy: the FC must tag the value in the unit the downstream Convert
  // will read it as, or the interpretation forks. Computed in refreshAnnotation.
  dictatedFromUnit = "";
  // The FC re-displays / clash-checks incoming `UnitCell` tags, so they must survive
  // the unit-blind boundary.
  unitAware = true;
  // Initial docking-position estimates; NodeCard's ResizeObserver corrects them to
  // the real rendered size after first paint.
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
    logicalStyle?: LogicalStyle;
    lambdaView?: LambdaView;
    chartFontScale?: number;
    grouping?: boolean;
    negativeStyle?: NegativeStyle;
    scaleMode?: ScaleMode;
    advancedOpen?: boolean;
    socketDataType?: SocketDataType;
  }) {
    super("FormatController");
    this.label = init?.label ?? "Format";
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
    this.logicalStyle = init?.logicalStyle ?? "truefalse";
    this.lambdaView     = init?.lambdaView     ?? "signature";
    this.chartFontScale = init?.chartFontScale ?? 1;
    this.grouping      = init?.grouping      ?? true;
    this.negativeStyle = init?.negativeStyle ?? "minus";
    this.scaleMode     = init?.scaleMode     ?? "none";
    this.advancedOpen  = init?.advancedOpen  ?? false;
    if (init?.socketDataType) {
      this.socketDataType = init.socketDataType;
      this._inSock.setType(init.socketDataType);
      this._outSock.setType(init.socketDataType);
    }

    this.addInput("in",  new ClassicPreset.Input(this._inSock, "In"));
    this.addOutput("out", new ClassicPreset.Output(this._outSock, "Out"));
  }

  /** Call once AFTER editor.addNode — registration needs the id Rete assigns there. */
  dockSelf(editor?: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>): void {
    if (this.hostNodeId) {
      dockedNodeStore.dock(this.id, {
        hostNodeId: this.hostNodeId,
        socketKey:  this.socketKey,
        side:       this.side,
      });
      if (editor) {
        this.adaptTypeFromConnections(editor);
        this.refreshAnnotation(editor);
      }
    }
  }

  /** Mirrors the type onto both sockets. The PICK (`format`) is never touched here: a
   *  value typed only at run time (a Script output) passes through a wildcard and then
   *  its construction-time family before the real type arrives, and re-defaulting on
   *  each hop destroyed a saved date style. A pick outside the socket's family is inert
   *  instead — `effectiveFormat()` falls back to the family default while it lasts. */
  private _applyType(dataType: SocketDataType): void {
    this.socketDataType = dataType;
    this._inSock.setType(dataType);
    this._outSock.setType(dataType);
  }

  /** The style that actually applies: the pick when it fits the socket's family, else
   *  the family default (a date socket on a number style would render a raw serial; a
   *  number socket on a date style would render nonsense). A wildcard has no family, so
   *  the pick stands. */
  effectiveFormat(): FormatStyleId {
    if (isWildcardRung(this.socketDataType)) return this.format;
    const isDate = isDateType(this.socketDataType);
    if (isDate && !isDateStyle(this.format)) return "date_dmy";
    if (!isDate && isDateStyle(this.format)) return "auto";
    return this.format;
  }

  /** Adopt the concrete type this FC is attached to (docked host socket or cables),
   *  resolving through passthrough wildcards; resets to the wildcard when none. */
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
    if (resolved === this.socketDataType) return false; // no change → don't churn renders
    this._applyType(resolved);
    this.refreshAnnotation(editor);
    return true;
  }

  /** The annotation lives only while FC.in is connected, so breaking the cable
   *  reverts the upstream's display; docking is irrelevant, only wiring matters. */
  refreshAnnotation(
    editor: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>,
  ): void {
    let inSrcId = "", inSrcSock = "";
    for (const c of editor.getConnections()) {
      if (c.target === this.id && c.targetInput === "in") { inSrcId = c.source; inSrcSock = c.sourceOutput; break; }
    }

    // "Do I FEED a Convert?" is the one graph fact data() can't see — computed here,
    // where the editor is at hand.
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

    // Format ALWAYS lands on the box feeding this FC's input; the value carries its
    // own unit, so this write only supplies the number FORMAT.
    const targets: Array<{ nodeId: string; socketKey: string }> = [];
    if (inSrcId) targets.push({ nodeId: inSrcId, socketKey: inSrcSock });

    const ann = this.annotation();
    for (const w of this._written) {
      if (!targets.some((t) => t.nodeId === w.nodeId && t.socketKey === w.socketKey)) {
        formatAnnotationStore.delete(w.nodeId, w.socketKey);
      }
    }
    for (const t of targets) formatAnnotationStore.set(t.nodeId, t.socketKey, ann);
    this._written = targets;
  }

  /** The format+unit this FC LOCKS onto the value; `makeAnnotationResolver` carries
   *  it forward so a downstream passthrough box needs no trailing FC of its own. */
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
      logicalStyle:  this.logicalStyle,
      lambdaView:    this.lambdaView,
      chartFontScale: this.chartFontScale,
      grouping:      this.grouping,
      negativeStyle: this.negativeStyle,
      scaleMode:     this.scaleMode,
    };
  }

  /** A socket this FC currently annotates (the first, for mismatch checks). */
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

  /** Forget the dock IDENTITY but keep the annotation; hostNodeId MUST be cleared or
   *  a load-time dockSelf() resurrects the dock from the saved stale id. */
  releaseDock(): void {
    dockedNodeStore.undock(this.id);
    this.hostNodeId = "";
    this.socketKey = "";
  }

  data(inputs: { in?: unknown[] }): { out: unknown } {
    const val = inputs.in?.[0] ?? null;
    const cell = firstUnitCell(val);
    const inherited = cell ? cell.display ?? fcUnitIdForUnit({ dim: cell.dim, scale: 1 }) : undefined;
    const dictated = this.dictatedFromUnit && isFcUnit(this.dictatedFromUnit) ? this.dictatedFromUnit : "";
    // Dictation fills an UNAUTHORED dropdown only — an authored unit stands, and a
    // real clash surfaces as the Convert's #UNIT! rather than a silent rewrite.
    if (dictated && this.unit === "none") this.unit = dictated;
    this.lockedByConvert = dictated !== "" && this.unit === dictated;
    this.forwarding = !!cell && !this.lockedByConvert;
    // Forwarding mirrors the inherited unit unconditionally: a stale pick under a
    // locked dropdown would read as a re-author in applyFcUnit.
    if (this.forwarding && inherited && isFcUnit(inherited) && this.unit !== inherited) this.unit = inherited;
    this.unitLocked = this.lockedByConvert || this.forwarding;
    return { out: applyFcUnit(val, this.unit, this.customUnit) };
  }
}
