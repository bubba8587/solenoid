import { ClassicPreset } from "rete";
import { clamp } from "./mathUtils";

// ─── Presentation ───────────────────────────────────────────────────────────
// Presenter mode, kept deliberately light. Stores an ORDERED list
// of steps (a title + an explicit node-id set per step, picked from the current
// canvas selection — like a navigator list, not typed by hand). Stepping calls a
// per-step camera function built on flyToNode's pattern (flyToNodes, flyToNode.ts)
// — pan/zoom only. No isolate/highlight/dim; those are separate, unrelated
// mechanisms this deliberately doesn't touch.

export interface PresentationStep {
  title: string;
  nodeIds: string[];
}

export class PresentationNode extends ClassicPreset.Node {
  steps: PresentationStep[];
  activeIndex: number;
  color: string;
  width: number;
  height: number;
  collapsed: boolean;

  constructor(init?: {
    label?: string;
    steps?: PresentationStep[];
    activeIndex?: number;
    color?: string;
    width?: number;
    height?: number;
    collapsed?: boolean;
  }) {
    super(init?.label ?? "Presentation");
    this.steps = init?.steps ? init.steps.map((s) => ({ title: s.title, nodeIds: [...s.nodeIds] })) : [];
    this.activeIndex = init?.activeIndex ?? 0;
    this.color = init?.color ?? "violet";
    this.width = init?.width ?? 260;
    this.height = init?.height ?? 220;
    this.collapsed = init?.collapsed ?? false;
  }

  addStep(title: string, nodeIds: string[]): void {
    this.steps.push({ title, nodeIds: [...nodeIds] });
  }

  removeStep(index: number): void {
    if (index < 0 || index >= this.steps.length) return;
    this.steps.splice(index, 1);
    if (this.activeIndex >= this.steps.length) {
      this.activeIndex = Math.max(0, this.steps.length - 1);
    }
  }

  /** Swap a step with its neighbor (dir -1 = up, +1 = down) — the whole reorder
   *  UI, no drag-and-drop needed for a list this short. */
  moveStep(index: number, dir: -1 | 1): void {
    const j = index + dir;
    if (index < 0 || index >= this.steps.length || j < 0 || j >= this.steps.length) return;
    [this.steps[index], this.steps[j]] = [this.steps[j], this.steps[index]];
    if (this.activeIndex === index) this.activeIndex = j;
    else if (this.activeIndex === j) this.activeIndex = index;
  }

  renameStep(index: number, title: string): void {
    if (this.steps[index]) this.steps[index].title = title;
  }

  /** Clamp + set the active step; returns the resulting index (0 when empty). */
  goTo(index: number): number {
    if (this.steps.length === 0) { this.activeIndex = 0; return 0; }
    this.activeIndex = clamp(index, 0, this.steps.length - 1);
    return this.activeIndex;
  }
  next(): number { return this.goTo(this.activeIndex + 1); }
  prev(): number { return this.goTo(this.activeIndex - 1); }

  currentStep(): PresentationStep | undefined {
    return this.steps[this.activeIndex];
  }

  data(): Record<string, never> {
    return {};
  }
}
