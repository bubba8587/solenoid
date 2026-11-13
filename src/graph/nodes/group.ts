// [[group-expand-push#Who is a member]], [[C88]] collapsedGroupCard, [[group-expand-push#LayoutFx]]
import { GraphNode } from "../graphModel";

export class GroupNode extends GraphNode {
  label: string;
  members: string[];      // the authoritative set ([[group-expand-push#Who is a member]])
  color: string;
  collapsed: boolean;
  width: number;
  height: number;
  lockedPosition: boolean; // [[group-expand-push#LayoutFx]]

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
