import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode, SolenoidConnection } from "../schemes";
import { AdoptiveSocket, MutableSocket, SolenoidSocket, trueAnySocket, type SocketDataType } from "../sockets";
import { resolveTrigModes } from "../trigMode";
import { settleWildcardTypes } from "../trueAnyAdopt";
import { extractInit } from "../copyPaste";
import { installErrorGuards, solError, type SolError } from "../errorValue";
import { coerceNumber as toNumber } from "../valueKinds";
import {
  mulberry32, sampleUncertain, summarizeSamples,
  DEFAULT_MC_SAMPLES, DEFAULT_MC_SEED, type DistributionKind,
} from "../monteCarlo";
import { installInputCoercion } from "../coerceInputs";
import { isFrameValue, frameRowCount, frameFromRows } from "../frame";
import { loopMembers } from "../process";
import { compositeStaleStore } from "../compositeStaleStore";
import { formatScalar } from "../components/format";
import type { NodeCtor } from "../nodeCtorRegistry";

// ─── Composite node — a real, computing subgraph container ────────────────────
// See docs/pack-architecture.md "Composite pack node" and
// docs/v2.0/09-subgraph-composite-container.md. Deliberately NOT a GroupNode
// variant: a Group has no sockets, no data(), and inferred (spatial) membership.
// A Composite has a DECLARED boundary (explicit input/output ports, each bound
// to a marker node inside its own private subgraph) and genuinely computes —
// the member nodes are physically relocated out of the outer editor into an
// internal NodeEditor + DataflowEngine pair that only the Composite itself
// drives. The outer graph sees one card with typed ports; nothing about the
// internals leaks into the outer engine's traversal or cache.

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

// ─── Run modes ──────────────────────────────────────────────────────────────
// "single" (the default, item 1's behavior) computes the container once from
// its wired/default inputs. Each further mode is a DRIVER around the exact
// same per-pass machinery (inject → reset → fetch) — it runs that pass N
// times with different injected values and collects the N results per output
// port as a list, instead of a single scalar. Only list modes actually wired
// up appear here; a mode gets added to this union in the same commit its
// data() branch + UI land (see CompositeComponent's run-mode dropdown).
export type CompositeRunMode = "single" | "scenarios" | "data-table" | "simulation" | "goal-seek" | "montecarlo" | "by-row";

/** Goal-seek mode: drive ONE exposed input port until a chosen output port reaches
 *  `target`. Excel's Goal Seek. Both ports are `any`-typed (no static numeric type),
 *  so numeric-ness is enforced at solve time — a non-numeric objective or a failure
 *  to converge yields a `#CONV!` on the target output.
 *
 *  The solver-parameter fields are all OPTIONAL and only present when the user
 *  overrides a default from the advanced tier (so a plain goal-seek config stays
 *  `{inputPortId, outputPortId, target}` and its round-trip test is unaffected).
 *  `solveGoalSeek` falls back to its built-in constants for any unset field. */
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

/** Monte Carlo mode config: how many draws + the RNG seed (a fixed seed makes the
 *  run reproducible). Null until the mode is first configured, exactly like
 *  goalSeek; the driver falls back to DEFAULT_MC_* when it reads a null config. */
export interface CompositeMonteCarlo {
  samples: number;
  seed: number;
}

/** The comparator for Simulation's "Stop when" condition (see `stopWhenOp`).
 *  `>= / <= / > / < / = / !=` over the chosen output's numeric value (a logical
 *  output reads as 1 / 0). */
export type CompositeStopOp = "gt" | "ge" | "lt" | "le" | "eq" | "ne";

/** By-Row iterates a WIRED input value into its rows. A frame → one single-row
 *  frame per row (keeps the port frame-typed for downstream frame ops); an array
 *  → its outer elements (a 1-D list yields scalars, a 2-D matrix yields its rows);
 *  a scalar → itself (one row); null/undefined → no rows. Pure + exported so the
 *  row semantics are unit-tested directly. */
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

/** Safety cap on By-Row passes — each row is a full internal-engine reset, so an
 *  accidentally-wired huge frame (a CSV import) would freeze the arm-and-run
 *  Solve. The mode targets dozens-to-hundreds of rows; the Polars verb chain is
 *  the bulk path. Rows beyond this are dropped (surfaced in the dev-notes as a
 *  known limitation to replace with a Problems-panel warning). */
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

/** One named input set for Scenarios mode. `overrides` is keyed by
 *  CompositeInputPort.id; a port with no entry falls back to its normal
 *  wired/default value for that run — a scenario only needs to name the
 *  inputs it actually changes. */
export interface CompositeScenario {
  id: string;
  name: string;
  overrides: Record<string, unknown>;
}

/** Data Table mode: a full-factorial parameter grid instead of named sets.
 *  Keyed by CompositeInputPort.id → the sweep values for that port. A port
 *  with no entry (or an empty list) doesn't vary — it just keeps using its
 *  normal wired/default value on every run, the same "only name what
 *  changes" contract Scenarios uses. 1 varying port = Excel's one-variable
 *  Data Table; 2 = the two-variable grid; N generalizes past what Excel
 *  can express (the Cartesian product over every varying port). */
export type CompositeDataTableValues = Record<string, unknown[]>;

// Simulation mode is genuinely different from the other two drivers: it
// doesn't run N INDEPENDENT passes, it runs N DEPENDENT steps of an internal
// FEEDBACK LOOP — a real cable cycle the user wires inside the container
// (e.g. a "current population" node whose growth output feeds back into
// itself). See CompositeNode.runSimulation for the algorithm and the
// #CIRC! bypass (process.ts's loopMembers, scoped to internalEditor).

// ─── Internal boundary markers ─────────────────────────────────────────────────
// Not user-addable — no catalog entry. They only ever live inside a
// CompositeNode's internalEditor as the concrete wire-end for one promoted
// port. Both marker classes use `trueAnySocket` — matching the composite's own
// external port sockets (also `any`, see addInputPort/addOutputPort below) —
// deliberately, for two reasons: (1) it's the same "type-agnostic boundary"
// precedent Expression's inputs already use (anyIn), and (2) it keeps the
// marker constructor shaped like every other node's `(init?: Record<string,
// unknown>)`, so hydrate() can rebuild one through the generic ctor registry
// with no socket-identity serialization problem (a live ClassicPreset.Socket
// instance isn't JSON-safe). `internalEditor` has no ConnectionPlugin, so
// there's no drag-time type-compat check to satisfy anyway — only the actual
// runtime VALUE shape matters, which flows through untouched either way.

export class CompositeInputNode extends ClassicPreset.Node {
  label: string;
  value: unknown = null;
  /** An editable DEFAULT/seed, set on the marker INSIDE the drill-in — used as the
   *  input value when the exposed port isn't externally wired (and as the goal-seek
   *  seed). A wired value or a solve overrides it, so it's editable "even if it gets
   *  overridden". Persisted (INIT_FIELD_ORDER "defaultValue"). */
  defaultValue: number | null = null;
  /** Monte-Carlo uncertainty declared on THIS input, inside the drill-in: the ±
   *  spread of the marker's value (a 1σ for a normal draw, a ± half-width for a
   *  uniform one). `null`/0 = a point value (not sampled). SCOPED to composites —
   *  only the container's Monte Carlo run mode reads it (see monteCarlo.ts). */
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
    this.addOutput("value", new ClassicPreset.Output(trueAnySocket, this.label));
  }
  data(): { value: unknown } {
    return { value: this.value };
  }
}

export class CompositeOutputNode extends ClassicPreset.Node {
  label: string;
  /** Last value seen — the drill-in editor's value box. (Named cachedResult
   *  so the error guard's short-circuit mirrors an error into it.) */
  cachedResult: unknown = null;
  width = 140;
  height = 70;
  constructor(init?: { label?: string }) {
    super("Composite Output");
    this.label = init?.label ?? "Output";
    this.addInput("value", new ClassicPreset.Input(trueAnySocket, this.label));
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
  /** True only during hydrate()'s bulk node/connection build — suppresses the
   *  per-item internal type settle (run ONCE at the end of hydrate instead). */
  private _hydrating = false;
  /** Last computed output per port id, keyed by CompositeOutputPort.id — read
   *  by the component to render each output row's value box. In "single" mode
   *  each value is a scalar/list/etc as usual; in a multi-run mode (Scenarios,
   *  Data Table…) each value is an ARRAY, one entry per run, in run order. */
  cachedOutputs: Record<string, unknown> = {};
  runMode: CompositeRunMode;
  scenarios: CompositeScenario[];
  dataTableValues: CompositeDataTableValues;
  /** Simulation mode's step count — the container parameter the plan calls
   *  for. With no stop condition it's the exact number of rounds; with one
   *  (`stopWhenPortId`) it's the hard CAP. Clamped to >= 1 at run time (see
   *  runSimulation). */
  simulationSteps: number;
  /** Simulation "Stop when": an OUTPUT port + comparator + threshold checked
   *  after each round — the loop halts early the round `port <op> value` holds
   *  (the series ends on that round). `stopWhenPortId === ""` = no condition, run
   *  the full `simulationSteps`. Lets a model self-terminate (e.g. stop when a
   *  population passes a cap, or a logical "solved?" output reaches 1) instead of
   *  hand-tuning the step count. A logical output compares as 1 (true) / 0. */
  stopWhenPortId: string;
  stopWhenOp: CompositeStopOp;
  stopWhenValue: number;
  /** By-Row mode: the id of the exposed INPUT port to iterate — the subgraph runs
   *  once per ROW of that port's wired value (a list → per element, a matrix →
   *  per row, a frame → per single-row frame), the row bound to that port while
   *  the others stay fixed; each output collects a per-row series. "" = not set
   *  (falls back to a single pass). See `runByRow`. */
  byRowPortId: string;
  /** Goal-seek config (null until the mode is configured). */
  goalSeek: CompositeGoalSeek | null;
  /** Monte Carlo config (null until the mode is configured). */
  monteCarlo: CompositeMonteCarlo | null;
  /** The solved driver value (or a `#CONV!` SolError), surfaced in the editor.
   *  Component-read only; not persisted (re-solved on every pass). */
  goalSeekResult: number | SolError | null = null;

  // ─── Arm-and-run for the HEAVY modes (goal-seek / scenarios / data-table /
  // simulation) ─── each does many internal passes per recompute, so they must NOT
  // re-solve on every upstream tick. Instead data() solves once (on first run or an
  // explicit Solve) then HOLDS the cached result, flagging `stale` when the inputs
  // or config change. All three are session-transient (not persisted): a fresh load
  // solves once, matching the load-reveal's compute pass.
  /** Set by the Solve button; consumed by the next data() to force one solve. */
  solveRequested = false;
  /** When the solve was triggered from INSIDE the drill-in: ignore the outside wired
   *  inputs and run on the markers' own seeds (defaultValue) — you're testing the
   *  subgraph in isolation. An outside Solve (drilled up) uses the wired values. */
  solveInsideOnly = false;
  /** Signature of the inputs+config at the last solve; null = never solved. */
  lastSolveKey: string | null = null;
  /** True when inputs/config changed since the last solve — drives the stale dot. */
  stale = false;
  /** Bumped on any edit to the INTERNAL graph (topology via the editor pipe in the
   *  constructor; value edits via the retargeted pass — see process.ts). Folded into
   *  solveKey so a held heavy solve reads stale when the subgraph ITSELF changes,
   *  not just its inputs/config — otherwise a drill-in edit left the old solution
   *  under a green "Up to date" dot. Session-transient, like the rest. */
  internalEditSeq = 0;
  private _refIds = new WeakMap<object, number>();
  private _refSeq = 0;
  /** Internal-graph layout, keyed by LIVE internal node id (remapped on
   *  hydrate, like port internalNodeIds). Written at collapse time and by the
   *  drill-in editor on close; read by the editor on open and by unpack. */
  internalPositions: Record<string, { x: number; y: number }> = {};

  // A freshly-loaded (not yet hydrated) composite holds its saved internal
  // graph here until `hydrate()` rebuilds it against a class registry — see
  // the cycle note on `hydrate` below for why construction can't do this itself.
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
    // Same two wrappers the outer Canvas installs on the real editor (see
    // errorIntegration.test.ts's makeEditor): coercion first (inner), so a
    // relocated node keeps narrowing/widening its inputs to its declared
    // socket shape exactly as it did on the outer canvas.
    installInputCoercion(this.internalEditor);
    // Any internal TOPOLOGY change (drill-in add/delete/rewire) invalidates a held
    // heavy solve. Hydration bumps too — harmless, lastSolveKey is null until the
    // first pass. Internal VALUE edits can't fire editor events; they reach
    // markInternalEdit via the retargeted pass (process.ts).
    this.internalEditor.addPipe((ctx) => {
      const t = (ctx as { type?: string }).type;
      if (t === "nodecreated" || t === "noderemoved" || t === "connectioncreated" || t === "connectionremoved") {
        this.markInternalEdit();
        // Re-derive the internal wildcard socket types (Conduit lanes + trueany
        // adoption) and the boundary output-port types on a LIVE drill-in edit —
        // the mirror of the outer canvas's connection-pipe settle. Suppressed
        // during hydrate's bulk build (settled once at its end instead).
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
      // Adoptive (not the shared static `trueAnySocket`): an output port ADOPTS
      // the type feeding its internal Output marker (adoptBoundaryTypes), the
      // mirror of the input ports adopting from OUTSIDE. Starts `trueany` (hollow
      // ring) until settled.
      this.addOutput(p.id, new ClassicPreset.Output(new AdoptiveSocket(), p.label));
    }
  }

  /** True once the internal graph reflects live node instances (either built
   *  live by createCompositeFromSelection, or hydrated from a save/paste). */
  get isHydrated(): boolean {
    return this._pending === null;
  }

  /**
   * Build the internal editor's nodes/connections from a saved snapshot, using
   * the SAME class registry the outer graph loader uses. Deliberately NOT
   * called from the constructor: nodeCtorRegistry ultimately depends on the
   * Add-menu catalog, which depends on rete-nodes.ts (the barrel that
   * re-exports this very file) — resolving that at construction time would be
   * a module-init cycle. Callers (persistence.ts's rebuildGraph, copyPaste's
   * cloneNode) already have a registry in hand and call this once the node
   * exists. A no-op if already hydrated (live creation hydrates inline).
   */
  async hydrate(reg: Map<string, NodeCtor>): Promise<void> {
    const pending = this._pending;
    if (!pending) return;
    this._pending = null;
    this._hydrating = true;
    const built = new Map<string, ClassicPreset.Node>();
    for (const sn of pending.nodes) {
      const Ctor = reg.get(sn.type);
      if (!Ctor) continue; // unknown internal type (pack off / renamed) — dropped, not placeholdered (v1 gap)
      const node = new Ctor({ ...sn.init });
      const anyNode = node as unknown as Record<string, unknown>;
      if (sn.literals) anyNode.literals = { ...sn.literals };
      if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
      installErrorGuards(node);
      built.set(sn.id, node);
      await this.internalEditor.addNode(node as SolenoidNode);
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
    // rete mints a FRESH id per node at construction (it's not settable via
    // init), so every port's internalNodeId — captured against the OLD saved
    // ids — must be remapped through `built` to the freshly-constructed
    // instances, or data() can never find its marker again.
    for (const p of this.inputPorts) {
      const mapped = built.get(p.internalNodeId);
      if (mapped) p.internalNodeId = mapped.id;
    }
    for (const p of this.outputPorts) {
      const mapped = built.get(p.internalNodeId);
      if (mapped) p.internalNodeId = mapped.id;
    }
    // Bulk build done — settle the internal wildcard/boundary types ONCE (the
    // per-item pipe settle was suppressed via _hydrating). Mirrors the outer
    // load-path settle (persistence.ts) that runs on the MAIN editor.
    this._hydrating = false;
    this.settleInternalTypes();
  }

  /** Snapshot the internal graph as plain JSON — the `internal` constructor
   *  arg above. Wired into persistence via extractInit's special-case branch
   *  (see copyPaste.ts), so save/load AND copy/paste both round-trip through
   *  this without persistence.ts knowing anything about composites. */
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

  /** Register a new input port (exposed ports also get a real outer socket).
   *  Returns the port id, which doubles as the composite's socket key. */
  addInputPort(spec: Omit<CompositeInputPort, "id"> & { id?: string }): string {
    const id = spec.id ?? `in_${this.inputPorts.length}_${Math.random().toString(36).slice(2, 7)}`;
    this.inputPorts.push({ ...spec, id });
    if (spec.exposure === "exposed") this.addInput(id, new ClassicPreset.Input(new AdoptiveSocket(), spec.label));
    return id;
  }

  /** Sync each surviving port's label from its boundary marker's CURRENT label, so
   *  renaming a Composite Input/Output marker inside the drill-in propagates to the
   *  outer card's socket labels (updates both the port record and the rete socket
   *  the card renders). Called on leave; markers with no node are reconciled away
   *  separately (leaveLevel). */
  syncPortLabels(): void {
    // When a marker's label is CLEARED, it falls back to its placeholder ("Input" /
    // "Output") on the card — so the port must show the same placeholder, not the
    // stale old label. If the marker isn't hydrated yet, keep the saved port label.
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

  /** Register a new output port + its outer socket. Returns the port id. */
  addOutputPort(spec: Omit<CompositeOutputPort, "id"> & { id?: string }): string {
    const id = spec.id ?? `out_${this.outputPorts.length}_${Math.random().toString(36).slice(2, 7)}`;
    this.outputPorts.push({ ...spec, id });
    this.addOutput(id, new ClassicPreset.Output(new AdoptiveSocket(), spec.label));
    return id;
  }

  /** Drop an input port (and its outer socket + any run-mode state keyed to
   *  it). The caller removes outer cables into the socket FIRST — rete
   *  requires a socket's connections gone before the socket. */
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

  // ─── Scenario mutators (called by the component's editor UI) ────────────────

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

  // ─── Data Table mutator ──────────────────────────────────────────────────

  /** Set (or clear, with an empty array) the sweep values for one input
   *  port's axis of the parameter grid. */
  setDataTableValues(portId: string, values: unknown[]): void {
    if (values.length === 0) delete this.dataTableValues[portId];
    else this.dataTableValues[portId] = values;
  }

  // ─── Goal-seek mutator ───────────────────────────────────────────────────

  /** Merge a patch into the goal-seek config (creating it, defaulting the ports
   *  to the first exposed input / first output, if not set yet). */
  setGoalSeek(patch: Partial<CompositeGoalSeek>): void {
    const base: CompositeGoalSeek = this.goalSeek ?? {
      inputPortId: this.inputPorts.find((p) => p.exposure === "exposed")?.id ?? "",
      outputPortId: this.outputPorts[0]?.id ?? "",
      target: 0,
    };
    this.goalSeek = { ...base, ...patch };
  }

  // ─── Monte Carlo mutator ─────────────────────────────────────────────────

  /** Merge a patch into the Monte Carlo config (creating it with the defaults if
   *  unset). Values are clamped/normalized at solve time in runMonteCarlo. */
  setMonteCarlo(patch: Partial<CompositeMonteCarlo>): void {
    const base: CompositeMonteCarlo = this.monteCarlo ?? { samples: DEFAULT_MC_SAMPLES, seed: DEFAULT_MC_SEED };
    this.monteCarlo = { ...base, ...patch };
  }

  /** The exposed input ports whose drill-in marker declares a positive Monte Carlo
   *  spread — the set the sampler actually varies. */
  private uncertainInputPorts(): CompositeInputPort[] {
    return this.inputPorts.filter((p) => {
      const m = this.internalEditor.getNode(p.internalNodeId) as CompositeInputNode | undefined;
      return !!m && typeof m.uncertainty === "number" && m.uncertainty > 0;
    });
  }

  // ─── Compute ─────────────────────────────────────────────────────────────

  /** Pre-seed the internal engine's cache with #CIRC! for every TRUE loop
   *  member (Tarjan SCC, self-loops included) so a subsequent `fetch` dead-
   *  ends into the cached error instead of recursing forever — the exact
   *  mechanism process.ts's outer pass uses, scoped to internalEditor. */
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

  /** One internal engine pass: inject each input port's value (an explicit
   *  `overrides` entry wins, else the port's normal wired/default value),
   *  reset, fetch every output marker. Shared by every run mode — a mode is
   *  just "call this N times with different overrides and collect". */
  private async runPass(
    inputs: Record<string, unknown[]>,
    overrides?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    for (const port of this.inputPorts) {
      const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
      if (!marker) continue;
      const override = overrides?.[port.id];
      // Fallback order: a solve/scenario override, else the externally wired value,
      // else the marker's inside-editable defaultValue (seed), else the port default.
      marker.value = override !== undefined
        ? override
        : port.exposure === "exposed"
          ? (inputs[port.id]?.[0] ?? marker.defaultValue ?? port.default ?? null)
          : (marker.defaultValue ?? port.default ?? null);
    }
    // Internal engine is scoped to this composite alone (small, private graph),
    // so a full reset every pass is cheap and simplest.
    this.internalEngine.reset();
    // A real cable cycle among the RELOCATED internal nodes (not through a
    // marker — CompositeInputNode has no input socket, so it can never sit on
    // a cycle) would otherwise make `fetch` below recurse forever, exactly
    // the deadlock process.ts's OUTER engine avoids by pre-seeding #CIRC!
    // (process.ts:481-488). Mirror that here, scoped to internalEditor — a
    // Simulate container bypasses this via runSimulation instead, which
    // resolves the very same loop as bounded feedback rather than an error.
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

  /** Run one pass per entry in `overridesList` and transpose the per-run
   *  results into one ARRAY per output port (run order preserved) — the
   *  "collect side by side" step every multi-run mode shares. */
  private async collectMultiple(
    inputs: Record<string, unknown[]>,
    overridesList: Array<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown>[] = [];
    for (const overrides of overridesList) rows.push(await this.runPass(inputs, overrides));
    const outputs: Record<string, unknown> = {};
    for (const port of this.outputPorts) outputs[port.id] = rows.map((r) => r[port.id]);
    return outputs;
  }

  /**
   * Simulation mode: resolve a REAL cable cycle among the relocated internal
   * nodes as bounded feedback instead of an error. `loopMembers` finds the
   * true SCC (process.ts:336-395, reused verbatim, scoped to internalEditor)
   * — that's the container's "loop fully contained inside an opted-in
   * Simulate container" bypass the plan calls for; every OTHER run mode still
   * seeds #CIRC! for the exact same set (see seedInternalLoopErrors).
   *
   * Algorithm (Gauss-Seidel-style bounded relaxation, the same idea as
   * Excel's iterative-calculation circular-reference resolution): each loop
   * node's NON-cyclic inputs (parameters fed by a CompositeInputNode marker,
   * or by a plain internal node outside the loop) are resolved ONCE via the
   * normal pull engine — they can't change step to step. Then for
   * `simulationSteps` rounds, every loop node's `data()` is called DIRECTLY
   * (bypassing the pull engine, which would just recurse into the same cycle
   * and hang) with its cyclic inputs drawn from the PREVIOUS round's outputs
   * (round 1's "previous" is empty — a loop node with no wired literal for
   * its cyclic input falls back to its own default, exactly like an unwired
   * input anywhere else). Round 0 is never recorded; the returned series has
   * exactly `simulationSteps` entries, one per round actually run.
   */
  private async runSimulation(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    for (const port of this.inputPorts) {
      const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
      if (!marker) continue;
      marker.value = port.exposure === "exposed"
        ? (inputs[port.id]?.[0] ?? port.default ?? null)
        : (port.default ?? null);
    }
    this.internalEngine.reset();

    const loop = loopMembers(this.internalEditor);
    if (loop.size === 0) return this.runPass(inputs); // nothing wired as feedback — nothing to simulate

    const conns = this.internalEditor.getConnections();
    const incomingByTarget = new Map<string, typeof conns>();
    for (const c of conns) {
      if (!loop.has(c.target)) continue;
      (incomingByTarget.get(c.target) ?? incomingByTarget.set(c.target, []).get(c.target)!).push(c);
    }

    // Non-cyclic inputs are round-invariant — resolve them once via the
    // normal engine (a plain fetch works fine; they aren't on the cycle).
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

    // Step the loop: Gauss-Seidel relaxation (the same idea Excel's iterative
    // calc uses) — process the loop members in a FIXED, deterministic order
    // (the order they were added to internalEditor — for a live-created
    // composite that's the order the user built the model in) and update a
    // single shared `state` map IN PLACE as each node resolves, so a node
    // later in the order sees its predecessor's freshly-computed value from
    // THIS round, while a node earlier in the order still sees the previous
    // round's value (or, on the very first round, no value yet — a cyclic
    // input with nothing computed for it yet stays unwired, so the node
    // falls back to its own literal/default, exactly like any other unwired
    // input). This converges immediately for the concrete case the plan
    // calls out (a two-node accumulator → transform → feedback pair) without
    // needing a general fixed-point solver. `fullSeries[step]` snapshots
    // every loop node's full output object for that round — small and cheap
    // for a hand-relocated container — so each output port below can pick
    // out just the one key it's bound to.
    // "Stop when": the cable feeding the designated logical output marker, if
    // configured. Resolved once — its truthiness is read each round to halt early.
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
      // Halt the round the stop signal reads true — the round IS recorded (the
      // user sees the state that satisfied the condition). `simulationSteps` is
      // the cap; the series may be shorter.
      if (stopFeed && (await this.stopSignalTrue(stopFeed, state, loop))) break;
    }

    // Seed the FINAL state into the engine cache so an output port fed by a
    // NON-loop node downstream of the cycle resolves normally through the
    // pull engine instead of tripping the loop guard.
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
        // The series is read straight off the loop snapshots — the marker's
        // own data() never runs on this path, so mirror the result into its
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

  /** Evaluate the "Stop when" condition (`port <op> value`) against a round's
   *  loop `state`. If the chosen output is fed straight off a loop node it's read
   *  from the snapshot (cheap). Otherwise it's a downstream OBSERVER (e.g. an
   *  "is-solved?" check, or a running total, that reads loop outputs) — resolve it
   *  by seeding this round's loop outputs into the pull engine and fetching. The
   *  engine is reset first so a prior round's cached observer value can't leak;
   *  loop stepping never touches the engine, so this is safe mid-loop. */
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
    // Keep the port labels fresh from their boundary markers on every pass — so
    // renaming a marker inside the drill-in updates the port-label-driven controls
    // (goal-seek Set/By dropdowns) as soon as the blur fires a recompute, without
    // waiting for drill-up (the outer card still re-renders on leave). Cheap.
    this.syncPortLabels();
    // Resolve Auto-mode trig nodes INSIDE the subgraph from their incoming unit
    // before the internal engine pull — the same pass process.ts runs on the main
    // editor, scoped here to the composite's own graph (else an Auto deg/rad trig
    // node inside a composite always computed in radians). Early-outs when none.
    resolveTrigModes(this.internalEditor);
    // Heavy modes (many internal passes) are arm-and-run: solve once, then HOLD the
    // cached result and flag `stale` instead of re-solving on every upstream tick.
    // The Solve button (solveRequested) or a never-solved node forces one solve.
    if (this.isHeavyMode()) {
      const key = this.solveKey(inputs);
      if (this.solveRequested || this.lastSolveKey === null) {
        // An inside-the-drill-in Solve ignores the outside wired inputs and runs on
        // the markers' seeds (empty inputs → runPass falls back to defaultValue).
        const solveInputs = this.solveInsideOnly ? {} : inputs;
        const outputs = await this.runActiveMode(solveInputs);
        this.cachedOutputs = outputs;
        // Recompute the key AFTER the solve — a goal-seek writes the solved value back
        // onto the driver marker's seed, so the key computed before the solve would
        // read stale on the very next pass. Keyed on `inputs` (not solveInputs) to
        // match the hold branch below.
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

  /** True when the active run mode does multi-pass work worth gating behind Solve —
   *  a data-table with no axes / empty scenarios collapse to a single pass (light). */
  isHeavyMode(): boolean {
    if (this.runMode === "simulation") return true;
    if (this.runMode === "scenarios") return this.scenarios.length > 0;
    if (this.runMode === "goal-seek") return !!this.goalSeek;
    // Monte Carlo is only heavy when something actually varies — with no uncertain
    // input it collapses to a single pass (like a data-table with no axes).
    if (this.runMode === "montecarlo") return this.uncertainInputPorts().length > 0;
    if (this.runMode === "by-row") return this.inputPorts.some((p) => p.id === this.byRowPortId);
    if (this.runMode === "data-table") {
      return this.inputPorts.some(
        (p) => p.exposure === "exposed" && (this.dataTableValues[p.id]?.length ?? 0) > 0,
      );
    }
    return false;
  }

  /** Request the next data() to solve (the Solve button). `insideOnly` runs on the
   *  markers' seeds, ignoring outside wiring (an inside-the-drill-in Solve). Caller
   *  triggers a recompute. */
  requestSolve(insideOnly = false): void { this.solveRequested = true; this.solveInsideOnly = insideOnly; }

  /** An edit landed in the internal graph — a held heavy solve is no longer current. */
  markInternalEdit(): void { this.internalEditSeq++; }

  /** Re-derive every DERIVED socket type inside the subgraph, then re-derive the
   *  boundary OUTPUT-port types from it. The composite's internal editor is its
   *  own world — the main canvas's connection-pipe settle (Canvas.tsx) never
   *  touches it — so a Display/Conduit/selector chain inside a composite only
   *  adopts its trueany rings if we run the same joint fixpoint here. Cheap
   *  (composites are small); returns true if any boundary type changed. */
  settleInternalTypes(): boolean {
    settleWildcardTypes(this.internalEditor);
    return this.adoptBoundaryTypes();
  }

  /** The mirror of the input ports adopting from OUTSIDE: each EXPOSED output port
   *  adopts the concrete type feeding its internal Output marker's `value` input
   *  (reverting to `trueany` when the marker is unwired). Adoption NEVER drops an
   *  outer cable — it is derived state (the D17 rule). Returns true if a type
   *  changed (the caller re-renders the outer card + its cables). */
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

  /** A cheap signature of the inputs + the active mode's config: a change to either
   *  makes the last solve stale. Objects (frames/cubes) contribute a stable reference
   *  token (a recomputed upstream frame = a new reference = stale) rather than a deep
   *  serialize, so this stays cheap on every tick. */
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
      // Per-input Monte-Carlo spec (spread + distribution): editing a marker's error
      // bar or distribution kind restales a held MC solve.
      uncertainty: this.inputPorts.map((p) => {
        const m = this.internalEditor.getNode(p.internalNodeId) as CompositeInputNode | undefined;
        return m ? [m.uncertainty ?? null, m.distribution] : null;
      }),
      // Any other internal edit (topology, an internal node's value) — see the field.
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

  /** The raw mode dispatch (no arm/hold) — the original data() body. */
  private async runActiveMode(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    if (this.runMode === "simulation") {
      return this.runSimulation(inputs);
    } else if (this.runMode === "scenarios" && this.scenarios.length > 0) {
      return this.collectMultiple(inputs, this.scenarios.map((s) => s.overrides));
    } else if (this.runMode === "data-table") {
      // Only exposed ports with a non-empty sweep list are axes of the grid;
      // a port with no entry keeps its normal wired/default value on every run.
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
    return this.runPass(inputs);
  }

  /** By-Row driver: run the subgraph once per ROW of the chosen input port,
   *  binding that row to the port while every other port keeps its wired/default
   *  value. Each output collects a per-row series (same shape as Scenarios / Data
   *  Table). Reuses `collectMultiple` with one override per row. A missing/unwired
   *  port, or a value with no rows, collapses to a single normal pass. */
  private async runByRow(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    const port = this.inputPorts.find((p) => p.id === this.byRowPortId);
    if (!port) return this.runPass(inputs);
    const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
    const source = port.exposure === "exposed"
      ? (inputs[port.id]?.[0] ?? marker?.defaultValue ?? port.default ?? null)
      : (marker?.defaultValue ?? port.default ?? null);
    let rows = byRowValues(source);
    if (rows.length === 0) return this.runPass(inputs);
    if (rows.length > BY_ROW_MAX_ROWS) rows = rows.slice(0, BY_ROW_MAX_ROWS);
    return this.collectMultiple(inputs, rows.map((r) => ({ [port.id]: r })));
  }

  // ─── Monte Carlo driver ────────────────────────────────────────────────────
  /**
   * Sample every uncertain input `samples` times from a seeded RNG, re-run the
   * container on each draw, and summarize each output port into an UncertainNumber
   * (mean ± sample sd, carrying the raw draws for a histogram). A non-uncertain
   * input keeps its normal wired/default value on every draw (runPass handles it);
   * an input's mean is its wired value if exposed+wired, else its inside seed. With
   * no uncertain input at all this collapses to a single ordinary pass (nothing to
   * sample). The draws are deterministic in the seed — same seed, same result.
   */
  private async runMonteCarlo(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    const uncertainPorts = this.uncertainInputPorts();
    if (uncertainPorts.length === 0) return this.runPass(inputs);
    const cfg = this.monteCarlo ?? { samples: DEFAULT_MC_SAMPLES, seed: DEFAULT_MC_SEED };
    const draws = Math.max(1, Math.round(cfg.samples));
    const rng = mulberry32((cfg.seed | 0) >>> 0);

    // Each uncertain port's mean: the wired value if exposed+wired, else the
    // marker's inside seed (defaultValue), else the port default (else 0).
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

    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < draws; i++) {
      const overrides: Record<string, unknown> = {};
      for (const s of specs) overrides[s.port.id] = sampleUncertain(s.mean, { kind: s.kind, spread: s.spread }, rng);
      rows.push(await this.runPass(inputs, overrides));
    }

    const outputs: Record<string, unknown> = {};
    for (const port of this.outputPorts) {
      const nums = rows.map((r) => toNumber(r[port.id]));
      const summary = summarizeSamples(nums);
      outputs[port.id] = summary;
      // Mirror into the output marker so the drill-in value box shows mean ± sd too
      // (its own data() never runs on this driver path — same fix as runSimulation).
      const marker = this.internalEditor.getNode(port.internalNodeId);
      if (marker instanceof CompositeOutputNode) marker.cachedResult = summary;
    }
    return outputs;
  }

  // ─── Goal-seek solver ────────────────────────────────────────────────────
  /** Drive `gs.inputPortId` until `gs.outputPortId` reaches `gs.target`, then run
   *  one final pass at the solution so every output box reflects it. On failure the
   *  target output carries a `#CONV!` (and `goalSeekResult` too). The objective is a
   *  full internal pass per evaluation, so the solver keeps evaluation counts low. */
  private async runGoalSeek(inputs: Record<string, unknown[]>, gs: CompositeGoalSeek): Promise<Record<string, unknown>> {
    const objective = async (x: number): Promise<number> => {
      const row = await this.runPass(inputs, { [gs.inputPortId]: x });
      return toNumber(row[gs.outputPortId]) - gs.target;
    };
    // Seed from the input's current wired value, else the marker's inside seed, else
    // the port default (else 0).
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
      const row = await this.runPass(inputs); // show the un-solved state
      row[gs.outputPortId] = err;
      return row;
    }
    // Clean the raw solver float to the precision the app actually exposes
    // (formatScalar = integer or 4 decimals) — so the driver input doesn't show a
    // 19.999999998 tail nothing else in the app would.
    const solved = Number(formatScalar(solvedRaw));
    this.goalSeekResult = solved;
    // The solution CHANGES the driver input — write it back onto the driver marker so
    // its inside value box shows the solved value (not the stale seed).
    if (driverMarker) driverMarker.defaultValue = solved;
    // The composite's OUTPUT is its solution: emit the solved DRIVER value on the
    // target port (not the achieved output, which just equals the target). So the
    // Solution hero's socket carries the answer downstream — wire the break-even
    // units into the next calc, not the trivially-zero profit.
    const row = await this.runPass(inputs, { [gs.inputPortId]: solved });
    row[gs.outputPortId] = solved;
    return row;
  }
}

/** Solve f(x) = 0 for x (f = observed output − target). Secant first (few
 *  evaluations for smooth objectives), then a bracket-expand + bisection fallback
 *  for robustness. Returns null when it can't converge (non-numeric objective, no
 *  sign change found, or a diverging step). */
async function solveGoalSeek(
  f: (x: number) => Promise<number>,
  x0: number,
  opts?: { maxIterations?: number; tolerance?: number; boundsLo?: number; boundsHi?: number },
): Promise<number | null> {
  // Advanced-tier overrides fall back to the built-in defaults when unset/invalid.
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
    // A tiny step with a small residual is a solution; a tiny step with a LARGE
    // residual means secant stalled — fall through to the bracketing fallback.
    if (step < XTOL) { if (Number.isFinite(fb) && Math.abs(fb) <= 1e-4) return c; break; }
  }

  // ── Bracket-expand + bisection fallback ──
  // With bounds, bisect the whole [lo, hi] window directly — it already brackets
  // the driver's admissible range, so expansion isn't needed (and mustn't escape it).
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
