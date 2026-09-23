// [[D52]], [[C77]]
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
import { isFrameValue, frameRowCount, frameFromRows, isCubeValue, cubeRowCount, cubeFromColumns } from "../frame";
import { isGraphRebuilding } from "../process";
import { loopMembers, seedLoopErrors } from "../graphCompute";
import { fireAlert } from "../alertStore";
import { compositeStaleStore } from "../compositeStaleStore";
import { formatScalar } from "../components/format";
import type { NodeCtor } from "../nodeCtorRegistry";
import { PlaceholderNode } from "./placeholder";
import { deriveMissingNodeSockets, remapNodeRefs, mapNodeRefs, type NodeRefs } from "../persistenceCore";

export type PortTier = "basic" | "advanced";
export type PortExposure = "hidden" | "exposed";

export interface CompositeInputPort {
  id: string;
  label: string;
  exposure: PortExposure;
  tier: PortTier;
  internalNodeId: string;
  default?: unknown;
}

export interface CompositeOutputPort {
  id: string;
  label: string;
  tier: PortTier;
  internalNodeId: string;
}

export interface CompositeSavedNode {
  id: string;
  type: string;
  init: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
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

export type CompositeRunMode = "single" | "manual" | "scenarios" | "data-table" | "simulation" | "goal-seek" | "montecarlo" | "by-row";

export interface CompositeGoalSeek {
  inputPortId: string;
  outputPortId: string;
  target: number;
  maxIterations?: number;
  tolerance?: number;
  boundsLo?: number;
  boundsHi?: number;
}

export interface CompositeMonteCarlo {
  samples: number;
  seed: number;
  correlations?: string;
}

export type CompositeStopOp = "gt" | "ge" | "lt" | "le" | "eq" | "ne";

export function byRowValues(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  if (isCubeValue(v)) {
    const n = cubeRowCount(v);
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(cubeFromColumns(v.columns.map((c) => ({ name: c.name, type: c.type, ...(c.format ? { format: c.format } : {}), cells: [c.cells[i] ?? null] }))));
    return out;
  }
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

export const BY_ROW_MAX_ROWS = 500;

/** A wired exposed port wins even when it carries a blank; only an unwired or hidden one takes the default ([[D33]] unwiredNotBlank). */
export function portSource(
  port: CompositeInputPort,
  marker: { defaultValue: number | null } | undefined,
  inputs: Record<string, unknown[] | undefined>,
): unknown {
  const wired = port.exposure === "exposed" ? inputs[port.id] : undefined;
  if (wired && wired.length > 0) return wired[0];
  return marker?.defaultValue ?? port.default ?? null;
}

export function stopConditionMet(raw: unknown, op: CompositeStopOp, value: number): boolean {
  if (raw === null || raw === undefined) return false; // Number(null) is 0, so guard first
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

export interface CompositeScenario {
  id: string;
  name: string;
  overrides: Record<string, unknown>;
}

export type CompositeDataTableValues = Record<string, unknown[]>;

export class CompositeInputNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "When the composite's outer input is connected, the outside value is used and the seed value here is ignored.",
  };

  label: string;
  value: unknown = null;
  externallyWired = false;
  goalDriver = false;
  solvedValue: number | SolError | null = null;
  modeNote: { tag: string; text: string } | null = null;
  defaultValue: number | null = null;
  uncertainty: number | null = null;
  distribution: DistributionKind = "normal";
  width = 140;
  height = 70;
  constructor(init?: { label?: string; defaultValue?: number | null; uncertainty?: number | null; distribution?: DistributionKind }) {
    super("Composite Input");
    this.label = init?.label ?? "Input";
    this.defaultValue = init?.defaultValue ?? null;
    this.uncertainty = init?.uncertainty ?? null;
    this.distribution = init?.distribution === "uniform" ? "uniform" : "normal";
    // Per-instance, not the shared trueAnySocket, so the container can retype it outside the adoption fixpoint.
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
  /** Named cachedResult so the error guard's short-circuit mirrors an error into it. */
  cachedResult: unknown = null;
  goalTarget: number | null = null;
  width = 140;
  height = 70;
  constructor(init?: { label?: string }) {
    super("Composite Output");
    this.label = init?.label ?? "Output";
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
  private _hydrating = false;
  cachedOutputs: Record<string, unknown> = {};
  runMode: CompositeRunMode;
  scenarios: CompositeScenario[];
  dataTableValues: CompositeDataTableValues;
  simulationSteps: number;
  stopWhenPortId: string;
  stopWhenOp: CompositeStopOp;
  stopWhenValue: number;
  byRowPortId: string;
  private lastByRowCapTotal: number | null = null;
  goalSeek: CompositeGoalSeek | null;
  monteCarlo: CompositeMonteCarlo | null;
  goalSeekResult: number | SolError | null = null;
  simLastSteps: number | null = null;

  solveRequested = false;
  solveInsideOnly = false;
  lastSolveKey: string | null = null;
  stale = false;
  internalEditSeq = 0;
  runSeq = 0;
  private _lastRunMode: CompositeRunMode | null = null;
  private _refIds = new WeakMap<object, number>();
  private _refSeq = 0;
  internalPositions: Record<string, { x: number; y: number }> = {};

  private _pending: CompositeInternalSnapshot | null = null;
  private _savedIds = new Map<string, string>();

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
    // Coercion installs first, so it is the inner wrapper, as on the main canvas.
    installInputCoercion(this.internalEditor);
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
      this.addOutput(p.id, new ClassicPreset.Output(new AdoptiveSocket(), p.label));
    }
  }

  get isHydrated(): boolean {
    return this._pending === null;
  }

  /** Not called from the constructor: the class registry imports the catalog, which imports this file. */
  async hydrate(reg: Map<string, NodeCtor>): Promise<void> {
    const pending = this._pending;
    if (!pending) return;
    this._pending = null;
    this._hydrating = true;
    const built = new Map<string, ClassicPreset.Node>();
    const unknownIds = new Set(pending.nodes.filter((sn) => !reg.has(sn.type)).map((sn) => sn.id));
    const phSockets = deriveMissingNodeSockets(unknownIds, pending.connections);
    for (const sn of pending.nodes) {
      const Ctor = reg.get(sn.type);
      let node: ClassicPreset.Node;
      if (!Ctor) {
        const sockets = phSockets.get(sn.id);
        const initLabel = sn.init?.label;
        node = new PlaceholderNode({
          missingType: sn.type,
          savedInit: { ...sn.init },
          savedLiterals: sn.literals,
          savedStringLiterals: sn.stringLiterals,
          inputKeys: sockets?.inputs,
          outputKeys: sockets?.outputs,
          label: typeof initLabel === "string" ? initLabel : sn.type,
        });
      } else {
        node = new Ctor({ ...sn.init });
        const anyNode = node as unknown as Record<string, unknown>;
        // [[C28]] literalsIffEditable: restore only onto classes that declare the map.
        if (sn.literals && typeof anyNode.literals === "object") anyNode.literals = { ...sn.literals };
        if (sn.stringLiterals && typeof anyNode.stringLiterals === "object") anyNode.stringLiterals = { ...sn.stringLiterals };
      }
      built.set(sn.id, node);
      this._savedIds.set(node.id, sn.id);
      // Guard after addNode, outside the coercion wrapper, so a ShapeError thrown while narrowing lands in the guard as #SHAPE!.
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
    const liveOf = new Map([...built].map(([savedId, n]) => [savedId, n.id]));
    const isLive = (id: string) => !!this.internalEditor.getNode(id);
    for (const node of built.values()) {
      remapNodeRefs(node as unknown as NodeRefs, liveOf, isLive);
      if (node instanceof PlaceholderNode) remapNodeRefs(node.savedInit, liveOf, isLive);
    }
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

  async restoreInternal(snap: CompositeInternalSnapshot, reg: Map<string, NodeCtor>): Promise<void> {
    for (const c of [...this.internalEditor.getConnections()]) {
      await this.internalEditor.removeConnection(c.id);
    }
    for (const n of [...this.internalEditor.getNodes()]) {
      await this.internalEditor.removeNode(n.id);
    }
    this.internalPositions = {};
    for (const p of [...this.inputPorts, ...this.outputPorts]) p.internalNodeId = this.savedInternalId(p.internalNodeId);
    this._savedIds.clear();
    this._pending = { nodes: [...snap.nodes], connections: [...snap.connections] };
    await this.hydrate(reg);
  }

  snapshotInternal(): CompositeInternalSnapshot {
    if (!this.isHydrated) return this._pending!;
    const sid = (id: string) => this.savedInternalId(id);
    const nodes: CompositeSavedNode[] = this.internalEditor.getNodes().map((n) => {
      const anyN = n as unknown as Record<string, unknown>;
      if (n instanceof PlaceholderNode) {
        const ph: CompositeSavedNode = { id: sid(n.id), type: n.missingType, init: mapNodeRefs(n.savedInit, sid) };
        if (n.savedLiterals) ph.literals = { ...n.savedLiterals };
        if (n.savedStringLiterals) ph.stringLiterals = { ...n.savedStringLiterals };
        const p = this.internalPositions[n.id];
        if (p) { ph.x = p.x; ph.y = p.y; }
        return ph;
      }
      const sn: CompositeSavedNode = { id: sid(n.id), type: n.constructor.name, init: mapNodeRefs(extractInit(n), sid) };
      // `value` is the last injected input, not state, so it stays out of the save.
      if (n instanceof CompositeInputNode) delete sn.init.value;
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
      source: sid(c.source),
      sourceOutput: c.sourceOutput as string,
      target: sid(c.target),
      targetInput: c.targetInput as string,
    }));
    return { nodes, connections };
  }

  savedInternalId(liveId: string): string {
    return this._savedIds.get(liveId) ?? liveId;
  }

  addInputPort(spec: Omit<CompositeInputPort, "id"> & { id?: string }): string {
    const id = spec.id ?? `in_${this.inputPorts.length}_${Math.random().toString(36).slice(2, 7)}`;
    this.inputPorts.push({ ...spec, id });
    if (spec.exposure === "exposed") this.addInput(id, new ClassicPreset.Input(new AdoptiveSocket(), spec.label));
    return id;
  }

  syncPortLabels(): void {
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

  removeInputPort(id: string): void {
    if (!this.inputPorts.some((p) => p.id === id)) return;
    this.inputPorts = this.inputPorts.filter((p) => p.id !== id);
    if (this.inputs[id]) this.removeInput(id);
    for (const s of this.scenarios) delete s.overrides[id];
    delete this.dataTableValues[id];
    if (this.goalSeek?.inputPortId === id) this.goalSeek = null;
    if (this.byRowPortId === id) this.byRowPortId = "";
  }

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

  setDataTableValues(portId: string, values: unknown[]): void {
    if (values.length === 0) delete this.dataTableValues[portId];
    else this.dataTableValues[portId] = values;
  }

  setGoalSeek(patch: Partial<CompositeGoalSeek>): void {
    const base: CompositeGoalSeek = this.goalSeek ?? {
      inputPortId: this.inputPorts.find((p) => p.exposure === "exposed")?.id ?? "",
      outputPortId: this.outputPorts[0]?.id ?? "",
      target: 0,
    };
    this.goalSeek = { ...base, ...patch };
  }

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

  private seedInternalLoopErrors(): void {
    seedLoopErrors(
      this.internalEditor,
      this.internalEngine,
      loopMembers(this.internalEditor),
      "Part of a circular dependency: the calculation feeds itself. Switch the container to Simulation mode to run it as a feedback loop.",
    );
  }

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
        : portSource(port, marker, inputs);
    }
    this.internalEngine.reset();
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
      const marker = this.internalEditor.getNode(port.internalNodeId);
      if (marker instanceof CompositeOutputNode) marker.cachedResult = series;
    }
    return outputs;
  }

  private async runSimulation(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    for (const port of this.inputPorts) {
      const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
      if (!marker) continue;
      marker.value = portSource(port, marker, inputs);
    }
    this.internalEngine.reset();
    this.simLastSteps = null;

    const loop = loopMembers(this.internalEditor);
    if (loop.size === 0) return this.runPass(inputs);

    const conns = this.internalEditor.getConnections();
    const incomingByTarget = new Map<string, typeof conns>();
    for (const c of conns) {
      if (!loop.has(c.target)) continue;
      (incomingByTarget.get(c.target) ?? incomingByTarget.set(c.target, []).get(c.target)!).push(c);
    }

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
          if (srcOut === undefined) continue;
          (nodeInputs[c.targetInput] ??= []).push(srcOut[c.sourceOutput] ?? null);
        }
        state.set(id, await Promise.resolve(node.data(nodeInputs)) as Record<string, unknown>);
      }
      const snapshot: Record<string, Record<string, unknown>> = {};
      for (const id of loopOrder) snapshot[id] = state.get(id)!;
      fullSeries.push(snapshot);
      if (stopFeed && (await this.stopSignalTrue(stopFeed, state, loop))) break;
    }
    this.simLastSteps = fullSeries.length;

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

  private resolveStopFeed(conns: ReturnType<NodeEditor<Schemes>["getConnections"]>) {
    if (!this.stopWhenPortId) return null;
    const port = this.outputPorts.find((p) => p.id === this.stopWhenPortId);
    if (!port) return null;
    const marker = this.internalEditor.getNode(port.internalNodeId);
    if (!marker) return null;
    return conns.find((c) => c.target === marker.id && c.targetInput === "value") ?? null;
  }

  /** The reset is required, or a prior round's cached observer value leaks into this one. */
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
    const gsDriverId = this.runMode === "goal-seek" ? this.goalSeek?.inputPortId : undefined;
    for (const port of this.inputPorts) {
      const m = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
      if (!m) continue;
      m.externallyWired = port.exposure === "exposed" && inputs[port.id]?.[0] !== undefined;
      m.goalDriver = port.id === gsDriverId;
      if (!m.goalDriver) m.solvedValue = null;
      m.modeNote = this.inputModeNote(port, m);
    }
    const gsTargetId = this.runMode === "goal-seek" ? this.goalSeek?.outputPortId : undefined;
    for (const port of this.outputPorts) {
      const m = this.internalEditor.getNode(port.internalNodeId) as CompositeOutputNode | undefined;
      if (m) m.goalTarget = port.id === gsTargetId ? (this.goalSeek?.target ?? null) : null;
    }
    resolveTrigModes(this.internalEditor);
    const heavy = this.isHeavyMode();
    if (heavy && this.runMode !== this._lastRunMode) this.lastSolveKey = null;
    this._lastRunMode = this.runMode;
    if (heavy) {
      const key = this.solveKey(inputs);
      if (this.solveRequested) {
        const solveInputs = this.solveInsideOnly ? {} : inputs;
        const outputs = await this.runActiveMode(solveInputs);
        this.cachedOutputs = outputs;
        // Key on the real inputs, not solveInputs, to match the hold branch.
        this.lastSolveKey = this.solveKey(inputs);
        this.solveRequested = false;
        this.solveInsideOnly = false;
        this.stale = false;
        compositeStaleStore.set(this.id, false);
        return outputs;
      }
      if (this.lastSolveKey === null) {
        // Every output key, blank: the engine refuses a result missing a key.
        const blank: Record<string, unknown> = Object.fromEntries(Object.keys(this.outputs).map((k) => [k, null]));
        this.cachedOutputs = blank;
        this.goalSeekResult = null;
        for (const port of this.inputPorts) {
          const m = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
          if (m) m.solvedValue = null;
        }
        this.stale = true;
        compositeStaleStore.set(this.id, true);
        return blank;
      }
      this.stale = key !== this.lastSolveKey;
      compositeStaleStore.set(this.id, this.stale);
      return this.cachedOutputs;
    }
    const outputs = await this.runActiveMode(inputs);
    this.cachedOutputs = outputs;
    this.stale = false;
    compositeStaleStore.set(this.id, false);
    return outputs;
  }

  isHeavyMode(): boolean {
    if (this.runMode === "manual") return true;
    if (this.runMode === "simulation") return true;
    if (this.runMode === "scenarios") return this.scenarios.length > 0;
    if (this.runMode === "goal-seek") return !!this.goalSeek;
    if (this.runMode === "montecarlo") return this.uncertainInputPorts().length > 0;
    if (this.runMode === "by-row") return this.inputPorts.some((p) => p.id === this.byRowPortId);
    if (this.runMode === "data-table") {
      return this.inputPorts.some(
        (p) => p.exposure === "exposed" && (this.dataTableValues[p.id]?.length ?? 0) > 0,
      );
    }
    return false;
  }

  requestSolve(insideOnly = false): void {
    this.solveRequested = true;
    this.solveInsideOnly = insideOnly && this.runMode !== "manual";
  }

  markInternalEdit(): void { this.internalEditSeq++; }

  settleInternalTypes(): boolean {
    settleWildcardTypes(this.internalEditor);
    return this.adoptBoundaryTypes();
  }

  adoptBoundaryTypes(): boolean {
    const conns = this.internalEditor.getConnections();
    let changed = false;
    for (const port of this.outputPorts) {
      const outSock = this.outputs[port.id]?.socket;
      if (!(outSock instanceof MutableSocket)) continue;
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

  private solveKey(inputs: Record<string, unknown[]>): string {
    const token = (v: unknown): unknown => {
      if (v === null || typeof v !== "object") return v;
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
      seeds: this.inputPorts.map((p) => (this.internalEditor.getNode(p.internalNodeId) as CompositeInputNode | undefined)?.defaultValue ?? null),
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

  private async runActiveMode(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    if (this.runMode === "simulation") {
      return this.runSimulation(inputs);
    } else if (this.runMode === "scenarios" && this.scenarios.length > 0) {
      return this.collectMultiple(inputs, this.scenarios.map((s) => s.overrides));
    } else if (this.runMode === "data-table") {
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

  private async runByRow(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    const port = this.inputPorts.find((p) => p.id === this.byRowPortId);
    if (!port) return this.runPass(inputs);
    const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode | undefined;
    const source = portSource(port, marker, inputs);
    let rows = byRowValues(source);
    if (rows.length === 0) return this.runPass(inputs);
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

  private async runMonteCarlo(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    const uncertainPorts = this.uncertainInputPorts();
    if (uncertainPorts.length === 0) return this.runPass(inputs);
    const cfg = this.monteCarlo ?? { samples: DEFAULT_MC_SAMPLES, seed: DEFAULT_MC_SEED };
    const draws = Math.max(1, Math.round(cfg.samples));
    const rng = mulberry32((cfg.seed | 0) >>> 0);

    const meanOf = (port: CompositeInputPort, marker: CompositeInputNode): number | null => {
      const wired = port.exposure === "exposed" && port.id in inputs ? inputs[port.id]?.[0] : undefined;
      const raw = wired === undefined ? (marker.defaultValue ?? port.default ?? 0) : wired;
      const n = toNumber(raw);
      return Number.isFinite(n) ? n : null;
    };
    const means = uncertainPorts.map((port) => meanOf(port, this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode));
    if (means.some((m) => m === null)) {
      const outputs: Record<string, unknown> = {};
      for (const port of this.outputPorts) {
        outputs[port.id] = null;
        const marker = this.internalEditor.getNode(port.internalNodeId);
        if (marker instanceof CompositeOutputNode) marker.cachedResult = null;
      }
      return outputs;
    }
    const specs = uncertainPorts.map((port, i) => {
      const marker = this.internalEditor.getNode(port.internalNodeId) as CompositeInputNode;
      return { port, marker, mean: means[i] as number, spread: marker.uncertainty as number, kind: marker.distribution };
    });

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
      const marker = this.internalEditor.getNode(port.internalNodeId);
      if (marker instanceof CompositeOutputNode) marker.cachedResult = summary;
    }
    return outputs;
  }

  private async runGoalSeek(inputs: Record<string, unknown[]>, gs: CompositeGoalSeek): Promise<Record<string, unknown>> {
    const objective = async (x: number): Promise<number> => {
      const row = await this.runPass(inputs, { [gs.inputPortId]: x });
      return toNumber(row[gs.outputPortId]) - gs.target;
    };
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
      const row = await this.runPass(inputs);
      row[gs.outputPortId] = err;
      return row;
    }
    const solved = Number(solvedRaw.toPrecision(12));
    this.goalSeekResult = solved;
    if (driverMarker) driverMarker.solvedValue = solved;
    const row = await this.runPass(inputs, { [gs.inputPortId]: solved });
    row[gs.outputPortId] = solved;
    return row;
  }
}

async function solveGoalSeek(
  f: (x: number) => Promise<number>,
  x0: number,
  opts?: { maxIterations?: number; tolerance?: number; boundsLo?: number; boundsHi?: number },
): Promise<number | null> {
  const FTOL = opts?.tolerance != null && opts.tolerance > 0 ? opts.tolerance : 1e-7;
  const XTOL = 1e-9;
  const MAX = opts?.maxIterations != null && opts.maxIterations >= 1 ? Math.round(opts.maxIterations) : 80;
  const LO = opts?.boundsLo;
  const HI = opts?.boundsHi;
  const hasBounds = LO != null && HI != null && Number.isFinite(LO) && Number.isFinite(HI) && LO < HI;
  const clamp = (x: number): number => (hasBounds ? Math.min(HI!, Math.max(LO!, x)) : x);

  let a = clamp(x0);
  let fa = await f(a);
  if (!Number.isFinite(fa)) return null;
  if (Math.abs(fa) <= FTOL) return a;
  let b = a + (a === 0 ? 1 : Math.abs(a) * 1e-3);
  let fb = await f(b);

  for (let i = 0; i < MAX && Number.isFinite(fb); i++) {
    if (Math.abs(fb) <= FTOL) return b;
    const denom = fb - fa;
    if (denom === 0) break;
    const c = clamp(b - (fb * (b - a)) / denom);
    if (!Number.isFinite(c)) break;
    const step = Math.abs(c - b);
    a = b; fa = fb;
    b = c; fb = await f(c);
    if (step < XTOL) { if (Number.isFinite(fb) && Math.abs(fb) <= FTOL) return c; break; }
  }

  let lo = hasBounds ? LO! : x0;
  let flo = await f(lo);
  if (!Number.isFinite(flo)) return null;
  let hi = hasBounds ? HI! : x0 + (x0 === 0 ? 1 : Math.abs(x0));
  let fhi = await f(hi);
  let span = Math.abs(hi - lo) || 1;
  for (let i = 0; !hasBounds && i < 60 && (!Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)); i++) {
    span *= 2;
    hi = x0 + (i % 2 === 0 ? span : -span);
    fhi = await f(hi);
  }
  if (!Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = await f(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) <= FTOL || Math.abs(hi - lo) < XTOL) return mid;
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}
