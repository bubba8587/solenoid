import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode, SolenoidConnection } from "../schemes";
import { anySocket } from "../sockets";
import { extractInit } from "../copyPaste";
import { installErrorGuards, solError, type SolError } from "../errorValue";
import { installInputCoercion } from "../coerceInputs";
import { loopMembers } from "../process";
import { compositeStaleStore } from "../compositeStaleStore";
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
export type CompositeRunMode = "single" | "scenarios" | "data-table" | "simulation" | "goal-seek";

/** Goal-seek mode: drive ONE exposed input port until a chosen output port reaches
 *  `target`. Excel's Goal Seek. Both ports are `any`-typed (no static numeric type),
 *  so numeric-ness is enforced at solve time — a non-numeric objective or a failure
 *  to converge yields a `#CONV!` on the target output. */
export interface CompositeGoalSeek {
  inputPortId: string;
  outputPortId: string;
  target: number;
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
// port. Both marker classes use `anySocket` — matching the composite's own
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
  width = 140;
  height = 70;
  constructor(init?: { label?: string }) {
    super("Composite Input");
    this.label = init?.label ?? "Input";
    this.addOutput("value", new ClassicPreset.Output(anySocket, this.label));
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
    this.addInput("value", new ClassicPreset.Input(anySocket, this.label));
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
  /** Last computed output per port id, keyed by CompositeOutputPort.id — read
   *  by the component to render each output row's value box. In "single" mode
   *  each value is a scalar/list/etc as usual; in a multi-run mode (Scenarios,
   *  Data Table…) each value is an ARRAY, one entry per run, in run order. */
  cachedOutputs: Record<string, unknown> = {};
  runMode: CompositeRunMode;
  scenarios: CompositeScenario[];
  dataTableValues: CompositeDataTableValues;
  /** Simulation mode's step count — the container parameter the plan calls
   *  for. Clamped to >= 1 at run time (see runSimulation). */
  simulationSteps: number;
  /** Goal-seek config (null until the mode is configured). */
  goalSeek: CompositeGoalSeek | null;
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
  /** Signature of the inputs+config at the last solve; null = never solved. */
  lastSolveKey: string | null = null;
  /** True when inputs/config changed since the last solve — drives the stale dot. */
  stale = false;
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
    goalSeek?: CompositeGoalSeek;
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
    this.goalSeek = init?.goalSeek ? { ...init.goalSeek } : null;
    this.internalEditor = new NodeEditor<Schemes>();
    // Same two wrappers the outer Canvas installs on the real editor (see
    // errorIntegration.test.ts's makeEditor): coercion first (inner), so a
    // relocated node keeps narrowing/widening its inputs to its declared
    // socket shape exactly as it did on the outer canvas.
    installInputCoercion(this.internalEditor);
    this.internalEngine = new DataflowEngine<Schemes>();
    this.internalEditor.use(this.internalEngine);
    this._pending = init?.internal ? { nodes: [...init.internal.nodes], connections: [...init.internal.connections] } : null;

    for (const p of this.inputPorts) {
      if (p.exposure === "exposed") this.addInput(p.id, new ClassicPreset.Input(anySocket, p.label));
    }
    for (const p of this.outputPorts) {
      this.addOutput(p.id, new ClassicPreset.Output(anySocket, p.label));
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
    if (spec.exposure === "exposed") this.addInput(id, new ClassicPreset.Input(anySocket, spec.label));
    return id;
  }

  /** Register a new output port + its outer socket. Returns the port id. */
  addOutputPort(spec: Omit<CompositeOutputPort, "id"> & { id?: string }): string {
    const id = spec.id ?? `out_${this.outputPorts.length}_${Math.random().toString(36).slice(2, 7)}`;
    this.outputPorts.push({ ...spec, id });
    this.addOutput(id, new ClassicPreset.Output(anySocket, spec.label));
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

  // ─── Compute ─────────────────────────────────────────────────────────────

  /** Pre-seed the internal engine's cache with #CIRC! for every TRUE loop
   *  member (Tarjan SCC, self-loops included) so a subsequent `fetch` dead-
   *  ends into the cached error instead of recursing forever — the exact
   *  mechanism process.ts's outer pass uses, scoped to internalEditor. */
  private seedInternalLoopErrors(): void {
    const loop = loopMembers(this.internalEditor);
    if (loop.size === 0) return;
    const circErr = solError("#CIRC!", "This node is part of a circular dependency inside the composite — the calculation feeds back into itself. Switch the container to Simulation mode to run it as a feedback loop instead.");
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
      marker.value = override !== undefined
        ? override
        : port.exposure === "exposed"
          ? (inputs[port.id]?.[0] ?? port.default ?? null)
          : (port.default ?? null);
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

  async data(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    // Heavy modes (many internal passes) are arm-and-run: solve once, then HOLD the
    // cached result and flag `stale` instead of re-solving on every upstream tick.
    // The Solve button (solveRequested) or a never-solved node forces one solve.
    if (this.isHeavyMode()) {
      const key = this.solveKey(inputs);
      if (this.solveRequested || this.lastSolveKey === null) {
        const outputs = await this.runActiveMode(inputs);
        this.cachedOutputs = outputs;
        this.lastSolveKey = key;
        this.solveRequested = false;
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
    if (this.runMode === "data-table") {
      return this.inputPorts.some(
        (p) => p.exposure === "exposed" && (this.dataTableValues[p.id]?.length ?? 0) > 0,
      );
    }
    return false;
  }

  /** Request the next data() to solve (the Solve button). Caller triggers a recompute. */
  requestSolve(): void { this.solveRequested = true; }

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
      mode: this.runMode,
      goalSeek: this.goalSeek,
      scenarios: this.scenarios,
      dataTableValues: this.dataTableValues,
      simulationSteps: this.simulationSteps,
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
    }
    return this.runPass(inputs);
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
    // Seed from the input's current wired/default value (else 0).
    const seedRaw = inputs[gs.inputPortId]?.[0] ?? this.inputPorts.find((p) => p.id === gs.inputPortId)?.default ?? 0;
    const seed = Number.isFinite(toNumber(seedRaw)) ? toNumber(seedRaw) : 0;
    const solved = await solveGoalSeek(objective, seed);
    if (solved === null) {
      const err = solError("#CONV!", `Goal seek couldn't drive "${gs.inputPortId}" to make "${gs.outputPortId}" reach ${gs.target}`);
      this.goalSeekResult = err;
      const row = await this.runPass(inputs); // show the un-solved state
      row[gs.outputPortId] = err;
      return row;
    }
    this.goalSeekResult = solved;
    // The composite's OUTPUT is its solution: emit the solved DRIVER value on the
    // target port (not the achieved output, which just equals the target). So the
    // Solution hero's socket carries the answer downstream — wire the break-even
    // units into the next calc, not the trivially-zero profit.
    const row = await this.runPass(inputs, { [gs.inputPortId]: solved });
    row[gs.outputPortId] = solved;
    return row;
  }
}

/** number / boolean / numeric-string → number, else NaN. Local (no excelFunctions
 *  dependency) — goal-seek only needs to read one scalar output as a number. */
function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/** Solve f(x) = 0 for x (f = observed output − target). Secant first (few
 *  evaluations for smooth objectives), then a bracket-expand + bisection fallback
 *  for robustness. Returns null when it can't converge (non-numeric objective, no
 *  sign change found, or a diverging step). */
async function solveGoalSeek(f: (x: number) => Promise<number>, x0: number): Promise<number | null> {
  const FTOL = 1e-7;   // |output − target|
  const XTOL = 1e-9;   // step size
  const MAX = 80;

  let a = x0;
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
    const c = b - (fb * (b - a)) / denom;
    if (!Number.isFinite(c)) break;
    const step = Math.abs(c - b);
    a = b; fa = fb;
    b = c; fb = await f(c);
    // A tiny step with a small residual is a solution; a tiny step with a LARGE
    // residual means secant stalled — fall through to the bracketing fallback.
    if (step < XTOL) { if (Number.isFinite(fb) && Math.abs(fb) <= 1e-4) return c; break; }
  }

  // ── Bracket-expand + bisection fallback ──
  let lo = x0;
  let flo = await f(lo);
  if (!Number.isFinite(flo)) return null;
  let hi = x0 + (x0 === 0 ? 1 : Math.abs(x0));
  let fhi = await f(hi);
  let span = Math.abs(hi - lo) || 1;
  for (let i = 0; i < 60 && (!Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)); i++) {
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
