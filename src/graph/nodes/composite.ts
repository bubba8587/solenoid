import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode, SolenoidConnection } from "../schemes";
import { anySocket } from "../sockets";
import { extractInit } from "../copyPaste";
import { installErrorGuards } from "../errorValue";
import { installInputCoercion } from "../coerceInputs";
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
export type CompositeRunMode = "single" | "scenarios";

/** One named input set for Scenarios mode. `overrides` is keyed by
 *  CompositeInputPort.id; a port with no entry falls back to its normal
 *  wired/default value for that run — a scenario only needs to name the
 *  inputs it actually changes. */
export interface CompositeScenario {
  id: string;
  name: string;
  overrides: Record<string, unknown>;
}

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
  width = 140;
  height = 70;
  constructor(init?: { label?: string }) {
    super("Composite Output");
    this.label = init?.label ?? "Output";
    this.addInput("value", new ClassicPreset.Input(anySocket, this.label));
  }
  data(inputs: Record<string, unknown[]>): { value: unknown } {
    return { value: inputs.value?.[0] ?? null };
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
  }) {
    super("Composite");
    this.label = init?.label ?? "Composite";
    this.width = init?.width ?? 240;
    this.height = init?.height ?? 140;
    this.inputPorts = (init?.inputPorts ?? []).map((p) => ({ ...p }));
    this.outputPorts = (init?.outputPorts ?? []).map((p) => ({ ...p }));
    this.runMode = init?.runMode ?? "single";
    this.scenarios = (init?.scenarios ?? []).map((s) => ({ ...s, overrides: { ...s.overrides } }));
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

  // ─── Compute ─────────────────────────────────────────────────────────────

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

  async data(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    if (this.runMode === "scenarios" && this.scenarios.length > 0) {
      const rows: Record<string, unknown>[] = [];
      for (const scenario of this.scenarios) {
        rows.push(await this.runPass(inputs, scenario.overrides));
      }
      const outputs: Record<string, unknown> = {};
      for (const port of this.outputPorts) outputs[port.id] = rows.map((r) => r[port.id]);
      this.cachedOutputs = outputs;
      return outputs;
    }
    const outputs = await this.runPass(inputs);
    this.cachedOutputs = outputs;
    return outputs;
  }
}
