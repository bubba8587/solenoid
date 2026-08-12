import { describe, it, expect } from "vitest";
import { socketGlyphKind, COMBO_PAIRS } from "./hicSocketGlyph";

describe("socketGlyphKind", () => {
  it("scalars → circle", () => {
    for (const t of ["number", "string", "date", "complex", "logical", "lambda", "any"]) {
      expect(socketGlyphKind(t)).toBe("circle");
    }
  });
  it("lists → square", () => {
    for (const t of ["list", "strlist", "datelist", "complexlist", "logicallist"]) {
      expect(socketGlyphKind(t)).toBe("square");
    }
  });
  it("combos → split", () => {
    for (const t of ["numlist", "strcombo", "datecombo", "complexcombo", "logicalcombo"]) {
      expect(socketGlyphKind(t)).toBe("split");
    }
  });
  it("2-D matrices → grid; the FRAME has its own glyph (sheet-with-header, 2026-07-16)", () => {
    for (const t of ["table", "strtable", "datetable", "anytable", "logicaltable"]) {
      expect(socketGlyphKind(t)).toBe("grid");
    }
    expect(socketGlyphKind("frame")).toBe("frame");
  });
  it("cube → hex; trueany → ring; undefined → circle", () => {
    expect(socketGlyphKind("cube")).toBe("hex");
    expect(socketGlyphKind("trueany")).toBe("ring");
    expect(socketGlyphKind(undefined)).toBe("circle");
  });
  it("COMBO_PAIRS maps to [scalar, list]", () => {
    expect(COMBO_PAIRS.numlist).toEqual(["number", "list"]);
    expect(COMBO_PAIRS.logicalcombo).toEqual(["logical", "logicallist"]);
  });
});
