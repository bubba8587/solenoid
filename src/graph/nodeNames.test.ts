import { nodeTypeName } from "./catalogUtils";
import { describe, expect, it } from "vitest";
import {
  nodeDisplayNames,
  listEndpoints,
  findEndpoint,
  nodeConnections,
} from "./nodeNames";

// Minimal node shape accepted by nodeDisplayNames.
function node(id: string, ctorName: string, label?: string) {
  return { id, label, inputs: {}, outputs: {}, constructor: { name: ctorName } };
}

// ─── nodeTypeName ─────────────────────────────────────────────────────────────

describe("nodeTypeName", () => {
  it("strips a trailing 'Node' suffix", () => {
    expect(nodeTypeName({ constructor: { name: "ArithmeticNode" } })).toBe("Arithmetic");
    expect(nodeTypeName({ constructor: { name: "TableNode" } })).toBe("Table");
    expect(nodeTypeName({ constructor: { name: "GroupNode" } })).toBe("Group");
  });

  it("splits camelCase into words after stripping 'Node'", () => {
    expect(nodeTypeName({ constructor: { name: "FormatControllerNode" } })).toBe("Format Controller");
    expect(nodeTypeName({ constructor: { name: "PersonalFinanceNode" } })).toBe("Personal Finance");
    expect(nodeTypeName({ constructor: { name: "DateParseNode" } })).toBe("Date Parse");
  });

  it("leaves all-caps abbreviations intact (no lowercase-uppercase boundary)", () => {
    expect(nodeTypeName({ constructor: { name: "TVMNode" } })).toBe("TVM");
    expect(nodeTypeName({ constructor: { name: "LNNode" } })).toBe("LN");
  });

  it("does NOT strip 'Node' when it appears at the start, but camelCase split still fires", () => {
    // "NodeCard" — /Node$/ doesn't match (not at end), but /([a-z])([A-Z])/ splits d→C
    expect(nodeTypeName({ constructor: { name: "NodeCard" } })).toBe("Node Card");
  });

  it("returns the name unchanged when there is no 'Node' suffix and no camelCase boundary", () => {
    expect(nodeTypeName({ constructor: { name: "Foo" } })).toBe("Foo");
  });

  it("handles a single-word lowercase class name", () => {
    expect(nodeTypeName({ constructor: { name: "add" } })).toBe("add");
  });
});

// ─── nodeDisplayNames ─────────────────────────────────────────────────────────

describe("nodeDisplayNames", () => {
  it("returns an empty map for an empty list", () => {
    expect(nodeDisplayNames([])).toEqual(new Map());
  });

  it("single node with a label → bare label", () => {
    const map = nodeDisplayNames([node("n1", "ArithmeticNode", "My Calc")]);
    expect(map.get("n1")).toBe("My Calc");
  });

  it("single node with no label → type name", () => {
    const map = nodeDisplayNames([node("n1", "ArithmeticNode")]);
    expect(map.get("n1")).toBe("Add");
  });

  it("whitespace-only label falls back to type name", () => {
    const map = nodeDisplayNames([node("n1", "ArithmeticNode", "   ")]);
    expect(map.get("n1")).toBe("Add");
  });

  it("unique labels stay bare (no index appended)", () => {
    const map = nodeDisplayNames([
      node("n1", "ArithmeticNode", "Revenue"),
      node("n2", "ArithmeticNode", "Cost"),
    ]);
    expect(map.get("n1")).toBe("Revenue");
    expect(map.get("n2")).toBe("Cost");
  });

  it("duplicate labels get 1-based numeric suffixes", () => {
    const map = nodeDisplayNames([
      node("n1", "ArithmeticNode", "Total"),
      node("n2", "ArithmeticNode", "Total"),
    ]);
    expect(map.get("n1")).toBe("Total 1");
    expect(map.get("n2")).toBe("Total 2");
  });

  it("three nodes with the same label get indices 1, 2, 3", () => {
    const map = nodeDisplayNames([
      node("a", "ArithmeticNode", "X"),
      node("b", "ArithmeticNode", "X"),
      node("c", "ArithmeticNode", "X"),
    ]);
    expect(map.get("a")).toBe("X 1");
    expect(map.get("b")).toBe("X 2");
    expect(map.get("c")).toBe("X 3");
  });

  it("unlabeled nodes sharing a type-name get numbered", () => {
    const map = nodeDisplayNames([
      node("n1", "ArithmeticNode"),
      node("n2", "ArithmeticNode"),
    ]);
    expect(map.get("n1")).toBe("Add 1");
    expect(map.get("n2")).toBe("Add 2");
  });

  it("mix of labeled and unlabeled nodes are independent groups", () => {
    const map = nodeDisplayNames([
      node("n1", "ArithmeticNode", "Revenue"),
      node("n2", "ArithmeticNode"),            // → "Add"
      node("n3", "ArithmeticNode"),            // → "Add"
    ]);
    expect(map.get("n1")).toBe("Revenue");     // unique label, stays bare
    expect(map.get("n2")).toBe("Add 1");
    expect(map.get("n3")).toBe("Add 2");
  });

  it("contains exactly one entry per node", () => {
    const nodes = [node("a", "FooNode"), node("b", "BarNode"), node("c", "FooNode")];
    const map = nodeDisplayNames(nodes);
    expect(map.size).toBe(3);
  });
});

// ─── listEndpoints / findEndpoint / nodeConnections (no-editor fallback) ──────

describe("listEndpoints — no editor", () => {
  it("returns [] when no editor is registered", () => {
    expect(listEndpoints("output")).toEqual([]);
    expect(listEndpoints("input")).toEqual([]);
  });
});

describe("findEndpoint — no editor", () => {
  it("returns undefined when no editor is registered", () => {
    expect(findEndpoint("output", "n1", "value")).toBeUndefined();
  });
});

describe("nodeConnections — no editor", () => {
  it("returns [] when no editor is registered", () => {
    expect(nodeConnections("n1")).toEqual([]);
  });
});
