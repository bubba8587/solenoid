import { describe, it, expect } from "vitest";
import { FileLinkNode } from "./annotation";
import { extractInit } from "../copyPaste";

describe("FileLinkNode", () => {
  it("defaults to an empty, socketless link", () => {
    const n = new FileLinkNode();
    expect(n.label).toBe("File Link");
    expect(n.path).toBe("");
    expect(n.fileName).toBe("");
    // No sockets — a link carries nothing into the graph.
    expect(Object.keys(n.inputs)).toEqual([]);
    expect(Object.keys(n.outputs)).toEqual([]);
    // Nothing to compute: a link has no data() to wrap.
    expect((n as unknown as { data?: unknown }).data).toBeUndefined();
  });

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
