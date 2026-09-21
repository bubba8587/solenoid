// [[C87]] groupsAreSubflows, [[C86]] membershipByGesture, [[C88]] collapseIsVisual, [[D63]] lockedGroupIsObstacle, [[C37]] observerOwnsSize
import { ClassicPreset } from "rete";

export class GroupNode extends ClassicPreset.Node {
  label: string;
  members: string[];      // the authoritative set ([[C86]] membershipByGesture)
  color: string;          // palette SLOT id (resolved to a hex at render); header / outline color
  collapsed: boolean;
  width: number;
  height: number;
  lockedPosition: boolean; // [[D63]] lockedGroupIsObstacle

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
