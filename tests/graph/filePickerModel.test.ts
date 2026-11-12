// [[B19]] spreadsheetHabits, [[engineering#Table work grows with the rows, never with rows squared, and drawing stops at the screen]], [[live-connections#The demo vault]]
import { describe, it, expect } from "vitest";
import { entriesAt, indexOf, search, treeOf, wholeLines, crumbsOf, ROW_CAP, relist, listed } from "../../src/graph/filePickerModel";

const vault = ["Daily/2026-01-02.md", "Daily/2026-01-10.md", "Notes/Atomic Habits.md", "Notes/Deep Work.md", "README.md", "Projects/Alpha/plan.md"];

describe("the folder tree", () => {
  it("lists a folder's folders first, then its files, numbers in order", () => {
    const t = treeOf(vault, "file");
    expect(entriesAt(t, "").map((e) => e.name)).toEqual(["Daily", "Notes", "Projects", "README.md"]);
    expect(entriesAt(t, "").find((e) => e.name === "Projects")).toMatchObject({ kind: "folder", count: 1 });
    expect(entriesAt(t, "Projects").map((e) => e.path)).toEqual(["Projects/Alpha"]);
    expect(crumbsOf("Projects/Alpha", "Vault")).toEqual([["", "Vault"], ["Projects", "Projects"], ["Projects/Alpha", "Alpha"]]);
  });
});

describe("search", () => {
  it("ranks a name match first and marks it; folder-only matches follow", () => {
    const { matches, total } = search(indexOf(vault), "work");
    expect(total).toBe(1);
    expect(matches[0]).toMatchObject({ path: "Notes/Deep Work.md", marks: [[5, 9]] });
    expect(search(indexOf(vault), "daily").matches.map((m) => m.path)).toEqual(["Daily/2026-01-02.md", "Daily/2026-01-10.md"]);
  });
  it("on 100,000 paths answers fast, at most the cap, and counts the rest", () => {
    const big = Array.from({ length: 100_000 }, (_, i) => `Area ${i % 40}/Topic ${i % 977}/note ${i}.md`);
    const t0 = performance.now();
    const index = indexOf(big);
    const tree = treeOf(big, "file");
    const { matches, total } = search(index, "note 1");
    const ms = performance.now() - t0;
    expect(matches.length).toBe(300);
    expect(total).toBeGreaterThan(300);
    expect(entriesAt(tree, "").length).toBe(40);
    expect(ROW_CAP).toBeLessThanOrEqual(300);
    expect(ms).toBeLessThan(1500);
  });
});

describe("a preview's head", () => {
  it("drops the part line of a cut head, and keeps a whole file whole", () => {
    expect(wholeLines("a,b\n1,2\n3,", true)).toBe("a,b\n1,2");
    expect(wholeLines("a,b\n1,2\n3,4", false)).toBe("a,b\n1,2\n3,4");
  });
});

describe("listings", () => {
  it("keep the last answer for the session", async () => {
    expect(listed("t|x")).toBeUndefined();
    await relist("t|x", async () => ["a.md"]);
    expect(listed("t|x")).toEqual(["a.md"]);
  });
});
