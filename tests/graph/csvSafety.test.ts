// [[C103]] untrustedContentSeams
import { describe, it, expect } from "vitest";
import { isFormulaTrigger, csvField } from "../../src/graph/csvSafety";
import { frameToCsvText } from "../../src/graph/nodes/sink";

describe("the CSV formula guard", () => {
  it("leaves numbers alone, formatted ones included, and guards everything else a spreadsheet would evaluate", () => {
    expect(isFormulaTrigger("-5")).toBe(false);
    expect(isFormulaTrigger("-1,234.50")).toBe(false);
    expect(isFormulaTrigger("+1e5")).toBe(false);
    expect(isFormulaTrigger("-5 km")).toBe(true);
    expect(isFormulaTrigger("-2+3+cmd|' /C calc'!A0")).toBe(true);
    expect(isFormulaTrigger("=1")).toBe(true);
    expect(isFormulaTrigger("@SUM(A1)")).toBe(true);
  });

  it("csvField quotes per RFC 4180, a bare carriage return included", () => {
    expect(csvField("a,b", false)).toBe('"a,b"');
    expect(csvField("a\rb", false)).toBe('"a\rb"');
    expect(csvField('=HYPERLINK("x")', true)).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField("=1", false)).toBe("=1");
  });

  it("Write File guards a header as well as a text cell", () => {
    const f = { __frame: true as const, columns: [{ name: "=cmd", type: "string" as const, values: ["ok"] }] };
    expect(frameToCsvText(f as never).split(/\r?\n/)[0]).toBe("'=cmd");
  });
});
