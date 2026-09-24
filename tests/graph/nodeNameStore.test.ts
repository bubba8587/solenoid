// [[C19]] namingModel
import { describe, it, expect, beforeEach } from "vitest";
import { nodeNameStore } from "../../src/graph/nodeNameStore";

describe("nodeNameStore.claim", () => {
  beforeEach(() => nodeNameStore.clear());

  it("releases the id's old name when it claims a new one", () => {
    nodeNameStore.claim("n1", "Alpha", "NumberInputNode");
    expect(nodeNameStore.claim("n1", "Beta", "NumberInputNode")).toBe("Beta");
    expect(nodeNameStore.byName("Alpha")).toBeUndefined();
    expect(nodeNameStore.byName("Beta")).toBe("n1");
    expect(nodeNameStore.claim("n2", "Alpha", "NumberInputNode")).toBe("Alpha");
  });

  it("keeps the id's name when the claim is taken or invalid", () => {
    nodeNameStore.claim("n1", "Alpha", "NumberInputNode");
    nodeNameStore.claim("n2", "Beta", "NumberInputNode");
    expect(nodeNameStore.claim("n1", "Beta", "NumberInputNode")).toBe("Alpha");
    expect(nodeNameStore.claim("n1", "1bad", "NumberInputNode")).toBe("Alpha");
    expect(nodeNameStore.byName("Alpha")).toBe("n1");
  });
});
