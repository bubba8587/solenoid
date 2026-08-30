import { describe, it, expect } from "vitest";
import { parseCsvLine, parseCsvRows } from "../../src/graph/csv";

describe("parseCsvLine", () => {
  it("splits a plain line on commas", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps an empty trailing field", () => {
    expect(parseCsvLine("a,,c,")).toEqual(["a", "", "c", ""]);
  });

  it("treats a comma inside a quoted field as literal (the headline bug)", () => {
    expect(parseCsvLine('"Smith, John",42')).toEqual(["Smith, John", "42"]);
  });

  it("handles a quoted thousands-grouped number", () => {
    expect(parseCsvLine('"1,000","2,500.50"')).toEqual(["1,000", "2,500.50"]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsvLine('"He said ""hi""",x')).toEqual(['He said "hi"', "x"]);
  });

  it("handles a mix of quoted and unquoted fields", () => {
    expect(parseCsvLine('name,"city, state",age')).toEqual(["name", "city, state", "age"]);
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

  it("keeps embedded commas per row", () => {
    expect(parseCsvRows('id,label\n1,"a, b"\n2,c')).toEqual([
      ["id", "label"],
      ["1", "a, b"],
      ["2", "c"],
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
