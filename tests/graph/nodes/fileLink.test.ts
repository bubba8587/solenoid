import { describe, it, expect } from "vitest";
import { FileLinkNode } from "../../../src/graph/nodes/annotation";
import { extractInit } from "../../../src/graph/copyPaste";

describe("FileLinkNode", () => {
  // The value-carrying round-trip below is the real guard: persistenceSweep's
  // fixed point runs on DEFAULT instances, so a constructor dropping `path`
  // would pass it while losing every saved link.
  it("round-trips label, path, fileName and collapsed through extractInit", () => {
    const n = new FileLinkNode({
      label: "Q3 deck", path: "/Users/me/Docs/q3.pptx", fileName: "q3.pptx", collapsed: true,
    });
    const init = extractInit(n);
    expect(init).toMatchObject({
      label: "Q3 deck", path: "/Users/me/Docs/q3.pptx", fileName: "q3.pptx", collapsed: true,
    });
    // Fixed-width card: it owns no width, so none is snapshot.
    expect("width" in init).toBe(false);
    const n2 = new FileLinkNode(init);
    expect(n2.path).toBe("/Users/me/Docs/q3.pptx");
    expect(n2.fileName).toBe("q3.pptx");
    expect(n2.collapsed).toBe(true);
  });
});
