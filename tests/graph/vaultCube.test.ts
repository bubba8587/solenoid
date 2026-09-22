// [[C67]], [[C24]] arraySemantics, [[C44]] dateSerials
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { notesToCube, dateFromName, type VaultNote, type VaultTypeSources } from "../../src/graph/vaultCube";
import { parseMdbaseCollection, mdbaseTypeFor, mdbaseSchemaFor, validateAgainst } from "../../src/graph/mdbaseTypes";
import { parseObsidianTypes } from "../../src/graph/obsidianTypes";
import { parseDailyNotesConfig } from "../../src/graph/dailyNotesConfig";
import { isCubeValue, type CubeValue, type CubeColumn } from "../../src/graph/frame";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";

// Bundle 24 item A — the Vault Folder reader's pure cores, over the checked-in demo vault
// (the single-source fixture set). Reads files with node:fs; the node supplies these on desktop.

const VAULT = path.resolve(__dirname, "../../demo-vault");
const read = (rel: string) => fs.readFileSync(path.join(VAULT, rel), "utf8");
const mdFilesFlat = (rel: string) =>
  fs.readdirSync(path.join(VAULT, rel)).filter((f) => f.endsWith(".md")).sort();

const col = (cube: CubeValue, name: string): CubeColumn =>
  cube.columns.find((c) => c.name === name)!;
const cellAt = (cube: CubeValue, name: string, row: number) => col(cube, name).cells[row];
const rowOf = (cube: CubeValue, nameValue: string) =>
  col(cube, "name").cells.findIndex((c) => c === nameValue);

const NO_TYPES: VaultTypeSources = { mdbaseFor: () => ({}), obsidian: {} };

describe("a matrix property", () => {
  const notes: VaultNote[] = [{ path: "a.md", text: "---\ngrid:\n  - - 1\n    - 2\n  - - 3\n    - 4\n---\n" } as VaultNote];

  it("sits in a cube cell as its rows, and is never mistaken for a frame's records", () => {
    const cube = notesToCube(notes, NO_TYPES);
    expect(cellAt(cube, "grid", 0)).toEqual([[1, 2], [3, 4]]);
    expect(col(cube, "grid").type).toBe("number");
  });

  it("follows a types.json matrix hint", () => {
    const obsidian = parseObsidianTypes(JSON.stringify({ types: { grid: "solenoid-strtable" } }));
    expect(obsidian.grid).toEqual({ kind: "matrix", elem: "string" });
    expect(cellAt(notesToCube(notes, { ...NO_TYPES, obsidian }), "grid", 0)).toEqual([["1", "2"], ["3", "4"]]);
  });
});

describe("dateFromName (R3)", () => {
  it("parses the daily-notes format", () => {
    expect(dateFromName("2026-09-01", "YYYY-MM-DD")).toBe(parseDateToSerial("2026-09-01"));
  });
  it("null when the name doesn't match", () => {
    expect(dateFromName("Deep Work", "YYYY-MM-DD")).toBeNull();
  });
  it("honours a custom token layout", () => {
    expect(dateFromName("09-01-2026", "MM-DD-YYYY")).toBe(parseDateToSerial("2026-09-01"));
  });
  it("null when the name carries no day (a month is not a day)", () => {
    expect(dateFromName("2026-09", "YYYY-MM")).toBeNull();
  });
});

describe("Projects — mdbase typing (source #1)", () => {
  const collection = parseMdbaseCollection(read("Projects/mdbase.yaml"), [read("Projects/_types/project.md")]);
  const notes: VaultNote[] = mdFilesFlat("Projects").map((f) => ({ path: f, text: read(`Projects/${f}`) }));
  const sources: VaultTypeSources = { mdbaseFor: (p) => mdbaseTypeFor(collection, p), obsidian: {} };
  const cube = notesToCube(notes, sources);

  it("has the built-in columns then the frontmatter union", () => {
    const names = cube.columns.map((c) => c.name);
    for (const b of ["path", "name", "folder", "ext", "size", "created", "modified", "tags", "links", "embeds", "date"]) {
      expect(names).toContain(b);
    }
    expect(names).toContain("status");
    expect(names).toContain("milestones");
  });

  it("types scalars from the schema", () => {
    const r = rowOf(cube, "Kitchen remodel");
    expect(cellAt(cube, "status", r)).toBe("active");         // enum → string
    expect(cellAt(cube, "priority", r)).toBe(5);              // integer → number
    expect(cellAt(cube, "budget", r)).toBe(18500);            // number
    expect(cellAt(cube, "due", r)).toBe(Math.round(parseDateToSerial("2026-11-15"))); // format:date → serial
    expect(col(cube, "priority").type).toBe("number");
    expect(col(cube, "due").type).toBe("date");
  });

  it("a list key is a list cell, a rows-of-objects key is a nested cube", () => {
    const r = rowOf(cube, "Kitchen remodel");
    expect(cellAt(cube, "tags", r)).toEqual(["home", "renovation"]);
    const ms = cellAt(cube, "milestones", r);
    expect(isCubeValue(ms)).toBe(true);
    if (isCubeValue(ms)) {
      expect(ms.columns.map((c) => c.name)).toEqual(["name", "due", "done"]);
      expect(ms.columns.find((c) => c.name === "name")!.cells).toEqual(["Demolition", "Cabinets in", "Countertops"]);
    }
  });

  it("the tags built-in merges frontmatter tags with inline #tags, deduped", () => {
    const r = rowOf(cube, "Kitchen remodel");
    // frontmatter [home, renovation] + body #home #renovation → deduped, order kept
    expect(cellAt(cube, "tags", r)).toEqual(["home", "renovation"]);
  });

  it("links built-in collects wikilinks from body + frontmatter", () => {
    const r = rowOf(cube, "Garden overhaul");
    const links = cellAt(cube, "links", r) as string[];
    expect(links).toContain("Projects/Kitchen remodel");
    expect(links).toContain("People/Sam");
  });
});

describe("a frame property's picked column types (the Solenoid Properties plugin's data)", () => {
  const notes: VaultNote[] = [{ path: "a.md", text: "---\nbudget:\n  - item: \"0012\"\n    cost: 12\n    ordered: 2026-09-01\n    paid: true\n  - item: Tile\n    cost: later\n    ordered: later\n    paid: false\n---\n" } as VaultNote];
  const nested = (cube: CubeValue) => { const c = cellAt(cube, "budget", 0); if (!isCubeValue(c)) throw new Error("not a cube"); return c; };
  const column = (cube: CubeValue, name: string) => nested(cube).columns.find((c) => c.name === name)!;

  it("without picks, a column mixing a date with text is text, the date as written", () => {
    const cube = notesToCube(notes, NO_TYPES);
    expect(column(cube, "ordered").type).toBe("string");
    expect(column(cube, "ordered").cells).toEqual(["2026-09-01", "later"]);
    expect(column(cube, "cost").type).toBe("string");
  });

  it("a pick types the column, and what the type cannot read is missing", () => {
    const cube = notesToCube(notes, { ...NO_TYPES, columns: { budget: { item: "string", cost: "number", ordered: "date", paid: "logical" } } });
    expect(column(cube, "item").type).toBe("string");
    expect(column(cube, "item").cells).toEqual(["0012", "Tile"]);
    expect(column(cube, "cost").type).toBe("number");
    expect(column(cube, "cost").cells).toEqual([12, null]);
    expect(column(cube, "ordered").type).toBe("date");
    expect(column(cube, "ordered").cells).toEqual([Math.round(parseDateToSerial("2026-09-01")), null]);
    expect(column(cube, "paid").type).toBe("logical");
    expect(column(cube, "paid").cells).toEqual([true, false]);
  });

  it("a Text pick over an all-date column keeps the dates as written", () => {
    const dated: VaultNote[] = [{ path: "b.md", text: "---\nbudget:\n  - ordered: 2026-09-01\n  - ordered: 2026-09-12\n---\n" } as VaultNote];
    expect(column(notesToCube(dated, NO_TYPES), "ordered").type).toBe("date");
    const picked = notesToCube(dated, { ...NO_TYPES, columns: { budget: { ordered: "string" } } });
    expect(column(picked, "ordered").type).toBe("string");
    expect(column(picked, "ordered").cells).toEqual(["2026-09-01", "2026-09-12"]);
  });
});

describe("Notes — .obsidian/types.json typing (source #2) + guesser", () => {
  const obsidian = parseObsidianTypes(read(".obsidian/types.json"));
  const notes: VaultNote[] = mdFilesFlat("Notes").map((f) => ({ path: `Notes/${f}`, text: read(`Notes/${f}`) }));
  const sources: VaultTypeSources = { mdbaseFor: () => ({}), obsidian };
  const cube = notesToCube(notes, sources);

  it("types the book note from types.json", () => {
    const r = rowOf(cube, "Deep Work");
    expect(cellAt(cube, "rating", r)).toBe(4);        // number
    expect(cellAt(cube, "read", r)).toBe(true);       // checkbox → logical
    expect(col(cube, "read").type).toBe("logical");
    expect(cellAt(cube, "started", r)).toBe(Math.round(parseDateToSerial("2026-07-02"))); // date
    expect(cellAt(cube, "author", r)).toBe("Cal Newport");
  });

  it("a rows-of-objects key with a list field is a nested cube whose field is a list cell", () => {
    const r = rowOf(cube, "Spanish course");
    const sessions = cellAt(cube, "sessions", r);
    expect(isCubeValue(sessions)).toBe(true);
    if (isCubeValue(sessions)) {
      expect(sessions.columns.map((c) => c.name)).toEqual(["topic", "minutes", "tags"]);
      expect(sessions.columns.find((c) => c.name === "tags")!.cells[0]).toEqual(["basics", "speaking"]);
      expect(sessions.columns.find((c) => c.name === "minutes")!.cells).toEqual([30, 45]);
    }
  });
});

describe("Daily — R3 date column + the daily-notes config", () => {
  const cfg = parseDailyNotesConfig(read(".obsidian/daily-notes.json"));
  const notes: VaultNote[] = mdFilesFlat("Daily").map((f) => ({ path: `Daily/${f}`, text: read(`Daily/${f}`) }));
  const cube = notesToCube(notes, { mdbaseFor: () => ({}), obsidian: {} }, { nameFormat: cfg.format });

  it("reads the daily-notes format", () => {
    expect(cfg.folder).toBe("Daily");
    expect(cfg.format).toBe("YYYY-MM-DD");
  });
  it("parses the file name into the date column", () => {
    const r = rowOf(cube, "2026-09-03");
    expect(cellAt(cube, "date", r)).toBe(parseDateToSerial("2026-09-03"));
    expect(cellAt(cube, "sleep", r)).toBe(8.0);   // guessed number
  });
});

describe("guesser only (no type sources)", () => {
  const notes: VaultNote[] = [{ path: "a.md", text: "---\nn: 3\ns: hi\nb: true\n---\nbody" }];
  const cube = notesToCube(notes, NO_TYPES);
  it("guesses number / string / logical per column", () => {
    expect(cellAt(cube, "n", 0)).toBe(3);
    expect(cellAt(cube, "s", 0)).toBe("hi");
    expect(cellAt(cube, "b", 0)).toBe(true);
    expect(col(cube, "b").type).toBe("logical");
  });
  it("widens a column mixed across rows to string", () => {
    const c = notesToCube([
      { path: "1.md", text: "---\nx: 3\n---" },
      { path: "2.md", text: "---\nx: hi\n---" },
    ], NO_TYPES);
    expect(col(c, "x").type).toBe("string");
    expect(c.columns.find((k) => k.name === "x")!.cells).toEqual(["3", "hi"]);
  });
});

describe("cube brand", () => {
  it("emits a __cube value", () => {
    const cube = notesToCube([{ path: "a.md", text: "---\nx: 1\n---" }], NO_TYPES);
    expect(cube.__cube).toBe(true);
  });
});

describe("mdbase validation (Write Properties, item B)", () => {
  const collection = parseMdbaseCollection(read("Projects/mdbase.yaml"), [read("Projects/_types/project.md")]);
  const sch = mdbaseSchemaFor(collection, "Kitchen remodel.md")!;

  it("extracts enum + min/max from the schema", () => {
    expect(sch).not.toBeNull();
    expect(sch.constraints.status.enum).toEqual(["planning", "active", "blocked", "done"]);
    expect(sch.constraints.priority).toMatchObject({ kind: "number", min: 1, max: 5 });
    expect(sch.required).toContain("status");
  });

  it("validateAgainst refuses out-of-enum and out-of-range, passes valid", () => {
    expect(validateAgainst("nope", sch.constraints.status)).toMatch(/must be one of/);
    expect(validateAgainst("active", sch.constraints.status)).toBeNull();
    expect(validateAgainst(9, sch.constraints.priority)).toMatch(/at most 5/);
    expect(validateAgainst(0, sch.constraints.priority)).toMatch(/at least 1/);
    expect(validateAgainst(3, sch.constraints.priority)).toBeNull();
    expect(validateAgainst("x", sch.constraints.priority)).toMatch(/must be a number/);
  });
})

describe("review pins: path_glob `?`", () => {
  it("matches exactly one path character, never a regex quantifier", () => {
    const collection = parseMdbaseCollection(read("Projects/mdbase.yaml"), [read("Projects/_types/project.md")]);
    const t = { ...collection.types[0], pathGlob: "task-?.md" };
    const one = { ...collection, types: [t] };
    expect(mdbaseSchemaFor(one, "task-1.md")).not.toBeNull();
    expect(mdbaseSchemaFor(one, "task.md")).toBeNull();
    expect(mdbaseSchemaFor(one, "task-12.md")).toBeNull();
  });
});
