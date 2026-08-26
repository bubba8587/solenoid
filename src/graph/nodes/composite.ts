import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode, SolenoidConnection } from "../schemes";
import { AdoptiveSocket, MutableSocket, SolenoidSocket, type SocketDataType } from "../sockets";
import { resolveTrigModes } from "../trigMode";
import { settleWildcardTypes } from "../trueAnyAdopt";
import { extractInit } from "../copyPaste";
import { installErrorGuards, solError, type SolError } from "../errorValue";
import { coerceNumber as toNumber } from "../valueKinds";
import {
  mulberry32, sampleUncertain, summarizeSamples, parseCorrelations, correlationCholesky, sampleCorrelated,
  DEFAULT_MC_SAMPLES, DEFAULT_MC_SEED, type DistributionKind,
} from "../monteCarlo";
import { installInputCoercion } from "../coerceInputs";
import { isFrameValue, frameRowCount, frameFromRows } from "../frame";
import { loopMembers, isGraphRebuilding } from "../process";
import { fireAlert } from "../alertStore";
import { compositeStaleStore } from "../compositeStaleStore";
import { formatScalar } from "../components/format";
import type { NodeCtor } from "../nodeCtorRegistry";

// Composite node — a subgraph container (docs/pack-architecture.md). Members run in a
// private NodeEditor/DataflowEngine; internals never leak into the outer engine or cache.

export type PortTier = "basic" | "advanced";
export type PortExposure = "hidden" | "exposed";

export interface CompositeInputPort {
  id: string;              // stable port key == the composite's own socket key
  label: string;
  exposure: PortExposure;  // hidden = baked to `default`; exposed = a real outer socket
  tier: PortTier;           // advanced ports are the promotion mechanism's second axis
  internalNodeId: string;  // the CompositeInputNode marker this port feeds
  default?: unknown;        // hidden bake-in value / fallback for an unwired exposed port
}

export interface CompositeOutputPort {
  id: string;
  label: string;
  tier: PortTier;
  internalNodeId: string;  // the CompositeOutputNode marker this port reads
}

export interface CompositeSavedNode {
  id: string;
  type: string;
  init: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  /** Layout inside the drill-in editor, relative to the selection bbox origin
   *  at collapse time. Optional so a pre-positions snapshot still hydrates. */
  x?: number;
  y?: number;
}

export interface CompositeSavedConnection {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

export interface CompositeInternalSnapshot {
  nodes: CompositeSavedNode[];
  connections: CompositeSavedConnection[];
}

// "manual" is one pass like "single" but ALWAYS heavy, so the arm-and-run hold applies.
export type CompositeRunMode = "single" | "manual" | "scenarios" | "data-table" | "simulation" | "goal-seek" | "montecarlo" | "by-row";

/** Goal-seek mode: drive ONE exposed input port until a chosen output port reaches
 *  `target`. Ports are `any`-typed, so a non-numeric objective or a failure to converge
 *  yields `#CONV!`; unset solver fields fall back to solveGoalSeek's own constants. */
export interface CompositeGoalSeek {
  inputPortId: string;
  outputPortId: string;
  target: number;
  /** Max objective evaluations before giving up (each is one internal pass). */
  maxIterations?: number;
  /** |output − target| convergence tolerance. */
  tolerance?: number;
  /** Lower / upper clamp on the driver's search range (bisection stays inside). */
  boundsLo?: number;
  boundsHi?: number;
}

/** Monte Carlo config: draw count + RNG seed (a fixed seed makes the run reproducible).
 *  Null until first configured — the driver then falls back to DEFAULT_MC_*. */
export interface CompositeMonteCarlo {
  samples: number;
  seed: number;
  /** `a ~ b = 0.7; c ~ d = -0.3` over exposed-input labels or ids — the Gaussian-copula
   *  correlation between draws (monteCarlo.ts). Absent / empty = independent. */
  correlations?: string;
}

/** Simulation "Stop when" comparator, over the chosen output's numeric value
 *  (a logical output reads as 1 / 0). */
export type CompositeStopOp = "gt" | "ge" | "lt" | "le" | "eq" | "ne";

/** By-Row iterates a WIRED input value into its rows. A frame → one single-row
 *  frame per row (keeps the port frame-typed for downstream frame ops); an array
 *  → its outer elements (a 1-D list yields scalars, a 2-D matrix yields its rows);
 *  a scalar → itself (one row); null/undefined → no rows. */
export function byRowValues(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  if (isFrameValue(v)) {
    const n = frameRowCount(v);
    const headers = v.columns.map((c) => c.name);
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(frameFromRows([v.columns.map((c) => c.values[i] ?? null)], headers));
    return out;
  }
  if (Array.isArray(v)) return [...v];
  return [v];
}

/** Safety cap on By-Row passes — each row is a full internal-engine reset, so a huge
 *  wired frame would freeze the Solve. Rows beyond this are silently dropped. */
export const BY_ROW_MAX_ROWS = 500;

/** Evaluate a "Stop when" comparison. Non-finite (null / #ERR / NaN) never
 *  stops — a simulation shouldn't halt on a missing/broken round. */
export function stopConditionMet(raw: unknown, op: CompositeStopOp, value: number): boolean {
  if (raw === null || raw === undefined) return false; // Number(null) is 0 — guard first
  const n = typeof raw === "boolean" ? (raw ? 1 : 0) : Number(raw);
  if (!Number.isFinite(n)) return false;
  switch (op) {
    case "gt": return n > value;
    case "ge": return n >= value;
    case "lt": return n < value;
    case "le": return n <= value;
    case "eq": return n === value;
    case "ne": return n !== value;
  }
}

/** One named input set for Scenarios mode; `overrides` is keyed by
 *  CompositeInputPort.id and a port with no entry keeps its normal wired/default value. */
export interface CompositeScenario {
  id: string;
  name: string;
  overrides: Record<string, unknown>;
}

/** Data Table mode: sweep values keyed by CompositeInputPort.id; a port with no entry
 *  doesn't vary. N varying ports = the Cartesian product (Excel stops at 2). */
export type CompositeDataTableValues = Record<string, unknown[]>;

// Internal boundary markers: not user-addable, they live only inside a CompositeNode's
// internalEditor, which has no ConnectionPlugin — no drag-time type check, only the
// runtime VALUE shape matters.

export class CompositeInputNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "When the composite's outer port is wired, the outside value flows here and the editable seed is ignored.",
  };

  label: string;
  value: unknown = null;
  /** Transient: the exposed port is EXTERNALLY WIRED, so `value` comes from outside
   *  rather than the editable seed. Stamped by the container's data() each pass. */
  externallyWired = false;
  /** Transient: this input is the ACTIVE goal-seek driver, so the drill-in shows a
   *  "solves to" readout instead of overwriting the seed. Stamped in data(). */
  goalDriver = false;
  /** Transient (re-solves on load): the goal-seek solution for this driver, a `#CONV!`
   *  SolError, or null before a solve. */
  solvedValue: number | SolError | null = null;
  /** Transient: the drill-in's run-mode readout for this marker, stamped in data();
   *  null under goal-seek, which uses goalDriver/solvedValue instead. */
  modeNote: { tag: string; text: string } | null = null;
  /** Editable seed, set on the marker inside the drill-in: the input value when the
   *  exposed port isn't externally wired, and the goal-seek seed. Persisted. */
  defaultValue: number | null = null;
  /** Monte-Carlo ± spread of this marker's value (1σ normal, half-width uniform);
   *  `null`/0 = a point value. Read ONLY by the container's Monte Carlo run mode. */
  uncertainty: number | null = null;
  /** Which distribution the Monte Carlo driver samples this input from. */
  distribution: DistributionKind = "normal";
  width = 140;
  height = 70;
  constructor(init?: { label?: string; defaultValue?: number | null; uncertainty?: number | null; distribution?: DistributionKind }) {
    super("Composite Input");
    this.label = init?.label ?? "Input";
    this.defaultValue = init?.defaultValue ?? null;
    this.uncertainty = init?.uncertainty ?? null;
    this.distribution = init?.distribution === "uniform" ? "uniform" : "normal";
    // Per-instance MutableSocket (not the shared trueAnySocket) so the container can
    // mirror the flowing type onto it, and it stays OUT of the trueany adoption fixpoint.
    this.addOutput("value", new ClassicPreset.Output(new MutableSocket("trueany"), this.label));
  }
  data(): { value: unknown } {
    return { value: this.value };
  }
}

export class CompositeOutputNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "Whatever arrives here becomes the composite's matching outer output. A multi-run mode collects one entry per run.",
  };

  label: string;
  /** Last value seen — the drill-in editor's value box (named cachedResult so the
   *  error guard's short-circuit mirrors an error into it). */
  cachedResult: unknown = null;
  /** Transient: the goal-seek TARGET when this output is the driven one, else null.
   *  Stamped in data(). */
  goalTarget: number | null = null;
  width = 140;
  height = 70;
  constructor(init?: { label?: string }) {
    super("Composite Output");
    this.label = init?.label ?? "Output";
    // Per-instance MutableSocket so the dot adapts to the internal source's type;
    // display only, outside the trueany fixpoint.
    this.addInput("value", new ClassicPreset.Input(new MutableSocket("trueany"), this.label));
  }
  data(inputs: Record<string, unknown[]>): { value: unknown } {
    const v = inputs.value?.[0] ?? null;
    this.cachedResult = v;
    return { value: v };
  }
}

export class CompositeNode extends ClassicPreset.Node {
  label: string;
  width: number;
  height: number;
  inputPorts: CompositeInputPort[];
  outputPorts: CompositeOutputPort[];
  internalEditor: NodeEditor<Schemes>;
  internalEngine: DataflowEngine<Schemes>;
  /** True only during hydrate()'s bulk build — the internal type settle runs ONCE
   *  at its end instead of per item. */
  private _hydrating = false;
  /** Last computed value per CompositeOutputPort.id; in a multi-run mode (Scenarios,
   *  Data Table…) each value is an ARRAY, one entry per run, in run order. */
  cachedOutputs: Record<string, unknown> = {};
  runMode: CompositeRunMode;
  scenarios: CompositeScenario[];
  dataTableValues: CompositeDataTableValues;
  /** Simulation step count: the exact number of rounds, or the hard CAP when
   *  `stopWhenPortId` is set. Clamped to >= 1 at run time. */
  simulationSteps: number;
  /** Simulation "Stop when": the loop halts on the round `port <op> value` holds (the
   *  series ends there); `""` = no condition. A logical output compares as 1 / 0. */
  stopWhenPortId: string;
  stopWhenOp: CompositeStopOp;
  stopWhenValue: number;
  /** By-Row mode: the exposed INPUT port to iterate — one pass per row of its value
   *  (see `byRowValues`), other ports fixed. `""` = not set, so a single pass. */
  byRowPortId: string;
  /** By-Row edge-detect: the row total the last cap warning fired at, or null when the
   *  last run wasn't capped — so a re-Solve of the same over-cap frame doesn't re-toast,
   *  but a change in how much is dropped (or a fresh relapse) does. Not persisted. */
  private lastByRowCapTotal: number | null = null;
  /** Goal-seek config (null until the mode is configured). */
  goalSeek: CompositeGoalSeek | null;
  /** Monte Carlo config (null until the mode is configured). */
  monteCarlo: CompositeMonteCarlo | null;
  /** The solved driver value (or a `#CONV!` SolError), surfaced in the editor;
   *  not persisted. */
  goalSeekResult: number | SolError | null = null;
  /** Rounds the LAST simulation actually ran — < `simulationSteps` means a Stop-when
   *  condition halted it early; null when no stepped loop has run. Transient. */
  simLastSteps: number | null = null;

  // Arm-and-run state for the HEAVY modes — session-transient, so a fresh load solves once.
  /** Set by the Solve button; consumed by the next data() to force one solve. */
  solveRequested = false;
  /** A solve triggered INSIDE the drill-in runs on the markers' own seeds, ignoring
   *  the outside wired inputs. */
  solveInsideOnly = false;
  /** Signature of the inputs+config at the last solve; null = never solved. */
  lastSolveKey: string | null = null;
  /** True when inputs/config changed since the last solve — drives the stale dot. */
  stale = false;
  /** Bumped on any edit to the INTERNAL graph and folded into solveKey, so a held
   *  heavy solve reads stale when the subgraph itself changes, not just its inputs. */
  internalEditSeq = 0;
  /** Counts `data()` invocations. Nothing inside the subgraph — values or marker stamps —
   *  can move without one, so an open drill-in re-renders its views only when this
   *  advances, instead of on every pass the surrounding document happens to run. */
  runSeq = 0;
  private _refIds = new WeakMap<object, number>();
  private _refSeq = 0;
  /** Internal-graph layout keyed by LIVE internal node id (remapped on hydrate,
   *  like port internalNodeIds). */
  internalPositions: Record<string, { x: number; y: number }> = {};

  // Holds the saved internal graph until `hydrate()` rebuilds it against a class registry.
  private _pending: CompositeInternalSnapshot | null = null;

  constructor(init?: {
    label?: string;
    width?: number;
    height?: number;
    inputPorts?: CompositeInputPort[];
    outputPorts?: CompositeOutputPort[];
    internal?: CompositeInternalSnapshot;
    runMode?: CompositeRunMode;
    scenarios?: CompositeScenario[];
    dataTableValues?: CompositeDataTableValues;
    simulationSteps?: number;
    stopWhenPortId?: string;
    stopWhenOp?: CompositeStopOp;
    stopWhenValue?: number;
    byRowPortId?: string;
    goalSeek?: CompositeGoalSeek;
    monteCarlo?: CompositeMonteCarlo;
  }) {
    super("Composite");
    this.label = init?.label ?? "Composite";
    this.width = init?.width ?? 240;
    this.height = init?.height ?? 140;
    this.inputPorts = (init?.inputPorts ?? []).map((p) => ({ ...p }));
    this.outputPorts = (init?.outputPorts ?? []).map((p) => ({ ...p }));
    this.runMode = init?.runMode ?? "single";
    this.scenarios = (init?.scenarios ?? []).map((s) => ({ ...s, overrides: { ...s.overrides } }));
    this.dataTableValues = Object.fromEntries(
      Object.entries(init?.dataTableValues ?? {}).map(([k, v]) => [k, [...v]]),
    );
    this.simulationSteps = init?.simulationSteps ?? 10;
    this.stopWhenPortId = init?.stopWhenPortId ?? "";
    this.stopWhenOp = init?.stopWhenOp ?? "eq";
    this.stopWhenValue = init?.stopWhenValue ?? 1;
    this.byRowPortId = init?.byRowPortId ?? "";
    this.goalSeek = init?.goalSeek ? { ...init.goalSeek } : null;
    this.monteCarlo = init?.monteCarlo ? { ...init.monteCarlo } : null;
    this.internalEditor = new NodeEditor<Schemes>();
    // Coercion first (inner), like the outer Canvas, so a relocated node keeps narrowing
    // its inputs to its declared socket shape exactly as it did outside.
    installInputCoercion(this.internalEditor);
    // Internal VALUE edits can't fire editor events; they reach markInternalEdit
    // via the retargeted pass (process.ts).
    this.internalEditor.addPipe((ctx) => {
      const t = (ctx as { type?: string }).type;
      if (t === "nodecreated" || t === "noderemoved" || t === "connectioncreated" || t === "connectionremoved") {
        this.markInternalEdit();
        if (!this._hydrating && (t === "connectioncreated" || t === "connectionremoved")) {
          this.settleInternalTypes();
        }
      }
      return ctx;
    });
    this.internalEngine = new DataflowEngine<Schemes>();
    this.internalEditor.use(this.internalEngine);
    this._pending = init?.internal ? { nodes: [...init.internal.nodes], connections: [...init.internal.connections] } : null;

    for (const p of this.inputPorts) {
      if (p.exposure === "exposed") this.addInput(p.id, new ClassicPreset.Input(new AdoptiveSocket(), p.label));
    }
    for (const p of this.outputPorts) {
      // Adoptive (not the shared `trueAnySocket`): an output port ADOPTS the type
      // feeding its internal Output marker.
      this.addOutput(p.id, new ClassicPreset.Output(new AdoptiveSocket(), p.label));
    }
  }

  get isHydrated(): boolean {
    return this._pending === null;
  }

  /** Build the internal editor from a saved snapshot with the outer loader's class
   *  registry. Deliberately NOT called from the constructor: nodeCtorRegistry depends
   *  on the catalog → rete-nodes.ts → this file, a module-init cycle. */
  async hydrate(reg: Map<string, NodeCtor>): Promise<void> {
    const pending = this._pending;
    if (!pending) return;
    this._pending = null;
    this._hydrating = true;
    const built = new Map<string, ClassicPreset.Node>();
    for (const sn of pending.nodes) {
      const Ctor = reg.get(sn.type);
      if (!Ctor) continue; // unknown internal type (pack off / renamed) — dropped, not placeholdered
      const node = new Ctor({ ...sn.init });
      const anyNode = node as unknown as Record<string, unknown>;
      // literalsIffEditable: restore ONLY onto declaring classes — same gate as the main load
      // path, so a composite's internal graph can't plant an invisible literal.
      if (sn.literals && typeof anyNode.literals === "object") anyNode.literals = { ...sn.literals };
      if (sn.stringLiterals && typeof anyNode.stringLiterals === "object") anyNode.stringLiterals = { ...sn.stringLiterals };
      built.set(sn.id, node);
      // Guard AFTER addNode: it must wrap OUTSIDE the coercion pipe so a ShapeError
      // thrown while narrowing lands in the guard as #SHAPE!.
      await this.internalEditor.addNode(node as SolenoidNode);
      installErrorGuards(node);
      if (typeof sn.x === "number" && typeof sn.y === "number") {
        this.internalPositions[node.id] = { x: sn.x, y: sn.y };
      }
    }
    for (const sc of pending.connections) {
      const s = built.get(sc.source);
      const t = built.get(sc.target);
      if (!s || !t) continue;
      try {
        await this.internalEditor.addConnection(
          new ClassicPreset.Connection(s, sc.sourceOutput, t, sc.targetInput) as SolenoidConnection,
        );
      } catch {
        // Skip incompatible/duplicate connections.
      }
    }
    // rete mints a FRESH id per node at construction, so every port's internalNodeId
    // must be remapped through `built` or data() can never find its marker again.
    for (const p of this.inputPorts) {
      const mapped = built.get(p.internalNodeId);
      if (mapped) p.internalNodeId = mapped.id;
    }
    for (const p of this.outputPorts) {
      const mapped = built.get(p.internalNodeId);
      if (mapped) p.internalNodeId = mapped.id;
    }
    this._hydrating = false;
    this.settleInternalTypes();
  }

  /** Undo support (flow drill-in): rebuild the internal graph from an earlier
   *  snapshot. Ids remint through hydrate's `built` remap, ports included; a
   *  port whose marker isn't in the snapshot dangles until leaveLevel prunes it
   *  (the same window the rete overlay's history left open). */
  async restoreInternal(snap: CompositeInternalSnapshot, reg: Map<string, NodeCtor>): Promise<void> {
    for (const c of [...this.internalEditor.getConnections()]) {
      await this.internalEditor.removeConnection(c.id);
    }
    for (const n of [...this.internalEditor.getNodes()]) {
      await this.internalEditor.removeNode(n.id);
    }
    this.internalPositions = {};
    this._pending = { nodes: [...snap.nodes], connections: [...snap.connections] };
    await this.hydrate(reg);
  }

  /** Snapshot the internal graph as plain JSON (the `internal` constructor arg), wired
   *  in via extractInit so persistence.ts needn't know about composites. */
  snapshotInternal(): CompositeInternalSnapshot {
    if (!this.isHydrated) return this._pending!; // never computed since load — hand back untouched
    const nodes: CompositeSavedNode[] = this.internalEditor.getNodes().map((n) => {
      const anyN = n as unknown as Record<string, unknown>;
      const sn: CompositeSavedNode = { id: n.id, type: n.constructor.name, init: extractInit(n) };
      if (anyN.literals && typeof anyN.literals === "object") {
        sn.literals = { ...(anyN.literals as Record<string, number>) };
      }
      if (anyN.stringLiterals && typeof anyN.stringLiterals === "object") {
        sn.stringLiterals = { ...(anyN.stringLiterals as Record<string, string>) };
      }
      const pos = this.internalPositions[n.id];
      if (pos) { sn.x = pos.x; sn.y = pos.y; }
      return sn;
    });
    const connections: CompositeSavedConnection[] = this.internalEditor.getConnections().map((c) => ({
      source: c.source,
      sourceOutput: c.sourceOutput as string,
      target: c.target,
      targetInput: c.targetInput as string,
    }));
    return { nodes, connections };
  }

  /** Returns the port id, which doubles as the composite's socket key. */
  addInputPort(spec: Omit<CompositeInputPort, "id"> & { id?: string }): string {
    const id = spec.id ?? `in_${this.inputPorts.length}_${Math.random().toString(36).slice(2, 7)}`;
    this.inputPorts.push({ ...spec, id });
    if (spec.exposure === "exposed") this.addInput(id, new ClassicPreset.Input(new AdoptiveSocket(), spec.label));
    return id;
  }

  /** Sync each port's label (record + rete socket) from its boundary marker's CURRENT
   *  label, so a rename inside the drill-in reaches the outer card. Called on leave. */
  syncPortLabels(): void {
    // A CLEARED marker label falls back to the card's placeholder, so the port must show
    // the same placeholder; an unhydrated marker keeps the saved port label.
    const labelOf = (nodeId: string, placeholder: string, current: string): string => {
      const n = this.internalEditor.getNode(nodeId) as { label?: string } | undefined;
      if (!n) return current;
      return n.label?.trim() ? n.label : placeholder;
    };
    for (const p of this.inputPorts) {
      p.label = labelOf(p.internalNodeId, "Input", p.label);
      const inp = this.inputs[p.id];
      if (inp) inp.label = p.label;
    }
    for (const p of this.outputPorts) {
      p.label = labelOf(p.internalNodeId, "Output", p.label);
      const out = this.outputs[p.id];
      if (out) out.label = p.label;
    }
  }

  /** Mirror the flowing type onto the boundary-marker sockets (display only — they sit
   *  outside the trueany fixpoint): an INPUT marker takes the shell port's adopted type,
   *  an OUTPUT marker the type of the internal node feeding it (never the shell output,
   *  which adopts from here). */
  private syncMarkerSocketTypes(): void {
    const typeOf = (s: ClassicPreset.Socket | undefined): SocketDataType =>
      (s as { dataType?: SocketDataType } | undefined)?.dataType ?? "trueany";
    for (const port of this.inputPorts) {
      const sock = this.internalEditor.getNode(port.internalNodeId)?.outputs?.value?.socket;
      if (sock instanceof MutableSocket) sock.setType(typeOf(this.inputs[port.id]?.socket));
    }
    const conns = this.internalEditor.getConnections();
    for (const port of this.outputPorts) {
      const sock = this.internalEditor.getNode(port.internalNodeId)?.inputs?.value?.socket;
      if (!(sock instanceof MutableSocket)) continue;
      const feed = conns.find((c) => c.target === port.internalNodeId && c.targetInput === "value");
      const srcSock = feed ? this.internalEditor.getNode(feed.source)?.outputs?.[feed.sourceOutput]?.socket : undefined;
      sock.setType(typeOf(srcSock));
    }
  }

  /** Null when this input has no role in the active mode; goal-seek is absent because
   *  its driver uses the richer solvedValue readout instead. */
  private inputModeNote(port: CompositeInputPort, m: CompositeInputNode): { tag: string; text: string } | null {
    switch (this.runMode) {
      case "montecarlo":
        return (m.uncertainty ?? 0) > 0 ? { tag: "± spread", text: `${formatScalar(m.uncertainty!)} · ${m.distribution}` } : null;
      case "by-row":
        return this.byRowPortId === port.id ? { tag: "by row", text: "one run per row" } : null;
      case "scenarios":
        return this.scenarios.some((s) => port.id in s.overrides) ? { tag: "scenarios", text: "varies" } : null;
      case "data-table": {
        const n = this.dataTableValues[port.id]?.length ?? 0;
        return n > 0 ? { tag: "data table", text: `${n} value${n === 1 ? "" : "s"}` } : null;
      }
      default:
        return null;
    }
  }

  addOutputPort(spec: Omit<CompositeOutputPort, "id"> & { id?: string }): string {
    const id = spec.id ?? `out_${this.outputPorts.length}_${Math.random().toString(36).slice(2, 7)}`;
    this.outputPorts.push({ ...spec, id });
    this.addOutput(id, new ClassicPreset.Output(new AdoptiveSocket(), spec.label));
    return id;
  }

  /** The caller removes outer cables into the socket FIRST — rete requires a socket's
   *  connections gone before the socket. */
  removeInputPort(id: string): void {
    if (!this.inputPorts.some((p) => p.id === id)) return;
    this.inputPorts = this.inputPorts.filter((p) => p.id !== id);
    if (this.inputs[id]) this.removeInput(id);
    for (const s of this.scenarios) delete s.overrides[id];
    delete this.dataTableValues[id];
    if (this.goalSeek?.inputPortId === id) this.goalSeek = null;
    if (this.byRowPortId === id) this.byRowPortId = "";
  }

  /** Drop an output port + its outer socket. Same caller contract as above. */
  removeOutputPort(id: string): void {
    if (!this.outputPorts.some((p) => p.id === id)) return;
    this.outputPorts = this.outputPorts.filter((p) => p.id !== id);
    if (this.outputs[id]) this.removeOutput(id);
    delete this.cachedOutputs[id];
    if (this.goalSeek?.outputPortId === id) this.goalSeek = null;
  }

  addScenario(): string {
    const id = `sc_${this.scenarios.length}_${Math.random().toString(36).slice(2, 7)}`;
    this.scenarios.push({ id, name: `Scenario ${this.scenarios.length + 1}`, overrides: {} });
    return id;
  }

  removeScenario(id: string): void {
    this.scenarios = this.scenarios.filter((s) => s.id !== id);
  }

  renameScenario(id: string, name: string): void {
    const s = this.scenarios.find((sc) => sc.id === id);
    if (s) s.name = name;
  }

  setScenarioOverride(id: string, portId: string, value: unknown): void {
    const s = this.scenarios.find((sc) => sc.id === id);
    if (!s) return;
    if (value === undefined) delete s.overrides[portId];
    else s.overrides[portId] = value;
  }

  /** An empty array clears this port's axis. */
  setDataTableValues(portId: string, values: unknown[]): void {
    if (values.length === 0) delete this.dataTableValues[portId];
    else this.dataTableValues[portId] = values;
  }

  /** Creates the config if unset, defaulting to the first exposed input / first output. */
  setGoalSeek(patch: Partial<CompositeGoalSeek>): void {
    const base: CompositeGoalSeek = this.goalSeek ?? {
      inputPortId: this.inputPorts.find((p) => p.exposure === "exposed")?.id ?? "",
      outputPortId: this.outputPorts[0]?.id ?? "",
      target: 0,
    };
    this.goalSeek = { ...base, ...patch };
  }

  /** Creates the config with the defaults if unset; values are clamped at solve time. */
  setMonteCarlo(patch: Partial<CompositeMonteCarlo>): void {
    const base: CompositeMonteCarlo = this.monteCarlo ?? { samples: DEFAULT_MC_SAMPLES, seed: DEFAULT_MC_SEED };
    this.monteCarlo = { ...base, ...patch };
  }

  private uncertainInputPorts(): CompositeInputPort[] {
    return this.inputPorts.filter((p) => {
      const m = this.internalEditor.getNode(p.internalNodeId) as CompositeInputNode | undefined;
      return !!m && typeof m.uncertainty === "number" && m.uncertainty > 0;
    });
  }

  // ─── Compute ─────────────────────────────────────────────────────────────

  /** Pre-seed the cache with #CIRC! for every TRUE loop member (Tarjan SCC, self-loops
   *  included) so a later `fetch` dead-ends instead of recursing forever. */
  private seedInternalLoopErrors(): void {
    const loop = loopMembers(this.internalEditor);
    if (loop.size === 0) return;
    const circErr = solError("#CIRC!", "This node is part of a circular dependency inside the composite: the calculation feeds back into itself. Switch the container to Simulation mode to run it as a feedback loop instead.");
    for (const id of loop) {
      const node = this.internalEditor.getNode(id);
      if (!node) continue;
      const outputs: Record<string, unknown> = {};
      for (const k of Object.keys(node.outputs ?? {})) outputs[k] = circErr;
      const seeded = Object.assign(Promise.resolve(outputs), { cancel() {} });
      try { this.internalEngine.cache.add(id, seeded); } catch { this.internalEngine.cache.patch(id, seeded); }
    }
  }

  /** One internal engine pass: inject each input port's value (an `overrides` entry
   *  wins), reset, fetch every output marker. Every run mode is N of these. */
  private async runPass(
    inputs: Record<string, unknown[]>,
    overrides?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    for (const port of this.inputPorts) {
      const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
      if (!marker) continue;
      const override = overrides?.[port.id];
      // Fallback order: override, else the wired value, else the marker's seed, else the default.
      marker.value = override !== undefined
        ? override
        : port.exposure === "exposed"
          ? (inputs[port.id]?.[0] ?? marker.defaultValue ?? port.default ?? null)
          : (marker.defaultValue ?? port.default ?? null);
    }
    this.internalEngine.reset();
    // A cable cycle among the internal nodes would make `fetch` recurse forever; seeding
    // #CIRC! dead-ends it. Simulation mode instead resolves the loop as bounded feedback.
    this.seedInternalLoopErrors();
    const row: Record<string, unknown> = {};
    for (const port of this.outputPorts) {
      const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeOutputNode | undefined;
      if (!marker) { row[port.id] = null; continue; }
      try {
        const res = await this.internalEngine.fetch(marker.id) as { value?: unknown };
        row[port.id] = res.value ?? null;
      } catch {
        row[port.id] = null;
      }
    }
    return row;
  }

  /** Transposes the per-run results into one ARRAY per output port, run order preserved. */
  private async collectMultiple(
    inputs: Record<string, unknown[]>,
    overridesList: Array<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown>[] = [];
    for (const overrides of overridesList) rows.push(await this.runPass(inputs, overrides));
    const outputs: Record<string, unknown> = {};
    for (const port of this.outputPorts) {
      const series = rows.map((r) => r[port.id]);
      outputs[port.id] = series;
      // Mirror the series onto the output marker, or the drill-in value box shows only
      // the last run's row while the outer card shows all.
      const marker = this.internalEditor.getNode(port.internalNodeId);
      if (marker instanceof CompositeOutputNode) marker.cachedResult = series;
    }
    return outputs;
  }

  /** Simulation mode: resolve a real cable cycle as bounded feedback instead of #CIRC!.
   *  One series entry per round actually run (≤ `simulationSteps`). */
  private async runSimulation(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    for (const port of this.inputPorts) {
      const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
      if (!marker) continue;
      marker.value = port.exposure === "exposed"
        ? (inputs[port.id]?.[0] ?? port.default ?? null)
        : (port.default ?? null);
    }
    this.internalEngine.reset();
    this.simLastSteps = null; // no stepped loop unless we reach one below

    const loop = loopMembers(this.internalEditor);
    if (loop.size === 0) return this.runPass(inputs); // nothing wired as feedback — nothing to simulate

    const conns = this.internalEditor.getConnections();
    const incomingByTarget = new Map<string, typeof conns>();
    for (const c of conns) {
      if (!loop.has(c.target)) continue;
      (incomingByTarget.get(c.target) ?? incomingByTarget.set(c.target, []).get(c.target)!).push(c);
    }

    // Non-cyclic inputs are round-invariant — resolve them once via the normal engine.
    const staticInputs = new Map<string, Record<string, unknown[]>>();
    for (const id of loop) {
      const nodeInputs: Record<string, unknown[]> = {};
      for (const c of incomingByTarget.get(id) ?? []) {
        if (loop.has(c.source)) continue;
        const srcOut = await this.internalEngine.fetch(c.source) as Record<string, unknown>;
        (nodeInputs[c.targetInput] ??= []).push(srcOut?.[c.sourceOutput] ?? null);
      }
      staticInputs.set(id, nodeInputs);
    }

    // Gauss-Seidel relaxation: loop members step in a FIXED order over one shared `state`
    // map mutated IN PLACE, so a later node sees this round's value, an earlier one the
    // previous round's.
    const stopFeed = this.resolveStopFeed(conns);

    const loopOrder = this.internalEditor.getNodes().map((n) => n.id).filter((id) => loop.has(id));
    const steps = Math.max(1, Math.round(this.simulationSteps));
    const fullSeries: Record<string, Record<string, unknown>>[] = [];
    const state = new Map<string, Record<string, unknown>>();
    for (let step = 0; step < steps; step++) {
      for (const id of loopOrder) {
        const node = this.internalEditor.getNode(id) as unknown as { data: (i: Record<string, unknown[]>) => unknown };
        const nodeInputs: Record<string, unknown[]> = { ...staticInputs.get(id) };
        for (const c of incomingByTarget.get(id) ?? []) {
          if (!loop.has(c.source)) continue;
          const srcOut = state.get(c.source);
          if (srcOut === undefined) continue; // this source has never resolved yet — stays unwired
          (nodeInputs[c.targetInput] ??= []).push(srcOut[c.sourceOutput] ?? null);
        }
        state.set(id, await Promise.resolve(node.data(nodeInputs)) as Record<string, unknown>);
      }
      const snapshot: Record<string, Record<string, unknown>> = {};
      for (const id of loopOrder) snapshot[id] = state.get(id)!;
      fullSeries.push(snapshot);
      // The halting round IS recorded — the user sees the state that satisfied it.
      if (stopFeed && (await this.stopSignalTrue(stopFeed, state, loop))) break;
    }
    this.simLastSteps = fullSeries.length; // < steps ⇒ a Stop-when condition halted early

    // Seed the FINAL state into the engine cache so an output fed by a NON-loop node
    // downstream of the cycle resolves through the pull engine instead of the loop guard.
    for (const id of loop) {
      const finalOut = state.get(id) ?? {};
      const seeded = Object.assign(Promise.resolve(finalOut), { cancel() {} });
      try { this.internalEngine.cache.add(id, seeded); } catch { this.internalEngine.cache.patch(id, seeded); }
    }

    const outputs: Record<string, unknown> = {};
    for (const port of this.outputPorts) {
      const marker = this.internalEditor.getNode(port.internalNodeId);
      if (!marker) { outputs[port.id] = null; continue; }
      const feed = conns.find((c) => c.target === marker.id && c.targetInput === "value");
      if (feed && loop.has(feed.source)) {
        const series = fullSeries.map((snap) => snap[feed.source]?.[feed.sourceOutput] ?? null);
        // The marker's data() never runs on this path — mirror the series into
        // cachedResult or the drill-in's value box stays "—".
        if (marker instanceof CompositeOutputNode) marker.cachedResult = series;
        outputs[port.id] = series;
      } else {
        try {
          const res = await this.internalEngine.fetch(marker.id) as { value?: unknown };
          outputs[port.id] = res.value ?? null;
        } catch {
          outputs[port.id] = null;
        }
      }
    }
    return outputs;
  }

  /** The connection feeding the "Stop when" output marker's `value` input, or
   *  null when no stop port is configured / it's missing / unwired. */
  private resolveStopFeed(conns: ReturnType<NodeEditor<Schemes>["getConnections"]>) {
    if (!this.stopWhenPortId) return null;
    const port = this.outputPorts.find((p) => p.id === this.stopWhenPortId);
    if (!port) return null;
    const marker = this.internalEditor.getNode(port.internalNodeId);
    if (!marker) return null;
    return conns.find((c) => c.target === marker.id && c.targetInput === "value") ?? null;
  }

  /** Evaluate "Stop when" against a round's loop `state`: read from the snapshot when the
   *  output is fed straight off a loop node, else re-resolve the downstream observer by
   *  seeding this round's loop outputs into the RESET pull engine (a reset is required or
   *  a prior round's cached observer value leaks). */
  private async stopSignalTrue(
    feed: NonNullable<ReturnType<CompositeNode["resolveStopFeed"]>>,
    state: Map<string, Record<string, unknown>>,
    loop: Set<string>,
  ): Promise<boolean> {
    let raw: unknown;
    if (loop.has(feed.source)) {
      raw = state.get(feed.source)?.[feed.sourceOutput] ?? null;
    } else {
      this.internalEngine.reset();
      for (const id of loop) {
        const seeded = Object.assign(Promise.resolve(state.get(id) ?? {}), { cancel() {} });
        try { this.internalEngine.cache.add(id, seeded); } catch { this.internalEngine.cache.patch(id, seeded); }
      }
      try {
        const res = await this.internalEngine.fetch(feed.source) as Record<string, unknown>;
        raw = res?.[feed.sourceOutput] ?? null;
      } catch {
        raw = null;
      }
    }
    return stopConditionMet(raw, this.stopWhenOp, this.stopWhenValue);
  }

  async data(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    this.runSeq++;
    this.syncPortLabels();
    this.syncMarkerSocketTypes();
    // Marker stamps are topology/config-only, so they stay current even on a held heavy pass.
    const gsDriverId = this.runMode === "goal-seek" ? this.goalSeek?.inputPortId : undefined;
    for (const port of this.inputPorts) {
      const m = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
      if (!m) continue;
      m.externallyWired = port.exposure === "exposed" && inputs[port.id]?.[0] !== undefined;
      m.goalDriver = port.id === gsDriverId;
      if (!m.goalDriver) m.solvedValue = null; // clear a stale readout off non-drivers / on mode change
      m.modeNote = this.inputModeNote(port, m);
    }
    const gsTargetId = this.runMode === "goal-seek" ? this.goalSeek?.outputPortId : undefined;
    for (const port of this.outputPorts) {
      const m = this.internalEditor.getNode(port.internalNodeId) as CompositeOutputNode | undefined;
      if (m) m.goalTarget = port.id === gsTargetId ? (this.goalSeek?.target ?? null) : null;
    }
    // Auto-mode trig nodes must resolve from their incoming unit BEFORE the internal
    // engine pull, or a deg/rad trig node inside a composite computes in radians.
    resolveTrigModes(this.internalEditor);
    if (this.isHeavyMode()) {
      const key = this.solveKey(inputs);
      if (this.solveRequested || this.lastSolveKey === null) {
        // An inside-the-drill-in Solve runs on the markers' seeds (empty inputs → runPass
        // falls back to defaultValue).
        const solveInputs = this.solveInsideOnly ? {} : inputs;
        const outputs = await this.runActiveMode(solveInputs);
        this.cachedOutputs = outputs;
        // Recompute the key AFTER the solve, and on `inputs` — not solveInputs — to match
        // the hold branch.
        this.lastSolveKey = this.solveKey(inputs);
        this.solveRequested = false;
        this.solveInsideOnly = false;
        this.stale = false;
        compositeStaleStore.set(this.id, false);
        return outputs;
      }
      this.stale = key !== this.lastSolveKey;
      compositeStaleStore.set(this.id, this.stale);
      return this.cachedOutputs;
    }
    // Light modes (single passthrough) stay fully live.
    const outputs = await this.runActiveMode(inputs);
    this.cachedOutputs = outputs;
    this.stale = false;
    compositeStaleStore.set(this.id, false);
    return outputs;
  }

  /** True when the active run mode does multi-pass work worth gating behind Solve. */
  isHeavyMode(): boolean {
    // Manual refresh isn't heavy by COST (one pass) — holding is its entire point.
    if (this.runMode === "manual") return true;
    if (this.runMode === "simulation") return true;
    if (this.runMode === "scenarios") return this.scenarios.length > 0;
    if (this.runMode === "goal-seek") return !!this.goalSeek;
    // Monte Carlo is only heavy when some input actually varies.
    if (this.runMode === "montecarlo") return this.uncertainInputPorts().length > 0;
    if (this.runMode === "by-row") return this.inputPorts.some((p) => p.id === this.byRowPortId);
    if (this.runMode === "data-table") {
      return this.inputPorts.some(
        (p) => p.exposure === "exposed" && (this.dataTableValues[p.id]?.length ?? 0) > 0,
      );
    }
    return false;
  }

  /** Request the next data() to solve (the Solve button); `insideOnly` runs on the
   *  markers' seeds, which never applies in manual mode (no numeric seeds to isolate). */
  requestSolve(insideOnly = false): void {
    this.solveRequested = true;
    this.solveInsideOnly = insideOnly && this.runMode !== "manual";
  }

  /** An edit landed in the internal graph — a held heavy solve is no longer current. */
  markInternalEdit(): void { this.internalEditSeq++; }

  /** The main canvas's connection-pipe settle never reaches the internal editor, so this
   *  joint fixpoint must run here. Returns true if any boundary type changed. */
  settleInternalTypes(): boolean {
    settleWildcardTypes(this.internalEditor);
    return this.adoptBoundaryTypes();
  }

  /** Each exposed output port adopts the type feeding its internal Output marker
   *  (`trueany` when unwired). Adoption NEVER drops an outer cable (wildcardLadder). Returns true
   *  if a type changed, so the caller re-renders the card + its cables. */
  adoptBoundaryTypes(): boolean {
    const conns = this.internalEditor.getConnections();
    let changed = false;
    for (const port of this.outputPorts) {
      const outSock = this.outputs[port.id]?.socket;
      if (!(outSock instanceof MutableSocket)) continue; // hidden port → no outer socket
      let want: SocketDataType = "trueany";
      const marker = this.internalEditor.getNode(port.internalNodeId);
      if (marker) {
        const feed = conns.find((c) => c.target === marker.id && c.targetInput === "value");
        const src = feed ? this.internalEditor.getNode(feed.source) : undefined;
        const s = feed ? src?.outputs?.[feed.sourceOutput]?.socket : undefined;
        if (s instanceof SolenoidSocket) want = s.dataType;
      }
      if (outSock.dataType !== want) { outSock.setType(want); changed = true; }
    }
    return changed;
  }

  /** A cheap signature of the inputs + the active mode's config. Objects contribute a
   *  stable reference token, not a deep serialize, so this stays cheap on every tick. */
  private solveKey(inputs: Record<string, unknown[]>): string {
    const token = (v: unknown): unknown => {
      if (v === null || typeof v !== "object") return v; // primitive → by value
      let id = this._refIds.get(v as object);
      if (id === undefined) { id = ++this._refSeq; this._refIds.set(v as object, id); }
      return `#ref${id}`;
    };
    const inputTokens: Record<string, unknown> = {};
    for (const [k, arr] of Object.entries(inputs)) {
      inputTokens[k] = Array.isArray(arr) ? arr.map(token) : token(arr);
    }
    return JSON.stringify({
      inputs: inputTokens,
      // Inside-editable seeds affect the solve, so a seed edit marks it stale too.
      seeds: this.inputPorts.map((p) => (this.internalEditor.getNode(p.internalNodeId) as CompositeInputNode | undefined)?.defaultValue ?? null),
      // A marker's spread/distribution edit restales a held MC solve.
      uncertainty: this.inputPorts.map((p) => {
        const m = this.internalEditor.getNode(p.internalNodeId) as CompositeInputNode | undefined;
        return m ? [m.uncertainty ?? null, m.distribution] : null;
      }),
      edits: this.internalEditSeq,
      mode: this.runMode,
      goalSeek: this.goalSeek,
      monteCarlo: this.monteCarlo,
      scenarios: this.scenarios,
      dataTableValues: this.dataTableValues,
      simulationSteps: this.simulationSteps,
      stopWhenPortId: this.stopWhenPortId,
      stopWhenOp: this.stopWhenOp,
      stopWhenValue: this.stopWhenValue,
      byRowPortId: this.byRowPortId,
    });
  }

  /** The raw mode dispatch, with no arm/hold. */
  private async runActiveMode(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    if (this.runMode === "simulation") {
      return this.runSimulation(inputs);
    } else if (this.runMode === "scenarios" && this.scenarios.length > 0) {
      return this.collectMultiple(inputs, this.scenarios.map((s) => s.overrides));
    } else if (this.runMode === "data-table") {
      // Only exposed ports with a non-empty sweep list are axes; the rest keep their value.
      const axes = this.inputPorts
        .filter((p) => p.exposure === "exposed" && (this.dataTableValues[p.id]?.length ?? 0) > 0)
        .map((p) => ({ portId: p.id, values: this.dataTableValues[p.id] }));
      if (axes.length > 0) {
        const combos = axes.reduce<unknown[][]>(
          (acc, axis) => acc.flatMap((combo) => axis.values.map((v) => [...combo, v])),
          [[]],
        );
        const overridesList = combos.map((combo) => {
          const o: Record<string, unknown> = {};
          axes.forEach((axis, i) => { o[axis.portId] = combo[i]; });
          return o;
        });
        return this.collectMultiple(inputs, overridesList);
      }
      return this.runPass(inputs);
    } else if (this.runMode === "goal-seek" && this.goalSeek) {
      return this.runGoalSeek(inputs, this.goalSeek);
    } else if (this.runMode === "montecarlo") {
      return this.runMonteCarlo(inputs);
    } else if (this.runMode === "by-row") {
      return this.runByRow(inputs);
    }
    // "single" and "manual" both land here; manual differs only in the arm-and-run hold.
    return this.runPass(inputs);
  }

  /** One pass per ROW of the chosen input port, other ports fixed, collected as a
   *  per-row series. A missing port or a value with no rows collapses to one pass. */
  private async runByRow(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    const port = this.inputPorts.find((p) => p.id === this.byRowPortId);
    if (!port) return this.runPass(inputs);
    const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
    const source = port.exposure === "exposed"
      ? (inputs[port.id]?.[0] ?? marker?.defaultValue ?? port.default ?? null)
      : (marker?.defaultValue ?? port.default ?? null);
    let rows = byRowValues(source);
    if (rows.length === 0) return this.runPass(inputs);
    // The only heavy mode whose pass COUNT comes from the data, not a typed number, so it
    // caps to bound a runaway. Truncation drops rows off the tail — a plausible-but-partial
    // series — so warn loudly (Alerts HUD + toast). Edge-detected on the total per the
    // alertStore STATUS rule; a Solve runs outside the bulk-rebuild guard, so skip that.
    if (rows.length > BY_ROW_MAX_ROWS) {
      const total = rows.length;
      if (total !== this.lastByRowCapTotal && !isGraphRebuilding()) {
        const name = (this.label ?? "").trim() || "Composite";
        fireAlert({
          nodeId: this.id,
          label: name,
          kind: "warning",
          message: `${name}: By-Row ran the first ${BY_ROW_MAX_ROWS} of ${total} rows (the rest were skipped)`,
        });
      }
      this.lastByRowCapTotal = total;
      rows = rows.slice(0, BY_ROW_MAX_ROWS);
    } else {
      this.lastByRowCapTotal = null;
    }
    return this.collectMultiple(inputs, rows.map((r) => ({ [port.id]: r })));
  }

  /** Sample every uncertain input `samples` times from a seeded RNG, re-run on each
   *  draw, and summarize each output into an UncertainNumber (mean ± sd + the raw
   *  draws). No uncertain input collapses to one ordinary pass. */
  private async runMonteCarlo(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    const uncertainPorts = this.uncertainInputPorts();
    if (uncertainPorts.length === 0) return this.runPass(inputs);
    const cfg = this.monteCarlo ?? { samples: DEFAULT_MC_SAMPLES, seed: DEFAULT_MC_SEED };
    const draws = Math.max(1, Math.round(cfg.samples));
    const rng = mulberry32((cfg.seed | 0) >>> 0);

    // Each uncertain port's mean: the wired value if exposed+wired, else the marker's
    // seed, else the port default.
    const meanOf = (port: CompositeInputPort, marker: CompositeInputNode): number => {
      const wired = port.exposure === "exposed" ? inputs[port.id]?.[0] : undefined;
      const raw = wired ?? marker.defaultValue ?? port.default ?? 0;
      const n = toNumber(raw);
      return Number.isFinite(n) ? n : 0;
    };
    const specs = uncertainPorts.map((port) => {
      const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode;
      return { port, marker, mean: meanOf(port, marker), spread: marker.uncertainty as number, kind: marker.distribution };
    });

    // Correlated inputs: resolve the card's pairs (labels or ids) onto the uncertain
    // ports, Cholesky once, then one copula draw per iteration; independent otherwise.
    const corrText = cfg.correlations?.trim() ?? "";
    const resolvePort = (name: string): string | undefined =>
      specs.find((s) => s.port.id === name || s.port.label.trim() === name)?.port.id;
    const pairs = corrText
      ? parseCorrelations(corrText).pairs
          .map((p) => ({ a: resolvePort(p.a), b: resolvePort(p.b), rho: p.rho }))
          .filter((p): p is { a: string; b: string; rho: number } => !!p.a && !!p.b && p.a !== p.b)
      : [];
    const chol = pairs.length ? correlationCholesky(specs.map((s) => s.port.id), pairs) : null;

    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < draws; i++) {
      const overrides: Record<string, unknown> = {};
      if (chol) {
        const vals = sampleCorrelated(specs.map((s) => ({ mean: s.mean, spec: { kind: s.kind, spread: s.spread } })), chol, rng);
        specs.forEach((s, k) => { overrides[s.port.id] = vals[k]; });
      } else {
        for (const s of specs) overrides[s.port.id] = sampleUncertain(s.mean, { kind: s.kind, spread: s.spread }, rng);
      }
      rows.push(await this.runPass(inputs, overrides));
    }

    const outputs: Record<string, unknown> = {};
    for (const port of this.outputPorts) {
      const nums = rows.map((r) => toNumber(r[port.id]));
      const summary = summarizeSamples(nums);
      outputs[port.id] = summary;
      // Mirror into the output marker (its data() never runs on this driver path) so the
      // drill-in value box shows mean ± sd too.
      const marker = this.internalEditor.getNode(port.internalNodeId);
      if (marker instanceof CompositeOutputNode) marker.cachedResult = summary;
    }
    return outputs;
  }

  /** Drive `gs.inputPortId` until `gs.outputPortId` reaches `gs.target`, then run one
   *  final pass at the solution. On failure the target output carries `#CONV!`. The
   *  objective is a full internal pass per evaluation — keep evaluation counts low. */
  private async runGoalSeek(inputs: Record<string, unknown[]>, gs: CompositeGoalSeek): Promise<Record<string, unknown>> {
    const objective = async (x: number): Promise<number> => {
      const row = await this.runPass(inputs, { [gs.inputPortId]: x });
      return toNumber(row[gs.outputPortId]) - gs.target;
    };
    // Seed from the wired value, else the marker's seed, else the port default.
    const driverPort = this.inputPorts.find((p) => p.id === gs.inputPortId);
    const driverMarker = driverPort ? this.internalEditor.getNode(driverPort.internalNodeId) as CompositeInputNode | undefined : undefined;
    const seedRaw = inputs[gs.inputPortId]?.[0] ?? driverMarker?.defaultValue ?? driverPort?.default ?? 0;
    const seed = Number.isFinite(toNumber(seedRaw)) ? toNumber(seedRaw) : 0;
    const solvedRaw = await solveGoalSeek(objective, seed, {
      maxIterations: gs.maxIterations,
      tolerance: gs.tolerance,
      boundsLo: gs.boundsLo,
      boundsHi: gs.boundsHi,
    });
    if (solvedRaw === null) {
      const err = solError("#CONV!", `Goal seek couldn't drive "${gs.inputPortId}" to make "${gs.outputPortId}" reach ${gs.target}`);
      this.goalSeekResult = err;
      if (driverMarker) driverMarker.solvedValue = err;
      const row = await this.runPass(inputs); // show the un-solved state
      row[gs.outputPortId] = err;
      return row;
    }
    // Clean the raw solver float to the precision the app exposes (formatScalar), so the
    // driver never shows a 19.999999998 tail.
    const solved = Number(formatScalar(solvedRaw));
    this.goalSeekResult = solved;
    // The answer goes to a dedicated readout (solvedValue), NOT back onto the seed, so
    // the driver's editable seed stays the user's starting guess.
    if (driverMarker) driverMarker.solvedValue = solved;
    // The composite's OUTPUT is its solution: emit the solved DRIVER value on the target
    // port, not the achieved output (which just equals the target).
    const row = await this.runPass(inputs, { [gs.inputPortId]: solved });
    row[gs.outputPortId] = solved;
    return row;
  }
}

/** Solve f(x) = 0 for x (f = observed output − target): secant first, then a
 *  bracket-expand + bisection fallback. Returns null when it can't converge. */
async function solveGoalSeek(
  f: (x: number) => Promise<number>,
  x0: number,
  opts?: { maxIterations?: number; tolerance?: number; boundsLo?: number; boundsHi?: number },
): Promise<number | null> {
  const FTOL = opts?.tolerance != null && opts.tolerance > 0 ? opts.tolerance : 1e-7; // |output − target|
  const XTOL = 1e-9;   // step size
  const MAX = opts?.maxIterations != null && opts.maxIterations >= 1 ? Math.round(opts.maxIterations) : 80;
  // Optional driver clamp: the search never leaves [lo, hi] when both are given.
  const LO = opts?.boundsLo;
  const HI = opts?.boundsHi;
  const hasBounds = LO != null && HI != null && Number.isFinite(LO) && Number.isFinite(HI) && LO < HI;
  const clamp = (x: number): number => (hasBounds ? Math.min(HI!, Math.max(LO!, x)) : x);

  let a = clamp(x0);
  let fa = await f(a);
  if (!Number.isFinite(fa)) return null; // non-numeric objective — can't solve
  if (Math.abs(fa) <= FTOL) return a;
  // Second seed: a small perturbation (scaled to x0 so it works at any magnitude).
  let b = a + (a === 0 ? 1 : Math.abs(a) * 1e-3);
  let fb = await f(b);

  // ── Secant ──
  for (let i = 0; i < MAX && Number.isFinite(fb); i++) {
    if (Math.abs(fb) <= FTOL) return b;
    const denom = fb - fa;
    if (denom === 0) break;
    const c = clamp(b - (fb * (b - a)) / denom);
    if (!Number.isFinite(c)) break;
    const step = Math.abs(c - b);
    a = b; fa = fb;
    b = c; fb = await f(c);
    // A tiny step with a LARGE residual means secant stalled — fall through to bracketing.
    if (step < XTOL) { if (Number.isFinite(fb) && Math.abs(fb) <= 1e-4) return c; break; }
  }

  // ── Bracket-expand + bisection fallback ──
  // With bounds, bisect [lo, hi] directly — it already brackets the admissible range.
  let lo = hasBounds ? LO! : x0;
  let flo = await f(lo);
  if (!Number.isFinite(flo)) return null;
  let hi = hasBounds ? HI! : x0 + (x0 === 0 ? 1 : Math.abs(x0));
  let fhi = await f(hi);
  let span = Math.abs(hi - lo) || 1;
  for (let i = 0; !hasBounds && i < 60 && (!Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)); i++) {
    span *= 2;
    // Expand outward on both sides alternately so we bracket a root either direction.
    hi = x0 + (i % 2 === 0 ? span : -span);
    fhi = await f(hi);
  }
  if (!Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null; // never bracketed
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = await f(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) <= FTOL || Math.abs(hi - lo) < XTOL) return mid;
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}
