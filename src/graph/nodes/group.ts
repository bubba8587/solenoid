import { ClassicPreset } from "rete";

// ─── Group node ─────────────────────────────────────────────────────────────────
// A visual container that wraps a set of member nodes. It is a real Rete node (so
// it participates in selection, drag, persistence, copy/paste) but has no sockets
// when expanded — it's purely a frame. Membership is an explicit id set, seeded
// from the selection at creation and reconciled spatially as nodes are dragged in
// and out of the box (the "hybrid" model). Move-together, z-ordering (behind its
// members), and the collapse engine live in Canvas.

export class GroupNode extends ClassicPreset.Node {
  label: string;
  members: string[];      // member node ids (authoritative set)
  color: string;          // palette SLOT id (resolved to a hex at render); header / outline color
  collapsed: boolean;
  width: number;
  height: number;

  constructor(init?: {
    label?: string;
    members?: string[];
    color?: string;
    collapsed?: boolean;
    width?: number;
    height?: number;
  }) {
    super("Group");
    this.label = init?.label ?? "Group";
    this.members = init?.members ? [...init.members] : [];
    this.color = init?.color ?? "violet";
    this.collapsed = init?.collapsed ?? false;
    this.width = init?.width ?? 320;
    this.height = init?.height ?? 220;
  }

  // No outputs — the group produces no data. (DataflowEngine still fetches it.)
  data(): Record<string, never> {
    return {};
  }
}
