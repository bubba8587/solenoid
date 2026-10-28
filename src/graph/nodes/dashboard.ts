// [[B11]] maximalMerge: the layout is the Record figure's grammar, as Frame Input's Form view reads it.
import { GraphNode } from "../graphModel";
import { trueAnyIn } from "./shared";
import { parseRecordLayout, type RecordPlacement } from "../recordLayout";
import { dropInputCables } from "../components/cablePrune";

export class DashboardNode extends GraphNode {
  static socketDocs: Record<string, string> = {};

  /** Persisted, and read in the constructor, so a saved cable finds its socket before the first compute. */
  layout: string;
  collapsed: boolean;
  width = 200; height = 96;

  private _values = new Map<string, unknown>();

  constructor(init?: { label?: string; layout?: string; collapsed?: boolean }) {
    super(init?.label ?? "Dashboard");
    this.layout = init?.layout ?? "";
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

  /** Departing inputs lose their cables before their sockets go ([[input-cable-pruning#The ordering rule]]). */
  async setLayout(text: string): Promise<void> {
    this.layout = text;
    const wanted = this.refKeys();
    const removed = Object.keys(this.inputs).filter((k) => !wanted.includes(k));
    await dropInputCables(this.id, removed);
    for (const k of removed) { this.removeInput(k); this._values.delete(k); }
    for (const k of wanted) if (!this.inputs[k]) this.addInput(k, trueAnyIn(k));
  }

  data(inputs?: Record<string, unknown[]>): Record<string, never> {
    this._values = new Map(this.refKeys().map((k) => [k, inputs?.[k] !== undefined ? (inputs[k][0] ?? null) : undefined]));
    return {};
  }
}
