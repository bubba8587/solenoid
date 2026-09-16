import { ClassicPreset } from "rete";

// A real Rete node (selection, drag, persistence) with no sockets when expanded.

export class GroupNode extends ClassicPreset.Node {
  label: string;
  members: string[];      // member node ids (authoritative set)
  color: string;          // palette SLOT id (resolved to a hex at render); header / outline color
  collapsed: boolean;
  width: number;
  height: number;
  lockedPosition: boolean; // pins the top-left corner: no drag, and Tidy/Cleanup skip it

  constructor(init?: {
    label?: string;
    members?: string[];
    color?: string;
    collapsed?: boolean;
    width?: number;
    height?: number;
    lockedPosition?: boolean;
  }) {
    super("Group");
    this.label = init?.label ?? "Group";
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
