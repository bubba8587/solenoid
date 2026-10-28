// [[B11]] maximalMerge: the layout is the Record figure's grammar, as Frame Input's Form view reads it.
import { GraphNode, GraphConnection } from "../graphModel";
import { getOwningEditor } from "../activeGraph";
import { trueAnyIn } from "./shared";
import { parseRecordLayout, type RecordPlacement } from "../recordLayout";
import { dropInputCables } from "../components/cablePrune";
import type { SolenoidConnection } from "../schemes";

export class DashboardNode extends GraphNode {
  static socketDocs: Record<string, string> = {};

  /** Persisted, and read in the constructor, so a saved cable finds its socket before the first compute. */
  layout: string;
  collapsed: boolean;
  /** A palette slot per box name, for the box's tint. */
  boxColors: Record<string, string>;
  width = 200; height = 96;

  private _values = new Map<string, unknown>();

  constructor(init?: { label?: string; layout?: string; collapsed?: boolean; boxColors?: Record<string, string> }) {
    super(init?.label ?? "Dashboard");
    this.layout = init?.layout ?? "";
    this.boxColors = { ...init?.boxColors };
    this.collapsed = init?.collapsed ?? false;
    for (const key of this.refKeys()) this.addInput(key, trueAnyIn(key));
  }

  placements(): RecordPlacement[] {
    return this.layout.trim() ? parseRecordLayout(this.layout) : [];
  }

  /** One input per box, in reading order. */
  refKeys(): string[] {
    return this.placements().map((p) => p.name);
  }

  refValue(key: string): unknown {
    return this._values.get(key);
  }

  /** Departing inputs lose their cables before their sockets go ([[input-cable-pruning#The ordering rule]]).
   *  `renames` (new name → old name) carries a renamed box's cable over to its new socket. */
  async setLayout(text: string, renames: ReadonlyMap<string, string> = new Map()): Promise<void> {
    const ed = getOwningEditor(this.id);
    const carried = [...renames].flatMap(([to, from]) => (ed?.getConnections() ?? [])
      .filter((c) => c.target === this.id && c.targetInput === from)
      .map((c) => ({ to, source: c.source, sourceOutput: c.sourceOutput })));
    this.layout = text;
    const wanted = this.refKeys();
    const removed = Object.keys(this.inputs).filter((k) => !wanted.includes(k));
    await dropInputCables(this.id, removed);
    for (const k of removed) { this.removeInput(k); this._values.delete(k); }
    const colors: Record<string, string> = {};
    for (const k of wanted) { const c = this.boxColors[k] ?? this.boxColors[renames.get(k) ?? ""]; if (c) colors[k] = c; }
    this.boxColors = colors;
    for (const k of wanted) if (!this.inputs[k]) this.addInput(k, trueAnyIn(k));
    for (const c of carried) {
      const source = ed?.getNode(c.source);
      if (!ed || !source || !this.inputs[c.to]) continue;
      if (ed.getConnections().some((x) => x.target === this.id && x.targetInput === c.to)) continue;
      await ed.addConnection(new GraphConnection(source, c.sourceOutput, this, c.to) as SolenoidConnection);
    }
  }

  data(inputs?: Record<string, unknown[]>): Record<string, never> {
    this._values = new Map(this.refKeys().map((k) => [k, inputs?.[k] !== undefined ? (inputs[k][0] ?? null) : undefined]));
    return {};
  }
}
