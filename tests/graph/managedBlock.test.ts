import { describe, it, expect } from "vitest";
import { spliceBlock, readBlock, beginMarker, END_MARKER } from "../../src/graph/managedBlock";

// Bundle item C, `mode: block`: the writer owns the span between its markers.

const B = beginMarker("Weekly");

describe("spliceBlock", () => {
  it("no markers → the pair is appended after one blank line, untouched body identical", () => {
    const r = spliceBlock("# Notes\n\nsome prose\n", "Weekly", "| a |\n| - |\n| 1 |");
    expect(r.refused).toBeUndefined();
    expect(r.text).toBe(`# Notes\n\nsome prose\n\n${B}\n| a |\n| - |\n| 1 |\n${END_MARKER}\n`);
    expect(spliceBlock("", "Weekly", "x").text).toBe(`${B}\nx\n${END_MARKER}\n`);
  });
  it("an existing pair → only its span is replaced; text around it is byte-identical", () => {
    const before = `intro\n${B}\nold\n${END_MARKER}\noutro\n`;
    const r = spliceBlock(before, "Weekly", "new\nlines");
    expect(r.text).toBe(`intro\n${B}\nnew\nlines\n${END_MARKER}\noutro\n`);
  });
  it("two pairs: each name owns its own block", () => {
    const B2 = beginMarker("Monthly");
    const before = `${B}\na\n${END_MARKER}\n\n${B2}\nb\n${END_MARKER}\n`;
    const r = spliceBlock(before, "Monthly", "B!");
    expect(r.text).toBe(`${B}\na\n${END_MARKER}\n\n${B2}\nB!\n${END_MARKER}\n`);
    expect(readBlock(r.text, "Weekly")).toBe("a");
    expect(readBlock(r.text, "Monthly")).toBe("B!");
  });
  it("markers inside a code fence are text: a fenced pair is not the block", () => {
    const fenced = "```\n" + B + "\nnot mine\n" + END_MARKER + "\n```\n";
    const r = spliceBlock(fenced, "Weekly", "real");
    expect(r.text).toBe(fenced + "\n" + `${B}\nreal\n${END_MARKER}\n`);
    expect(readBlock(fenced, "Weekly")).toBeNull();
  });
  it("a begin with no end → a fresh pair is appended; the orphan is left alone", () => {
    const before = `${B}\norphan\n`;
    const r = spliceBlock(before, "Weekly", "x");
    expect(r.text).toBe(`${B}\norphan\n\n${B}\nx\n${END_MARKER}\n`);
  });
  it("content carrying %% outside a fence is refused with the line; inside a fence it is fine", () => {
    const r = spliceBlock("body\n", "Weekly", "ok\n%% hidden %%");
    expect(r.refused).toMatch(/line 2/);
    expect(r.text).toBe("body\n");
    const ok = spliceBlock("body\n", "Weekly", "```\n%% in code %%\n```");
    expect(ok.refused).toBeUndefined();
  });
  it("CRLF input is normalized", () => {
    const r = spliceBlock("a\r\nb\r\n", "Weekly", "x");
    expect(r.text).toBe(`a\nb\n\n${B}\nx\n${END_MARKER}\n`);
  });
});
