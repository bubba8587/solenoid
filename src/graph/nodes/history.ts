import { ClassicPreset } from "rete";

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
