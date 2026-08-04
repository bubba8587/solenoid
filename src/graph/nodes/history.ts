import { ClassicPreset } from "rete";

// ─── Session History ────────────────────────────────────────────────────────
// A live readout of the undo/redo stack (rete-history-plugin, wired in
// Canvas.tsx), distilled into a dated human-readable digest
// (historyDigest.ts). Doesn't persist any state of its own — it autogenerates
// from `history.getHistorySnapshot()` whenever it's on canvas (see
// SessionHistoryComponent). No inputs, no outputs: a pure readout, like a
// dashboard gauge onto app state rather than graph data.

export class SessionHistoryNode extends ClassicPreset.Node {
  color: string;
  width: number;
  height: number;
  collapsed: boolean;

  constructor(init?: { label?: string; color?: string; width?: number; height?: number; collapsed?: boolean }) {
    super(init?.label ?? "Session History");
    this.color = init?.color ?? "gray";
    this.width = init?.width ?? 280;
    this.height = init?.height ?? 240;
    this.collapsed = init?.collapsed ?? false;
  }

  data(): Record<string, never> {
    return {};
  }
}
