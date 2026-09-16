import { describe, it, expect } from "vitest";
import { sanitizeDocName, stubRelPath, stubLink, buildStub, mergeStub } from "../../src/graph/graphStub";

// Bundle 24 item D — the graph stub note + the solenoid: wikilink, both pure.

describe("names + links", () => {
  it("sanitizes a doc name to one safe segment", () => {
    expect(sanitizeDocName("Q3 / Plan: v2")).toBe("Q3 - Plan- v2");
    expect(sanitizeDocName("")).toBe("Untitled");
  });
  it("stub path + link", () => {
    expect(stubRelPath("My Graph")).toBe("Solenoid/My Graph.md");
    expect(stubLink("My Graph", "Write to Obsidian")).toBe("[[Solenoid/My Graph]] › Write to Obsidian");
  });
});

describe("buildStub", () => {
  it("frontmatter type/nodes/writes/updated + a body per writer + the run-graph line", () => {
    const s = buildStub("My Graph", [{ node: "Writer A", target: "Notes/Foo.md" }], "2026-09-07T10:00:00");
    expect(s).toContain("type: solenoid");
    expect(s).toContain("nodes: [Writer A]");
    expect(s).toContain("  - {node: Writer A, target: Notes/Foo.md}");
    expect(s).toContain("updated: 2026-09-07T10:00:00");
    expect(s).toContain("- **Writer A** → `Notes/Foo.md`");
    expect(s).toContain('Run headless: `run-graph "My Graph" --run "Writer A"`');
  });
});

describe("mergeStub", () => {
  it("creates the stub from nothing", () => {
    const s = mergeStub(null, "My Graph", "Writer A", "Notes/Foo.md", "2026-09-07T10:00:00");
    expect(s).toContain("nodes: [Writer A]");
  });
  it("a later write from the same node updates its target, not a duplicate row", () => {
    const first = mergeStub(null, "My Graph", "Writer A", "Notes/Foo.md", "t1");
    const second = mergeStub(first, "My Graph", "Writer A", "Notes/Bar.md", "t2");
    expect(second).toContain("  - {node: Writer A, target: Notes/Bar.md}");
    expect(second).not.toContain("Notes/Foo.md");
    expect(second.match(/- \{node: Writer A/g)).toHaveLength(1);
    expect(second).toContain("updated: t2");
  });
  it("a new writer is appended", () => {
    const first = mergeStub(null, "My Graph", "Writer A", "Notes/Foo.md", "t1");
    const second = mergeStub(first, "My Graph", "Writer B", "Notes/Bar.md", "t2");
    expect(second).toContain("nodes: [Writer A, Writer B]");
    expect(second).toContain("Writer A, target: Notes/Foo.md");
    expect(second).toContain("Writer B, target: Notes/Bar.md");
  });
});
