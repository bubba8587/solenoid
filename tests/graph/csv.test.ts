// [[C103]] untrustedContentSeams
import { describe, it, expect } from "vitest";
import { parseCsvLine, parseCsvRows, csvFieldSpans } from "../../src/graph/csv";

describe("csvFieldSpans", () => {
  const cut = (text: string) => csvFieldSpans(text).map((s) => [s.row, s.col, text.slice(s.start, s.end)]);

  it("locates every field by row and column, empty ones included", () => {
    expect(cut("a,b\n1,,3")).toEqual([[0, 0, "a"], [0, 1, "b"], [1, 0, "1"], [1, 1, ""], [1, 2, "3"]]);
  });

  it("keeps a quoted field whole across commas, newlines and doubled quotes", () => {
    expect(cut('x,"a,\n""b""",z')).toEqual([[0, 0, "x"], [0, 1, '"a,\n""b"""'], [0, 2, "z"]]);
  });

  it("a final newline ends the last row; a typed blank line is a row", () => {
    expect(cut("a,b\r\n")).toEqual([[0, 0, "a"], [0, 1, "b"]]);
    expect(cut("a\n\nb")).toEqual([[0, 0, "a"], [1, 0, ""], [2, 0, "b"]]);
  });

  it("agrees with the parser on the shape of what it marks", () => {
    const text = 'name,n\n"Smith, J",2\nLee,';
    const rows = parseCsvRows(text, { keepBlankLines: true });
    const spans = csvFieldSpans(text);
    expect(spans.length).toBe(rows.reduce((m, r) => m + r.length, 0));
    expect(Math.max(...spans.map((s) => s.row)) + 1).toBe(rows.length);
  });
});

describe("parseCsvLine", () => {
  it("keeps an empty trailing field", () => {
    expect(parseCsvLine("a,,c,")).toEqual(["a", "", "c", ""]);
  });

  it("treats a comma inside a quoted field as literal (the headline bug)", () => {
    expect(parseCsvLine('"Smith, John",42')).toEqual(["Smith, John", "42"]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsvLine('"He said ""hi""",x')).toEqual(['He said "hi"', "x"]);
  });

  it("leaves unquoted whitespace for the caller to trim", () => {
    expect(parseCsvLine(" a , b ")).toEqual([" a ", " b "]);
  });

  it("returns a single field for a line with no commas", () => {
    expect(parseCsvLine("solo")).toEqual(["solo"]);
  });

  it("returns one empty field for an empty line", () => {
    expect(parseCsvLine("")).toEqual([""]);
  });
});

describe("parseCsvRows", () => {
  it("parses multiple rows, dropping blank lines and CRLF", () => {
    expect(parseCsvRows("a,b\r\n1,2\r\n\r\n3,4\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseCsvRows("   \n  \n")).toEqual([]);
  });

  // Capabilities the bare split(",") couldn't do — the reason for the library.
  it("keeps a newline embedded in a quoted field as one row", () => {
    expect(parseCsvRows('a,"line one\nline two",c')).toEqual([
      ["a", "line one\nline two", "c"],
    ]);
  });

  it("strips a leading BOM from the first field", () => {
    expect(parseCsvRows("﻿id,name\n1,x")).toEqual([
      ["id", "name"],
      ["1", "x"],
    ]);
  });

  it("assumes comma by default, even when semicolons are present", () => {
    expect(parseCsvRows("a;b;c")).toEqual([["a;b;c"]]);
  });

  it("auto-detects a semicolon delimiter when asked (file ingestion)", () => {
    expect(parseCsvRows("a;b;c\n1;2;3", { detectDelimiter: true })).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("auto-detects a tab delimiter when asked", () => {
    expect(parseCsvRows("a\tb\n1\t2", { detectDelimiter: true })).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
