// [[group-expand-push#A node joins or leaves a group only when you put it there]], [[C88]] collapsedGroupCard, [[auto-arrange-tidy#No layout action leaves two nodes or groups overlapping]]
import { GraphNode } from "../graphModel";

export class GroupNode extends GraphNode {
  label: string;
  members: string[];      // the authoritative set ([[group-expand-push#A node joins or leaves a group only when you put it there]])
  color: string;
  collapsed: boolean;
  width: number;
  height: number;
  lockedPosition: boolean; // [[auto-arrange-tidy#No layout action leaves two nodes or groups overlapping]]

  constructor(init?: {
    label?: string;
    members?: string[];
    color?: string;
    collapsed?: boolean;
    width?: number;
    height?: number;
    lockedPosition?: boolean;
  }) {
    super("Node Group");
    this.label = init?.label ?? "Node Group";
    this.members = init?.members ? [...init.members] : [];
    this.color = init?.color ?? "violet";
    this.collapsed = init?.collapsed ?? false;
    this.width = init?.width ?? 320;
    this.height = init?.height ?? 220;
    this.lockedPosition = init?.lockedPosition ?? false;
  }

  // No outputs, but DataflowEngine still fetches it.
  data(): Record<string, never> {
    return {};
  }
}
