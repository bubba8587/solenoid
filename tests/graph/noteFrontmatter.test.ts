// [[B1]] obsidianBet, [[C44]], [[B11]]
import { describe, it, expect } from "vitest";
import { parseNoteFrontmatter } from "../../src/graph/noteFrontmatter";
import { parseDateToSerial } from "../../src/graph/nodes/date";

describe("parseNoteFrontmatter", () => {
  it("returns no block when the body does not open with a fence", () => {
    const r = parseNoteFrontmatter("just a note\nmore text");
    expect(r.hasBlock).toBe(false);
    expect(r.fields).toEqual([]);
    expect(r.body).toBe("just a note\nmore text");
  });

  it("returns no block for an unterminated fence", () => {
    const r = parseNoteFrontmatter("---\ntitle: x\nbody continues");
    expect(r.hasBlock).toBe(false);
    expect(r.body).toBe("---\ntitle: x\nbody continues");
  });

  it("guesses scalar types and strips the block from the body", () => {
    const r = parseNoteFrontmatter(
      ["---", "title: Budget", "count: 42", "ratio: 3.14", "active: true", "off: false", "---", "# Heading", "text"].join("\n"),
    );
    expect(r.hasBlock).toBe(true);
    expect(r.body).toBe("# Heading\ntext");
    expect(r.fields).toEqual([
      { key: "title", value: "Budget", guessed: "string" },
      { key: "count", value: 42, guessed: "number" },
      { key: "ratio", value: 3.14, guessed: "number" },
      { key: "active", value: true, guessed: "logical" },
      { key: "off", value: false, guessed: "logical" },
    ]);
  });

  it("types an ISO date as a date serial", () => {
    const r = parseNoteFrontmatter("---\ndue: 2026-03-01\n---\n");
    expect(r.fields[0].guessed).toBe("date");
    expect(r.fields[0].value).toBe(Math.round(parseDateToSerial("2026-03-01")));
  });

  it("types a list of ISO dates as a date list, never a numeric one", () => {
    const r = parseNoteFrontmatter("---\nmilestones:\n  - 2026-09-01\n  - \n  - 2026-10-15\nmixed: [2026-09-01, 7]\nquoted: [\"2026-09-01\"]\n---\n");
    const serial = (s: string) => Math.round(parseDateToSerial(s));
    expect(r.fields[0]).toEqual({ key: "milestones", value: [serial("2026-09-01"), null, serial("2026-10-15")], guessed: "datelist" });
    // A date beside a plain number is numbers; a quoted date is text.
    expect(r.fields[1].guessed).toBe("list");
    expect(r.fields[2].guessed).toBe("strlist");
  });

  it("treats quoted numbers/dates/bools as strings", () => {
    const r = parseNoteFrontmatter(`---\nid: "42"\nlabel: 'true'\nwhen: "2026-01-01"\n---`);
    expect(r.fields.map((f) => [f.guessed, f.value])).toEqual([
      ["string", "42"],
      ["string", "true"],
      ["string", "2026-01-01"],
    ]);
  });

  it("parses inline flow arrays and types from the first element", () => {
    const r = parseNoteFrontmatter('---\ntags: [a, b, c]\nnums: [1, 2, 3]\nflags: [true, false]\n---');
    expect(r.fields).toEqual([
      { key: "tags", value: ["a", "b", "c"], guessed: "strlist" },
      { key: "nums", value: [1, 2, 3], guessed: "list" },
      { key: "flags", value: [true, false], guessed: "logicallist" },
    ]);
  });

  it("parses block lists under a bare key", () => {
    const r = parseNoteFrontmatter(["---", "scores:", "  - 10", "  - 20", "  - 30", "after: x", "---"].join("\n"));
    expect(r.fields).toEqual([
      { key: "scores", value: [10, 20, 30], guessed: "list" },
      { key: "after", value: "x", guessed: "string" },
    ]);
  });

  it("parses a block list of inline objects into a frame field", () => {
    const r = parseNoteFrontmatter(["---", "screen:", "  - {Laptop: ProBook, Screen: 8}", "  - {Laptop: UltraSlim, Screen: 9}", "---"].join("\n"));
    expect(r.fields).toEqual([
      { key: "screen", guessed: "frame", value: [
        { Laptop: "ProBook", Screen: 8 },
        { Laptop: "UltraSlim", Screen: 9 },
      ] },
    ]);
  });

  it("reads Obsidian's block spelling of rows: the same frame, and a cube when a row holds a list", () => {
    // What Obsidian's Properties editor writes back for the inline rows above.
    const r = parseNoteFrontmatter([
      "---", "screen:", "  - Laptop: ProBook", "    Screen: 8", "  - Laptop: UltraSlim", "    Screen: 9",
      "sessions:", "  - topic: Greetings", "    minutes: 30", "    tags:", "      - basics", "      - speaking",
      "  - topic: Past tense", "    minutes: 45", "    tags:", "      - grammar",
      "next: 2026-10-01", "---",
    ].join("\n"));
    expect(r.fields).toEqual([
      { key: "screen", guessed: "frame", value: [{ Laptop: "ProBook", Screen: 8 }, { Laptop: "UltraSlim", Screen: 9 }] },
      { key: "sessions", guessed: "cube", value: [
        { topic: "Greetings", minutes: 30, tags: ["basics", "speaking"] },
        { topic: "Past tense", minutes: 45, tags: ["grammar"] },
      ] },
      { key: "next", guessed: "date", value: Math.round(parseDateToSerial("2026-10-01")) },
    ]);
  });

  it("a bare Knap tag (YAML reads it as a flow map) is flagged; a quoted one is a string", () => {
    const r = parseNoteFrontmatter('---\ntotal: {{ price * qty }}\nwhen: {% if x %}y{% endif %}\nok: "{{ price * qty }}"\n---');
    expect(r.fields).toEqual([
      { key: "total", value: null, guessed: "string", knapUnquoted: true },
      { key: "when", value: null, guessed: "string", knapUnquoted: true },
      { key: "ok", value: "{{ price * qty }}", guessed: "string" },
    ]);
  });

  it("a nested map that is not a row list surfaces as a blank string key", () => {
    const r = parseNoteFrontmatter("---\nmeta:\n  a: 1\n  b: 2\nafter: x\n---");
    expect(r.fields).toEqual([
      { key: "meta", value: null, guessed: "string" },
      { key: "after", value: "x", guessed: "string" },
    ]);
  });

  it("a block scalar and a quoted string with a colon read as plain text", () => {
    const r = parseNoteFrontmatter('---\nnote: |\n  two\n  lines\ntime: "10:30"\n---');
    expect(r.fields).toEqual([
      { key: "note", value: "two\nlines\n", guessed: "string" },
      { key: "time", value: "10:30", guessed: "string" },
    ]);
  });

  it("parses a flow array of inline objects into a frame field (commas inside braces held)", () => {
    const r = parseNoteFrontmatter('---\nrows: [{a: 1, b: x}, {a: 2, b: y}]\n---');
    expect(r.fields[0]).toEqual({ key: "rows", guessed: "frame", value: [
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ] });
  });

  it("a mix of objects and scalars is NOT a frame — falls back to a list", () => {
    const r = parseNoteFrontmatter('---\nmix: [{a: 1}, 2]\n---');
    expect(r.fields[0].guessed).not.toBe("frame");
  });

  it("honors quotes when splitting flow arrays", () => {
    const r = parseNoteFrontmatter('---\nitems: ["a, b", c]\n---');
    expect(r.fields[0].value).toEqual(["a, b", "c"]);
  });

  it("empty array / all-null defaults to a numeric list, and bare empty value is null string", () => {
    const r = parseNoteFrontmatter("---\nempty: []\nblank:\n---");
    expect(r.fields).toEqual([
      { key: "empty", value: [], guessed: "list" },
      { key: "blank", value: null, guessed: "string" },
    ]);
  });

  it("reads a list of lists as a matrix, typed like a list from all its cells", () => {
    const f = (yaml: string) => parseNoteFrontmatter(`---\n${yaml}\n---\n`).fields[0];
    expect(f("grid:\n  - - 1\n    - 2\n  - - 3\n    - 4")).toMatchObject({ value: [[1, 2], [3, 4]], guessed: "table" });
    expect(f("grid: [[a, b], [c, d]]")).toMatchObject({ value: [["a", "b"], ["c", "d"]], guessed: "strtable" });
    expect(f("grid: [[true, false]]").guessed).toBe("logicaltable");
    expect(f("grid: [[2026-09-01, 2026-09-02]]").guessed).toBe("datetable");
    // A short row pads with missing cells; a mixed list of rows and scalars is still a list.
    expect(f("grid: [[1, 2, 3], [4]]").value).toEqual([[1, 2, 3], [4, null, null]]);
    expect(f("grid: [[1, 2], 3]").guessed).toBe("strlist");
  });

  it("reads complex text as complex, a quoted one as text", () => {
    const f = (yaml: string) => parseNoteFrontmatter(`---\n${yaml}\n---\n`).fields[0];
    expect(f("z: 3+4i")).toMatchObject({ value: "3+4i", guessed: "complex" });
    expect(f('z: "3+4i"').guessed).toBe("string");
    expect(f("z: [3+4i, 1-2i, 5]").guessed).toBe("complexlist");
    expect(f("z: [[3+4i, 2i]]").guessed).toBe("complextable");
    // A bare number is a number, and a word ending in i is a word.
    expect(f("z: 5").guessed).toBe("number");
    expect(f("z: [hi, 2i]").guessed).toBe("strlist");
  });

  it("names a frame's date columns, and a row keeps a date as the text written", () => {
    const r = parseNoteFrontmatter("---\nbudget:\n  - item: Cabinets\n    ordered: 2026-09-02\n    note: 2026-09-02\n  - item: Tile\n    ordered: 2026-09-12\n    note: later\n---\n");
    expect(r.fields[0]).toMatchObject({ guessed: "frame", dateColumns: ["ordered"] });
    // The column's type decides what the text becomes; a mixed column keeps its date as text.
    expect(r.fields[0].value).toEqual([{ item: "Cabinets", ordered: "2026-09-02", note: "2026-09-02" }, { item: "Tile", ordered: "2026-09-12", note: "later" }]);
  });

  it("keeps the first occurrence of a duplicated key", () => {
    const r = parseNoteFrontmatter("---\nx: 1\nx: 2\n---");
    expect(r.fields).toEqual([{ key: "x", value: 1, guessed: "number" }]);
  });

  it("drops leading blank lines from the body", () => {
    const r = parseNoteFrontmatter("---\nx: 1\n---\n\n\nbody");
    expect(r.body).toBe("body");
  });
});
