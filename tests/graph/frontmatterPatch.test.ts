import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { patchFrontmatter, cellToYaml, renderKey, writableKeys, planPropertyWrites, propertyPlanFrame, resolveKey, setBody, resolveBody } from "../../src/graph/frontmatterPatch";
import type { CubeValue } from "../../src/graph/frame";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";
import { isFrameValue } from "../../src/graph/frame";

// Bundle 24 item B — the pure frontmatter line-patcher: untouched bytes stay identical,
// and a cube round-trips through a note unchanged. onePatchPath: the ONE writer of a note's YAML.

const NO_NAMES = new Set<string>();

describe("cellToYaml", () => {
  it("dates format by the column type; whole days are YYYY-MM-DD", () => {
    expect(cellToYaml(parseDateToSerial("2026-11-15"), "date", NO_NAMES)).toBe("2026-11-15");
  });
  it("a fractional serial is a datetime", () => {
    const dt = parseDateToSerial("2026-11-15") + 0.5; // noon
    expect(cellToYaml(dt, "date", NO_NAMES)).toBe("2026-11-15T12:00:00");
  });
  it("logicals and numbers pass through; a note-name string becomes a link", () => {
    expect(cellToYaml(true, "logical", NO_NAMES)).toBe(true);
    expect(cellToYaml(18500, "number", NO_NAMES)).toBe(18500);
    expect(cellToYaml("People/Sam", "string", new Set(["People/Sam"]))).toBe("[[People/Sam]]");
    expect(cellToYaml("plain", "string", NO_NAMES)).toBe("plain");
  });
  it("a list cell → a scalar array; a nested frame → rows of objects", () => {
    expect(cellToYaml(["home", "renovation"], "string", NO_NAMES)).toEqual(["home", "renovation"]);
    const frame = { __frame: true as const, columns: [
      { name: "name", type: "string" as const, values: ["Demolition"] },
      { name: "done", type: "logical" as const, values: [true] },
    ] };
    expect(cellToYaml(frame, undefined, NO_NAMES)).toEqual([{ name: "Demolition", done: true }]);
  });
});

describe("renderKey", () => {
  it("scalar / empty list / list / rows", () => {
    expect(renderKey("a", 5)).toEqual(["a: 5"]);
    expect(renderKey("a", [])).toEqual(["a: []"]);
    expect(renderKey("t", ["x", "y"])).toEqual(["t:", "  - x", "  - y"]);
    expect(renderKey("m", [{ k: 1, v: "z" }])).toEqual(["m:", "  - {k: 1, v: z}"]);
  });
  it("quotes an ambiguous scalar", () => {
    expect(renderKey("a", "1:2")).toEqual(['a: "1:2"']);
  });
});

describe("patchFrontmatter — line level, untouched bytes identical", () => {
  const note = "---\nstatus: active\npriority: 5\ntags:\n  - home\n  - renovation\n---\n# Body\n\nUntouched.\n";

  it("replaces one scalar, leaves every other line byte-identical", () => {
    const { text, refused } = patchFrontmatter(note, { priority: 3 });
    expect(refused).toEqual([]);
    expect(text).toBe("---\nstatus: active\npriority: 3\ntags:\n  - home\n  - renovation\n---\n# Body\n\nUntouched.\n");
  });

  it("replaces a list's line + its block", () => {
    const { text } = patchFrontmatter(note, { tags: ["work"] });
    expect(text).toContain("tags:\n  - work\n---");
    expect(text).toContain("status: active"); // untouched
  });

  it("appends a missing key before the closing fence", () => {
    const { text } = patchFrontmatter(note, { lead: "Sam" });
    expect(text).toContain("  - renovation\nlead: Sam\n---");
  });

  it("a note with no frontmatter block gets one", () => {
    const { text } = patchFrontmatter("# Just a body\n", { status: "done" });
    expect(text).toBe("---\nstatus: done\n---\n# Just a body\n");
  });

  it("refuses a key whose current value is an unparsed nested block", () => {
    const nested = "---\nname: x\nmeta:\n  a: 1\n  b: 2\n---\nbody\n";
    const { text, refused } = patchFrontmatter(nested, { meta: "flat", name: "y" });
    expect(refused.map((r) => r.key)).toEqual(["meta"]);
    expect(text).toContain("name: y");      // the patchable key still applied
    expect(text).toContain("meta:\n  a: 1"); // the refused block untouched
  });
});

describe("round trip — a demo-vault note re-patched with its own values is unchanged", () => {
  const VAULT = path.resolve(__dirname, "../../demo-vault");
  it("Kitchen remodel: re-writing scalar/date keys with their own values is byte-identical", () => {
    const text = fs.readFileSync(path.join(VAULT, "Projects/Kitchen remodel.md"), "utf8");
    // Scalars + a date reproduce byte-for-byte (a date renders unquoted). The list `tags`
    // and the nested `milestones` are left out of the patch, so they stay verbatim — the
    // untouched-bytes guarantee, not a promise to reproduce a list's inline vs block style.
    const patch = {
      status: "active",
      priority: 5,
      due: cellToYaml(parseDateToSerial("2026-11-15"), "date", NO_NAMES),
    };
    const { text: out, refused } = patchFrontmatter(text, patch);
    expect(refused).toEqual([]);
    expect(out).toContain("tags: [home, renovation]"); // untouched inline list
    expect(out).toContain("milestones:\n  - {name: Demolition, due: 2026-09-20, done: true}"); // untouched nested block
    expect(out).toBe(text);
  });
});

describe("nested frame from a cube cell writes as a - {k: v} block", () => {
  it("milestones round-trips as rows-of-objects", () => {
    const frame = { __frame: true as const, columns: [
      { name: "name", type: "string" as const, values: ["Demo", "Cabinets"] },
      { name: "done", type: "logical" as const, values: [true, false] },
    ] };
    const val = cellToYaml(frame, undefined, NO_NAMES);
    expect(isFrameValue(frame)).toBe(true);
    const { text } = patchFrontmatter("---\nx: 1\n---\nb\n", { plan: val });
    expect(text).toContain("plan:\n  - {name: Demo, done: true}\n  - {name: Cabinets, done: false}");
  });
});

describe("the write plan", () => {
  const cube: CubeValue = { __cube: true, depth: 1, columns: [
    { name: "path", cells: ["Projects/Kitchen remodel.md", "Notes/Deep Work.md"], type: "string" },
    { name: "status", cells: ["active", null], type: "string" },
    { name: "priority", cells: [5, 4], type: "number" },
    { name: "due", cells: [parseDateToSerial("2026-11-15"), null], type: "date" },
    { name: "modified", cells: [0, 0], type: "date" }, // a read-only built-in
  ] };

  it("writableKeys excludes path and read-only built-ins; honors an explicit list", () => {
    expect(writableKeys(cube, "")).toEqual(["status", "priority", "due"]);
    expect(writableKeys(cube, "status, due")).toEqual(["status", "due"]);
    expect(writableKeys(cube, "status, nope")).toEqual(["status"]); // absent column dropped
  });

  it("planPropertyWrites is one row per (note × key), dates formatted", () => {
    const rows = planPropertyWrites(cube, "", NO_NAMES);
    expect(rows).toHaveLength(6); // 2 notes × 3 writable keys
    expect(rows[0]).toMatchObject({ path: "Projects/Kitchen remodel.md", key: "status", after: "active", action: "pending" });
    const due = rows.find((r) => r.path.includes("Kitchen") && r.key === "due")!;
    expect(due.value).toBe("2026-11-15");
  });

  it("propertyPlanFrame has the five plan columns", () => {
    const f = propertyPlanFrame(planPropertyWrites(cube, "status", NO_NAMES));
    expect(f.columns.map((c) => c.name)).toEqual(["path", "key", "before", "after", "action"]);
    expect(f.columns.find((c) => c.name === "action")!.values.every((v) => v === "pending")).toBe(true);
  });
})

describe("note-body (the reserved body property)", () => {
  const NOTE = "---\nstatus: active\n---\n\n# Old body\n\ntext";
  it("setBody replaces the body, keeping the frontmatter block byte-identical", () => {
    const out = setBody(NOTE, "# New body");
    expect(out.startsWith("---\nstatus: active\n---")).toBe(true);
    expect(out).toContain("# New body");
    expect(out).not.toContain("Old body");
  });
  it("setBody on a note with no frontmatter writes just the body", () => {
    expect(setBody("plain note", "# New")).toBe("# New");
  });
  it("resolveBody is unchanged when equal, update when different", () => {
    expect(resolveBody(NOTE, "# Old body\n\ntext").action).toBe("unchanged");
    expect(resolveBody(NOTE, "# New").action).toBe("update");
  });
  it("note-body is never a frontmatter key; it plans a body row instead", () => {
    const cube: CubeValue = { __cube: true, depth: 1, columns: [
      { name: "path", cells: ["Notes/A.md"], type: "string" },
      { name: "status", cells: ["done"], type: "string" },
      { name: "note-body", cells: ["# Fresh"], type: "string" },
    ] };
    expect(writableKeys(cube, "")).toEqual(["status"]); // note-body out of the frontmatter keys
    const rows = planPropertyWrites(cube, "", NO_NAMES);
    expect(rows.find((r) => r.key === "note-body")).toMatchObject({ path: "Notes/A.md", value: "# Fresh" });
    expect(rows.some((r) => r.key === "status")).toBe(true); // frontmatter still planned
  });
})

describe("resolveKey — what a write would do + the current value", () => {
  const note = "---\nstatus: active\npriority: 5\ntags:\n  - home\n---\nbody\n";
  it("unchanged when the rendered value already matches", () => {
    expect(resolveKey(note, "priority", 5)).toEqual({ action: "unchanged", before: "5" });
  });
  it("update when it differs, exposing the current value", () => {
    expect(resolveKey(note, "priority", 3)).toEqual({ action: "update", before: "5" });
  });
  it("add when the key is absent", () => {
    expect(resolveKey(note, "lead", "Sam")).toEqual({ action: "add", before: "" });
  });
  it("a list's current value is shown; a matching list is unchanged", () => {
    expect(resolveKey(note, "tags", ["home"])).toEqual({ action: "unchanged", before: "- home" });
  });
  it("refused for an unparsed nested block", () => {
    const nested = "---\nmeta:\n  a: 1\n---\nb\n";
    expect(resolveKey(nested, "meta", "x").action).toBe("refused");
  });
})

describe("setBody round trips", () => {
  const NOTE = "---\nstatus: active\n---\n\n# Old body\n\ntext";
  it("a body cell that already ends in a newline does not grow one per write", () => {
    const once = setBody(NOTE, "X\n");
    expect(once.endsWith("X\n")).toBe(true);
    expect(setBody(once, "X\n")).toBe(once);
  });
  it("a CRLF note stays CRLF and the body reads without a leading blank line", () => {
    const crlf = "---\r\ntitle: A\r\n---\r\n\r\nHello\r\n";
    expect(resolveBody(crlf, "Hello").action).toBe("unchanged");
    const out = setBody(crlf, "New");
    expect(out).toBe("---\r\ntitle: A\r\n---\r\n\r\nNew\r\n");
  });
});
