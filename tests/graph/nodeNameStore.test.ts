// [[B16]] oneFormulaSurface
import { describe, it, expect, beforeEach } from "vitest";
import { nodeNameStore } from "../../src/graph/nodeNameStore";

describe("nodeNameStore.claim", () => {
  beforeEach(() => nodeNameStore.clear());

  it("releases the id's old name when it claims a new one", () => {
    nodeNameStore.claim("n1", "Alpha", "ValueInputNode");
    expect(nodeNameStore.claim("n1", "Beta", "ValueInputNode")).toBe("Beta");
    expect(nodeNameStore.byName("Alpha")).toBeUndefined();
    expect(nodeNameStore.byName("Beta")).toBe("n1");
    expect(nodeNameStore.claim("n2", "Alpha", "ValueInputNode")).toBe("Alpha");
  });

  it("keeps the id's name when the claim is taken or invalid", () => {
    nodeNameStore.claim("n1", "Alpha", "ValueInputNode");
    nodeNameStore.claim("n2", "Beta", "ValueInputNode");
    expect(nodeNameStore.claim("n1", "Beta", "ValueInputNode")).toBe("Alpha");
    expect(nodeNameStore.claim("n1", "1bad", "ValueInputNode")).toBe("Alpha");
    expect(nodeNameStore.byName("Alpha")).toBe("n1");
  });
});
