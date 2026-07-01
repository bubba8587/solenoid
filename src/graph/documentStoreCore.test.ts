import { describe, it, expect } from "vitest";
import {
  emptyLibrary,
  addDocument,
  renameDocument,
  setCurrent,
  setDocPath,
  updateCurrentGraph,
  removeDocument,
  duplicateDocument,
  getCurrent,
  uniqueName,
  validateLibrary,
  type DocLibrary,
  type SolDoc,
} from "./documentStoreCore";
import type { SavedGraph } from "./persistence";

const graph = (n = 0): SavedGraph => ({ v: 2, nodes: [], connections: [] as never, ...(n ? {} : {}) });
const doc = (id: string, name: string, updatedAt = 0): SolDoc => ({ id, name, graph: graph(), updatedAt });

describe("addDocument / getCurrent", () => {
  it("adds most-recent-first and makes the new doc current", () => {
    let lib = emptyLibrary();
    lib = addDocument(lib, doc("a", "A"));
    lib = addDocument(lib, doc("b", "B"));
    expect(lib.documents.map((d) => d.id)).toEqual(["b", "a"]);
    expect(lib.currentId).toBe("b");
    expect(getCurrent(lib)?.name).toBe("B");
  });
});

describe("file path (disk binding)", () => {
  it("setDocPath binds a path and optionally renames", () => {
    let lib = addDocument(emptyLibrary(), doc("a", "Untitled"));
    lib = setDocPath(lib, "a", "/home/me/graphs/Budget.json", "Budget");
    expect(getCurrent(lib)?.filePath).toBe("/home/me/graphs/Budget.json");
    expect(getCurrent(lib)?.name).toBe("Budget");
  });

  it("a duplicate does NOT inherit the source's path (it's a new unsaved file)", () => {
    let lib = addDocument(emptyLibrary(), doc("a", "Budget"));
    lib = setDocPath(lib, "a", "/home/me/Budget.json");
    lib = duplicateDocument(lib, "a", "a2", "Budget copy");
    expect(getCurrent(lib)?.id).toBe("a2");
    expect(getCurrent(lib)?.filePath).toBeUndefined();
  });

  it("validateLibrary round-trips a filePath", () => {
    const raw = {
      v: 1,
      currentId: "a",
      documents: [{ id: "a", name: "Budget", graph: graph(), updatedAt: 0, filePath: "/x/Budget.json" }],
    };
    expect(validateLibrary(raw)?.documents[0].filePath).toBe("/x/Budget.json");
  });
});

describe("uniqueName", () => {
  it("returns the base when free, else suffixes", () => {
    let lib = emptyLibrary();
    expect(uniqueName(lib, "Untitled")).toBe("Untitled");
    lib = addDocument(lib, doc("a", "Untitled"));
    expect(uniqueName(lib, "Untitled")).toBe("Untitled 2");
    lib = addDocument(lib, doc("b", "Untitled 2"));
    expect(uniqueName(lib, "Untitled")).toBe("Untitled 3");
  });
});

describe("renameDocument", () => {
  it("renames by id and ignores an empty/whitespace name", () => {
    let lib = addDocument(emptyLibrary(), doc("a", "A"));
    lib = renameDocument(lib, "a", "  Budget  ");
    expect(getCurrent(lib)?.name).toBe("Budget");
    lib = renameDocument(lib, "a", "   ");
    expect(getCurrent(lib)?.name).toBe("Budget"); // unchanged
  });
});

describe("updateCurrentGraph", () => {
  it("writes the graph into the current doc, bumps updatedAt, floats it to top", () => {
    let lib = emptyLibrary();
    lib = addDocument(lib, doc("a", "A", 1));
    lib = addDocument(lib, doc("b", "B", 2));
    lib = setCurrent(lib, "a");
    const g2: SavedGraph = { v: 2, nodes: [{ id: "n", type: "ConstantNode", x: 0, y: 0, init: {} }], connections: [] as never };
    lib = updateCurrentGraph(lib, g2, 99);
    expect(lib.documents[0].id).toBe("a"); // floated to top
    expect(lib.documents[0].updatedAt).toBe(99);
    expect(lib.documents[0].graph.nodes.length).toBe(1);
  });

  it("is a no-op when there is no current doc", () => {
    const lib = emptyLibrary();
    expect(updateCurrentGraph(lib, graph(), 5)).toEqual(lib);
  });
});

describe("removeDocument", () => {
  it("drops the doc and moves current to the next most-recent", () => {
    let lib = emptyLibrary();
    lib = addDocument(lib, doc("a", "A"));
    lib = addDocument(lib, doc("b", "B")); // current = b, order [b, a]
    lib = removeDocument(lib, "b");
    expect(lib.documents.map((d) => d.id)).toEqual(["a"]);
    expect(lib.currentId).toBe("a");
  });

  it("leaves currentId null when the last doc is removed", () => {
    let lib = addDocument(emptyLibrary(), doc("a", "A"));
    lib = removeDocument(lib, "a");
    expect(lib.documents).toEqual([]);
    expect(lib.currentId).toBeNull();
  });

  it("does not move current when a non-current doc is removed", () => {
    let lib = emptyLibrary();
    lib = addDocument(lib, doc("a", "A"));
    lib = addDocument(lib, doc("b", "B")); // current = b
    lib = removeDocument(lib, "a");
    expect(lib.currentId).toBe("b");
  });
});

describe("duplicateDocument", () => {
  it("copies the graph under a new id+name and makes it current", () => {
    let lib = addDocument(emptyLibrary(), doc("a", "A"));
    lib = duplicateDocument(lib, "a", "a2", "A copy");
    expect(lib.currentId).toBe("a2");
    expect(lib.documents[0]).toMatchObject({ id: "a2", name: "A copy" });
    expect(lib.documents.length).toBe(2);
  });
});

describe("validateLibrary", () => {
  const good: DocLibrary = {
    v: 1,
    documents: [doc("a", "A", 10), doc("b", "B", 20)],
    currentId: "b",
  };

  it("accepts a well-formed library", () => {
    expect(validateLibrary(good)).toMatchObject({ currentId: "b" });
    expect(validateLibrary(good)?.documents.length).toBe(2);
  });

  it("repairs a dangling currentId to the first document", () => {
    const lib = validateLibrary({ ...good, currentId: "ghost" });
    expect(lib?.currentId).toBe("a");
  });

  it("rejects a non-object / missing documents array", () => {
    expect(validateLibrary(null)).toBeNull();
    expect(validateLibrary({ currentId: "a" })).toBeNull();
  });

  it("rejects a document with a non-string id or a bad graph", () => {
    expect(validateLibrary({ documents: [{ id: 1, name: "x", graph: graph() }], currentId: null })).toBeNull();
    expect(validateLibrary({ documents: [{ id: "a", name: "x", graph: { nodes: "no" } }], currentId: null })).toBeNull();
  });
});
