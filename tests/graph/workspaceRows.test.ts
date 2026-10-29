// [[C132]] workspaceTree
import { describe, it, expect } from "vitest";
import { libraryRows, previewRows, revealKeys, rekeyExpanded, folderKey, docFoldedKey, docKey, treeKeyStep, typeAhead } from "../../src/graph/workspaceRows";
import { PREVIEW_WORKSPACE } from "../../src/graph/workspacePreview";

const docs = [
  { id: "1", name: "Budget 10", current: false, folder: "Finance" },
  { id: "2", name: "Budget 9", current: true, folder: "Finance" },
  { id: "3", name: "Notes", current: false, folder: "" },
  { id: "4", name: "Q3", current: false, folder: "Finance/2026" },
];
const folders = ["Finance", "Finance/2026", "Projects"];
const show = (rows: ReturnType<typeof libraryRows>) => rows.map((r) => `${"  ".repeat(r.depth)}${r.kind}:${r.label}${r.open ? "*" : ""}`);

describe("libraryRows", () => {
  it("folders before documents, names compared as numbers, a folded folder hides its rows", () => {
    expect(show(libraryRows(docs, folders, new Set(), false))).toEqual(["folder:Finance", "folder:Projects", "doc:Notes"]);
    expect(show(libraryRows(docs, folders, new Set([folderKey("Finance")]), false))).toEqual([
      "folder:Finance", "  folder:2026", "  doc:Budget 9*", "  doc:Budget 10", "folder:Projects", "doc:Notes",
    ]);
  });

  it("an empty folder has nothing to fold", () => {
    const projects = libraryRows(docs, folders, new Set([folderKey("Projects")]), false).find((r) => r.label === "Projects")!;
    expect(projects.expandable).toBe(false);
  });

  it("only the open document folds an outline, and only in the one-tree layout", () => {
    const exp = new Set([folderKey("Finance")]);
    const stacked = libraryRows(docs, folders, exp, false).find((r) => r.key === docKey("2"))!;
    expect(stacked.expandable).toBe(false);
    const tree = libraryRows(docs, folders, exp, true);
    expect(tree.find((r) => r.key === docKey("2"))).toMatchObject({ expandable: true, expanded: true });
    expect(tree.find((r) => r.key === docKey("1"))!.expandable).toBe(false);
    const folded = libraryRows(docs, folders, new Set([...exp, docFoldedKey("2")]), true);
    expect(folded.find((r) => r.key === docKey("2"))!.expanded).toBe(false);
  });
});

describe("expansion keys", () => {
  it("revealing a document opens every ancestor folder", () => {
    expect(revealKeys("A/B/C")).toEqual([folderKey("A/B/C"), folderKey("A/B"), folderKey("A")]);
    expect(revealKeys("")).toEqual([]);
  });

  it("a renamed folder keeps its own and its subfolders' open state, and no one else's", () => {
    const next = rekeyExpanded(new Set([folderKey("A"), folderKey("A/B"), folderKey("AB"), "d:x"]), "A", "Z");
    expect([...next].sort()).toEqual([folderKey("AB"), folderKey("Z"), folderKey("Z/B"), "d:x"].sort());
  });
});

describe("previewRows", () => {
  it("a one-page document has no page rows; a multi-page one folds its pages", () => {
    const rows = previewRows(PREVIEW_WORKSPACE, new Set(["p:Finance", "p:Finance/2026", "p:Finance/2026/Budget 2026"]));
    const budget = rows.find((r) => r.label === "Budget 2026")!;
    const forecast = rows.find((r) => r.label === "Forecast")!;
    expect(budget.expandable).toBe(true);
    expect(forecast.expandable).toBe(false);
    expect(rows.filter((r) => r.kind === "page" || r.kind === "pagefolder").map((r) => r.label)).toEqual(["Inputs", "Model", "Summary"]);
    expect(rows.every((r) => r.sample)).toBe(true);
  });
});

describe("tree keys", () => {
  const exp = new Set([folderKey("Finance")]);
  const rows = libraryRows(docs, folders, exp, false);
  const key = (label: string) => rows.find((r) => r.label === label)!.key;

  it("Right opens a folded folder, then steps into it; Left steps out, then folds", () => {
    const folded = libraryRows(docs, folders, new Set(), false);
    expect(treeKeyStep(folded, folderKey("Finance"), "right").toggle?.key).toBe(folderKey("Finance"));
    expect(treeKeyStep(rows, folderKey("Finance"), "right").focus).toBe(key("2026"));
    expect(treeKeyStep(rows, key("Budget 9"), "left").focus).toBe(folderKey("Finance"));
    expect(treeKeyStep(rows, folderKey("Finance"), "left").toggle?.key).toBe(folderKey("Finance"));
  });

  it("Up and Down walk the visible rows and stop at the ends", () => {
    expect(treeKeyStep(rows, rows[0].key, "up")).toEqual({});
    expect(treeKeyStep(rows, rows[0].key, "down").focus).toBe(rows[1].key);
    expect(treeKeyStep(rows, rows[0].key, "end").focus).toBe(rows[rows.length - 1].key);
  });

  it("typing jumps to the next row with that start, wrapping round", () => {
    expect(typeAhead(rows, key("Budget 9"), "b")).toBe(key("Budget 10"));
    expect(typeAhead(rows, key("Budget 10"), "b")).toBe(key("Budget 9"));
    expect(typeAhead(rows, rows[0].key, "zz")).toBeUndefined();
  });
});
