// [[C86]] membershipByGesture
import { describe, it, expect } from "vitest";
import { NodeEditor } from "rete";
import { GroupNode, DisplayNode } from "../../src/graph/rete-nodes";
import type { Schemes } from "../../src/graph/schemes";
import { rebuildGroupMembership, groupMembershipStore } from "../../src/graph/groupMembership";
import { paletteStore, resolveColor } from "../../src/graph/palette";

describe("group member tints", () => {
  it("follow a palette switch with no rebuild, and announce it", async () => {
    const editor = new NodeEditor<Schemes>();
    const m = new DisplayNode();
    await editor.addNode(m as never);
    await editor.addNode(new GroupNode({ members: [m.id], color: "teal" }) as never);
    rebuildGroupMembership(editor);
    const before = groupMembershipStore.color(m.id);
    expect(before).toBe(resolveColor("teal"));
    const v = groupMembershipStore.version();
    try {
      paletteStore.setActiveBase("Orchard");
      expect(groupMembershipStore.version()).not.toBe(v);
      expect(groupMembershipStore.color(m.id)).toBe(resolveColor("teal"));
      expect(groupMembershipStore.color(m.id)).not.toBe(before);
    } finally {
      paletteStore.setActiveBase("Default");
    }
  });
});
