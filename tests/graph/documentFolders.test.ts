// [[C132]] workspaceTree
import { describe, it, expect } from "vitest";
import {
  emptyLibrary,
  addDocument,
  addFolder,
  allFolders,
  documentsIn,
  duplicateDocument,
  moveDocument,
  moveFolder,
  normalizeFolder,
  removeFolder,
  renameFolder,
  validateLibrary,
  type DocLibrary,
  type SolDoc,
} from "../../src/graph/documentStoreCore";

const doc = (id: string, folder?: string): SolDoc => ({ id, name: id, graph: { v: 2, nodes: [], connections: [] }, updatedAt: 0, ...(folder ? { folder } : {}) });
const lib = (...docs: SolDoc[]): DocLibrary => docs.reduce(addDocument, emptyLibrary());
const folderOf = (l: DocLibrary, id: string) => l.documents.find((d) => d.id === id)?.folder;

describe("folder paths", () => {
  it("normalize trims segments and drops empty ones", () => {
    expect(normalizeFolder(" Finance / /2026/ ")).toBe("Finance/2026");
    expect(normalizeFolder(undefined)).toBe("");
  });

  it("a document's folder brings its ancestors into existence", () => {
    expect(allFolders(lib(doc("a", "Finance/2026/Q3")))).toEqual(["Finance", "Finance/2026", "Finance/2026/Q3"]);
  });
});

describe("addFolder", () => {
  it("names a new folder uniquely among its siblings only", () => {
    let l = lib(doc("a", "Work/New folder"));
    const r1 = addFolder(l, "Work", "New folder");
    expect(r1.path).toBe("Work/New folder 2");
    const r2 = addFolder(r1.lib, "", "New folder");
    expect(r2.path).toBe("New folder");
    l = r2.lib;
    expect(allFolders(l)).toContain("Work/New folder 2");
  });

  it("a slash in a typed name can't make a hidden level", () => {
    expect(addFolder(emptyLibrary(), "", "a/b").path).toBe("a b");
  });
});

describe("moveDocument", () => {
  it("returns a new document object, and drops the key at the root", () => {
    const l0 = lib(doc("a"));
    const l1 = moveDocument(l0, "a", "Finance");
    expect(folderOf(l1, "a")).toBe("Finance");
    expect(l1.documents[0]).not.toBe(l0.documents[0]);
    const l2 = moveDocument(l1, "a", "");
    expect("folder" in l2.documents[0]).toBe(false);
  });

  it("a move to where the document already is changes nothing", () => {
    const l0 = lib(doc("a", "X"));
    expect(moveDocument(l0, "a", "X")).toBe(l0);
  });

  it("a duplicate stays in its source's folder", () => {
    const l = duplicateDocument(lib(doc("a", "X")), "a", "b", "a copy");
    expect(folderOf(l, "b")).toBe("X");
  });
});

describe("renameFolder", () => {
  it("carries every subfolder and document under it along", () => {
    let l = lib(doc("a", "Fin/2026"), doc("b", "Fin"), doc("c", "Finance"));
    l = addFolder(l, "Fin", "Empty").lib;
    const r = renameFolder(l, "Fin", "Money");
    expect(r.path).toBe("Money");
    expect(folderOf(r.lib, "a")).toBe("Money/2026");
    expect(folderOf(r.lib, "b")).toBe("Money");
    expect(folderOf(r.lib, "c")).toBe("Finance");
    expect(allFolders(r.lib)).toEqual(["Finance", "Money", "Money/2026", "Money/Empty"]);
  });

  it("a name a sibling already has takes a number", () => {
    const l = lib(doc("a", "A"), doc("b", "B"));
    expect(renameFolder(l, "B", "A").path).toBe("A 2");
  });
});

describe("moveFolder", () => {
  it("moves a folder under another", () => {
    const r = moveFolder(lib(doc("a", "X/Y"), doc("b", "Z")), "X", "Z");
    expect(r.path).toBe("Z/X");
    expect(folderOf(r.lib, "a")).toBe("Z/X/Y");
  });

  it("refuses a move into itself or its own subfolder", () => {
    const l = lib(doc("a", "X/Y"));
    expect(moveFolder(l, "X", "X/Y").lib).toBe(l);
    expect(moveFolder(l, "X", "X").lib).toBe(l);
  });
});

describe("removeFolder", () => {
  it("removes the folder, its subfolders and every document under them", () => {
    let l = lib(doc("a", "X"), doc("b", "X/Y"), doc("c", "XY"), doc("d"));
    l = addFolder(l, "X", "Empty").lib;
    expect(documentsIn(l, "X").map((d) => d.id).sort()).toEqual(["a", "b"]);
    l = removeFolder(l, "X");
    expect(l.documents.map((d) => d.id).sort()).toEqual(["c", "d"]);
    expect(allFolders(l)).toEqual(["XY"]);
  });
});

describe("validateLibrary keeps folders", () => {
  it("normalizes the listing and the documents' paths", () => {
    const l = validateLibrary({ documents: [doc("a", " A / B ")], currentId: "a", folders: [" E ", "", 3] });
    expect(l?.folders).toEqual(["E"]);
    expect(l?.documents[0].folder).toBe("A/B");
  });
});
