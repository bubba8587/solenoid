import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { patchFrontmatter, cellToYaml, renderKey, writableKeys, planPropertyWrites, propertyPlanFrame, resolveKey, setBody, resolveBody, frontmatterTags } from "../../src/graph/frontmatterPatch";
import { notesToCube } from "../../src/graph/vaultCube";
import type { CubeValue } from "../../src/graph/frame";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";

// Bundle 24 item B — the pure frontmatter line-patcher: untouched bytes stay identical,
// and a cube round-trips through a note unchanged. [[C101]] onePatchPath: the ONE writer of a note's YAML.

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
    expect(renderKey("m", [{ k: 1, v: "z" }])).toEqual(["m:", "  - k: 1", "    v: z"]);
    expect(renderKey("m", [{ k: 1, after: ["a", "b"], none: [] }])).toEqual(["m:", "  - k: 1", "    after:", "      - a", "      - b", "    none: []"]);
  });
  it("quotes an ambiguous scalar", () => {
    expect(renderKey("a", "1:2")).toEqual(['a: "1:2"']);
  });
});

describe("patchFrontmatter — line level, untouched bytes identical", () => {
  const note = "---\nstatus: active\npriority: 5\ntags:\n  - home\n  - renovation\n---\n# Body\n\nUntouched.\n";

  it("replaces one scalar, leaves every other line byte-identical", () => {
    const { text } = patchFrontmatter(note, { priority: 3 });
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

  it("replaces a nested block's whole span (Obsidian's own row spelling included)", () => {
    const nested = "---\nname: x\nmeta:\n  a: 1\n  b: 2\nrows:\n  - k: 1\n    v: z\nlast: q\n---\nbody\n";
    const { text } = patchFrontmatter(nested, { meta: "flat", rows: [{ k: 2, v: "w" }] });
    expect(text).toBe("---\nname: x\nmeta: flat\nrows:\n  - k: 2\n    v: w\nlast: q\n---\nbody\n");
  });
});

describe("round trip — a demo-vault note re-patched with its own values is unchanged", () => {
  const VAULT = path.resolve(__dirname, "../../demo-vault");
  it("Kitchen remodel: re-writing scalar/date keys with their own values is byte-identical", () => {
    const text = fs.readFileSync(path.join(VAULT, "Projects/Kitchen remodel.md"), "utf8");
    // Scalars, a date (unquoted), a list and the nested `milestones` rows all reproduce
    // byte-for-byte: the vault is spelled the way the writer spells.
    const milestones = { __frame: true as const, columns: [
      { name: "name", type: "string" as const, values: ["Demolition", "Cabinets in", "Countertops"] },
      { name: "due", type: "date" as const, values: [parseDateToSerial("2026-09-20"), parseDateToSerial("2026-10-18"), parseDateToSerial("2026-11-01")] },
      { name: "done", type: "logical" as const, values: [true, false, false] },
    ] };
    const patch = {
      status: "active",
      priority: 5,
      due: cellToYaml(parseDateToSerial("2026-11-15"), "date", NO_NAMES),
      tags: ["home", "renovation"],
      milestones: cellToYaml(milestones, undefined, NO_NAMES),
    };
    const { text: out } = patchFrontmatter(text, patch);
    expect(out).toBe(text);
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
  it("a nested block is an update, its lines shown as the current value", () => {
    const nested = "---\nmeta:\n  a: 1\n---\nb\n";
    expect(resolveKey(nested, "meta", "x")).toEqual({ action: "update", before: "a: 1" });
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

describe("review pins: a list inside a row", () => {
  it("renders as a nested block and reads back as a list, never a comma string", async () => {
    const steps: CubeValue = { __cube: true, columns: [
      { name: "name", cells: ["a", "b"], type: "string" },
      { name: "tags", cells: [["x", "y"], []] },
    ] } as unknown as CubeValue;
    const v = cellToYaml(steps, undefined, NO_NAMES);
    expect(renderKey("steps", v)).toEqual(["steps:", "  - name: a", "    tags:", "      - x", "      - y", "  - name: b", "    tags: []"]);
    const { parse } = await import("yaml");
    const back = parse(renderKey("steps", v).join("\n")) as { steps: { tags: unknown }[] };
    expect(back.steps.map((r) => r.tags)).toEqual([["x", "y"], []]);
  });
});

describe("writing Vault Folder's tags back", () => {
  it("leaves out a tag only the body holds, so a round trip copies no inline tag into the frontmatter", () => {
    const note = "---\ntags:\n  - home\n---\nSome #idea and #home here.\n";
    const cube = notesToCube([{ path: "a.md", text: note }], { mdbaseFor: () => ({}), obsidian: {} });
    const cell = cube.columns.find((c) => c.name === "tags")!.cells[0];
    expect(cell).toEqual(["home", "idea"]);
    const value = frontmatterTags(note, cellToYaml(cell, "string", NO_NAMES));
    expect(value).toEqual(["home"]);
    expect(resolveKey(note, "tags", value).action).toBe("unchanged");
    expect(frontmatterTags(note, ["home", "idea", "new"])).toEqual(["home", "new"]);
  });
});

describe("patchFrontmatter never swallows a line it does not own", () => {
  it("a CRLF note is patched in place and stays CRLF, never gains a duplicate key", () => {
    const crlf = "---\r\ntitle: a\r\nrating: 3\r\n---\r\nbody\r\n";
    expect(resolveKey(crlf, "rating", 3)).toEqual({ action: "unchanged", before: "3" });
    expect(patchFrontmatter(crlf, { rating: 4 }).text).toBe("---\r\ntitle: a\r\nrating: 4\r\n---\r\nbody\r\n");
  });
  it("quoted keys, non-ASCII keys and comments survive a patch of the key above them", () => {
    const note = "---\ntitle: a\n\"odd key\": b\n# a comment\nétat: c\nrating: 3\n---\n";
    expect(patchFrontmatter(note, { title: "z" }).text).toBe("---\ntitle: z\n\"odd key\": b\n# a comment\nétat: c\nrating: 3\n---\n");
    expect(patchFrontmatter(note, { "odd key": "q", "état": "d" }).text).toBe("---\ntitle: a\n\"odd key\": q\n# a comment\nétat: d\nrating: 3\n---\n");
  });
  it("a sequence written at column 0 is replaced whole", () => {
    const note = "---\ntags:\n- a\n- b\nrating: 3\n---\n";
    expect(patchFrontmatter(note, { tags: ["x"] }).text).toBe("---\ntags:\n  - x\nrating: 3\n---\n");
  });
  it("a blank line after a block stays", () => {
    const note = "---\ntags:\n  - a\n\nrating: 3\n---\n";
    expect(patchFrontmatter(note, { tags: ["x"] }).text).toBe("---\ntags:\n  - x\n\nrating: 3\n---\n");
  });
  it("a blank value is written as Obsidian writes it, and a key YAML would misread is quoted", () => {
    expect(renderKey("due", null)).toEqual(["due:"]);
    expect(resolveKey("---\ndue:\n---\n", "due", null).action).toBe("unchanged");
    expect(renderKey("a: b", 1)).toEqual(['"a: b": 1']);
    expect(resolveKey("---\n\"a: b\": 1\n---\n", "a: b", 1).action).toBe("unchanged");
  });
});
