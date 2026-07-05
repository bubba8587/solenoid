import { ClassicPreset, type NodeEditor } from "rete";
import { formatAnnotationStore, isDateStyle, isFcUnit, type FormatStyleId, type FormatAnnotation, type TextCase, type DecimalMode, type LogicalStyle, type NegativeStyle, type ScaleMode } from "../formatAnnotationStore";
import { makeUnitResolver } from "../unitFlow";
import { dockedNodeStore } from "../dockedNodeStore";
import { SolenoidSocket, isDateType, type SocketDataType } from "../sockets";

// ─── Format Controller ────────────────────────────────────────────────────────
// Docks to a socket on a host node. Annotates it with a display format (how
// the number renders) and a unit label (physical/semantic tag for cable
// compatibility). Does not transform the value — pass-through only.

// Mutable socket wrapper: each FC owns its own socket instances so we can
// update the dataType without affecting any shared singleton.
class MutableSocket extends SolenoidSocket {
  constructor(type: SocketDataType) { super(type); }
  setType(type: SocketDataType) {
    // dataType is readonly in the type signature but we own this instance.
    (this as unknown as { dataType: SocketDataType }).dataType = type;
  }
}

type FcEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;

// The concrete data type carried on an output socket, resolving *through*
// passthrough "any" sockets — a Display (or other pass-through) declares its
// output as "any" but actually carries whatever feeds it. Walks back through the
// feeding node's inputs until a non-"any" socket is found, so an FC on a
// Display fed by a Text input adapts to text, not number.
function concreteTypeOfOutput(editor: FcEditor, nodeId: string, outKey: string, seen = new Set<string>()): SocketDataType {
  const key = `${nodeId}::${outKey}`;
  if (seen.has(key)) return "any";
  seen.add(key);
  const sock = editor.getNode(nodeId)?.outputs[outKey]?.socket;
  if (sock instanceof SolenoidSocket && sock.dataType !== "any") return sock.dataType;
  for (const c of editor.getConnections()) {
    if (c.target === nodeId) {
      const t = concreteTypeOfOutput(editor, c.source, c.sourceOutput, seen);
      if (t !== "any") return t;
    }
  }
  return "any";
}

export class FormatControllerNode extends ClassicPreset.Node {
  label: string;
  // Docked relationship (written to dockedNodeStore on construction)
  hostNodeId: string;
  socketKey: string;
  side: "input" | "output";
  // Format annotation
  format: FormatStyleId;
  customPattern: string;
  // Flexible "decimal" format: digit count + places-vs-sig-figs mode.
  decimalDigits: number;
  decimalMode: DecimalMode;
  unit: string;
  customUnit: string;
  // Text-socket display options (non-destructive).
  textCase: TextCase;
  bold: boolean;
  italic: boolean;
  textScale: number;
  // Logical-socket show-as (display only).
  logicalStyle: LogicalStyle;
  // Advanced tier (number family; behind the chip's expander).
  grouping: boolean;          // thousands separator
  negativeStyle: NegativeStyle;
  scaleMode: ScaleMode;       // show in K / M / B
  advancedOpen: boolean;      // the expander's persisted open/closed state
  // The resolved socket dataType of the host socket (drives accent color).
  socketDataType: SocketDataType = "any";
  // Sockets this FC currently writes annotations to. A normal FC (fed by a
  // regular node) writes one — its upstream (backward display). A "forwarding"
  // FC (fed by ANOTHER FC) instead writes its unit onto each downstream consumer
  // (units travel forward through a 2-FC chain). Tracked so they clear when the
  // wiring changes. Docking is positional only; the wiring decides all of this.
  private _written: Array<{ nodeId: string; socketKey: string }> = [];
  // True when this FC's unit is inherited from the value flowing into it (an
  // upstream FC/Convert, possibly through passthrough nodes). Drives the
  // "unit arrived from upstream" (→ inward) marker.
  forwarding = false;
  // True when this FC's unit is dictated by a Convert it *feeds* (Convert
  // primacy, from downstream) rather than inherited from upstream. Drives the
  // distinct "unit comes back from Convert" (← ←) marker.
  lockedByConvert = false;
  // True whenever the unit dropdown is locked (forwarding OR lockedByConvert).
  unitLocked = false;
  // Compact chip: stacked dropdowns, no header. These are the initial docking-
  // position estimates; NodeCard's ResizeObserver corrects them to the real
  // rendered size after first paint.
  width = 116;
  height = 64;

  private readonly _inSock  = new MutableSocket("any");
  private readonly _outSock = new MutableSocket("any");

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
    logicalStyle?: LogicalStyle;
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
    this.textScale  = init?.textScale  ?? 14; // px font size for text display
    this.logicalStyle = init?.logicalStyle ?? "truefalse";
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

    // Register with dockedNodeStore so Canvas positions us flush with the
    // host socket. Registration is deferred to after the node has an id
    // (set by Rete when addNode is called), so dockSelf() is called from
    // Canvas after addNode.
  }

  /**
   * Call this once after editor.addNode(node) to register the docked
   * relationship and snap the socket type to match the host socket.
   */
  dockSelf(editor?: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>): void {
    if (this.hostNodeId) {
      dockedNodeStore.dock(this.id, {
        hostNodeId: this.hostNodeId,
        socketKey:  this.socketKey,
        side:       this.side,
      });
      // Resolve the host socket's data type (through passthrough "any" sockets)
      // and mirror it onto our sockets.
      if (editor) {
        this.adaptTypeFromConnections(editor);
        this.refreshAnnotation(editor);
      }
    }
  }

  /**
   * Adopt a data type: mirror it onto the in/out sockets and pick a sensible
   * default format (a date socket left on the number default "auto" would
   * otherwise render a raw serial). Shared by dockSelf and connection adaption.
   */
  private _applyType(dataType: SocketDataType): void {
    this.socketDataType = dataType;
    this._inSock.setType(dataType);
    this._outSock.setType(dataType);
    const isDate = isDateType(dataType);
    if (isDate && !isDateStyle(this.format)) this.format = "date_dmy";
    else if (!isDate && isDateStyle(this.format)) this.format = "auto";
  }

  /**
   * Adopt the concrete type of whatever this FC is attached to — resolving
   * through passthrough "any" sockets (a Display fed by text reads as text).
   * Works for a docked FC (from its host socket) and a wired one (from its
   * cables); resets to "any" when nothing typed is attached.
   */
  adaptTypeFromConnections(
    editor: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>,
  ): boolean {
    let resolved: SocketDataType = "any";
    if (this.hostNodeId) {
      // Docked: resolve from the host socket.
      if (this.side === "output") {
        resolved = concreteTypeOfOutput(editor, this.hostNodeId, this.socketKey);
      } else {
        const sock = editor.getNode(this.hostNodeId)?.inputs[this.socketKey]?.socket;
        if (sock instanceof SolenoidSocket) resolved = sock.dataType;
      }
    } else {
      // Wired: resolve from the cable feeding FC.in (or the socket FC.out feeds).
      for (const c of editor.getConnections()) {
        if (c.target === this.id && c.targetInput === "in") {
          const t = concreteTypeOfOutput(editor, c.source, c.sourceOutput);
          if (t !== "any") { resolved = t; break; }
        } else if (c.source === this.id && c.sourceOutput === "out") {
          const sock = editor.getNode(c.target)?.inputs[c.targetInput]?.socket;
          if (sock instanceof SolenoidSocket && sock.dataType !== "any") { resolved = sock.dataType; break; }
        }
      }
    }
    if (resolved === this.socketDataType) return false; // no change → don't churn renders
    this._applyType(resolved);
    this.refreshAnnotation(editor);
    return true;
  }

  /**
   * Project this FC's display state onto the node feeding its input — its
   * upstream. The annotation lives only while FC.in is connected, so breaking
   * the cable reverts the upstream's display, and editing a disconnected FC
   * does nothing. Docking is irrelevant here: only the wiring matters.
   */
  refreshAnnotation(
    editor: NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>,
  ): void {
    // What feeds FC.in?
    let inSrcId = "", inSrcSock = "";
    for (const c of editor.getConnections()) {
      if (c.target === this.id && c.targetInput === "in") { inSrcId = c.source; inSrcSock = c.sourceOutput; break; }
    }
    // Is a unit already established on this FC's input? The resolver walks back
    // through the graph — past Displays and any passthrough node, not just an
    // immediate FC/Convert — so a unit stays locked all the way down a chain. An
    // FC with a unit on its input forwards it (a chain can re-format the value
    // but not re-unit it: 3/2 mi, never 3/2 km); an FC fed a unitless value is a
    // free author.
    const resolver = makeUnitResolver(editor);
    const inUnit = resolver.inUnit(this.id, "in");
    const fedByForwarder = inUnit !== "none";
    this.forwarding = fedByForwarder;

    // Does FC.out feed a Convert? Convert has primacy over units — it imposes its
    // fromUnit on the FC feeding it. The FC stays a backward display formatter
    // (keeps its ◀ marker), but its unit is dictated (locked, no extra arrow —
    // the imposing arrow lives on the Convert). Duck-typed: a Convert exposes
    // both fromUnit and toUnit strings; an FC does not.
    let convertFromUnit: string | undefined;
    if (!fedByForwarder) {
      for (const c of editor.getConnections()) {
        if (c.source === this.id && c.sourceOutput === "out") {
          const dst = editor.getNode(c.target) as { fromUnit?: string; toUnit?: string } | undefined;
          if (dst && typeof dst.fromUnit === "string" && typeof dst.toUnit === "string") {
            convertFromUnit = dst.fromUnit;
            break;
          }
        }
      }
    }

    this.unitLocked = false;
    this.lockedByConvert = false;
    if (fedByForwarder) {
      this.unit = inUnit;
      // Carry the custom-unit text from the immediate source when the forwarded
      // unit is "custom" (its label lives in customUnit, not the id).
      if (inUnit === "custom" && inSrcId) {
        const src = editor.getNode(inSrcId) as { customUnit?: string } | undefined;
        if (typeof src?.customUnit === "string") this.customUnit = src.customUnit;
      }
      this.unitLocked = true;
    } else if (convertFromUnit && convertFromUnit !== "none" && isFcUnit(convertFromUnit)) {
      this.unit = convertFromUnit;
      this.unitLocked = true;
      this.lockedByConvert = true;
    }

    // Format ALWAYS lands on the box feeding this FC's input — the box behind
    // it, in place, exactly like a docked FC. It never travels forward. The unit
    // is the only thing that flows downstream, and it does so through the value
    // itself (unitFlow), so a downstream FC locks to it without this FC pushing
    // anything onto it. A "forwarding" FC (unit inherited) therefore just formats
    // its input-side box — usually another FC's chip, i.e. nothing visible —
    // which is why a chain needs an FC *after* a box to format that box.
    const targets: Array<{ nodeId: string; socketKey: string }> = [];
    if (inSrcId) targets.push({ nodeId: inSrcId, socketKey: inSrcSock });

    const ann = this.annotation();
    // Reconcile: clear any socket we no longer target, (re)write the rest.
    for (const w of this._written) {
      if (!targets.some((t) => t.nodeId === w.nodeId && t.socketKey === w.socketKey)) {
        formatAnnotationStore.delete(w.nodeId, w.socketKey);
      }
    }
    for (const t of targets) formatAnnotationStore.set(t.nodeId, t.socketKey, ann);
    this._written = targets;
  }

  /**
   * This FC's display state as a FormatAnnotation. The format+unit it LOCKS onto the
   * value — written to the box behind it (refreshAnnotation), and resolved forward by
   * the annotation resolver (`makeAnnotationResolver`) so a downstream passthrough box
   * (Display, …) shows the same locked format without needing its own trailing FC.
   */
  annotation(): FormatAnnotation {
    return {
      format:        this.format,
      customPattern: this.customPattern,
      decimalDigits: this.decimalDigits,
      decimalMode:   this.decimalMode,
      unit:          this.unit,
      customUnit:    this.customUnit,
      textCase:      this.textCase,
      bold:          this.bold,
      italic:        this.italic,
      textScale:     this.textScale,
      logicalStyle:  this.logicalStyle,
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
    // Clear our annotations (reverts their displays) and stop following the
    // dock socket. Position fields are cleared last.
    for (const w of this._written) formatAnnotationStore.delete(w.nodeId, w.socketKey);
    this._written = [];
    dockedNodeStore.undock(this.id);
    this.hostNodeId = "";
    this.socketKey = "";
  }

  data(inputs: { in?: unknown[] }): { out: unknown } {
    const val = inputs.in?.[0] ?? null;
    return { out: val };
  }
}
