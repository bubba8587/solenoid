import { describe, it, expect } from "vitest";
import { parseNoteFrontmatter } from "./noteFrontmatter";
import { parseDateToSerial } from "./nodes/date";

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

  it("keeps the first occurrence of a duplicated key", () => {
    const r = parseNoteFrontmatter("---\nx: 1\nx: 2\n---");
    expect(r.fields).toEqual([{ key: "x", value: 1, guessed: "number" }]);
  });

  it("drops leading blank lines from the body", () => {
    const r = parseNoteFrontmatter("---\nx: 1\n---\n\n\nbody");
    expect(r.body).toBe("body");
  });
});
