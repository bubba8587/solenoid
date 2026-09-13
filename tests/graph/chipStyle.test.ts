import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { extractInit } from "../../src/graph/copyPaste";
import { columnFormatRow } from "../../src/graph/frameFormatStore";
import type { FormatAnnotation } from "../../src/graph/formatAnnotationStore";

// B2.2: the Chip is ONE text-family style flag (`chip`) driving one renderer, set from the
// FC text dropdown and the popup's per-column string format row. These pin the shared data
// the dropdown reflects (a render test isn't possible in the node env) + persistence.

describe("Chip text style (B2.2)", () => {
  it("the FC's chip flag rides its annotation and round-trips the init / text form", () => {
    const fc = new FormatControllerNode({ chip: true });
    expect(fc.chip).toBe(true);
    expect(fc.annotation().chip).toBe(true);
    const init = extractInit(fc);
    expect(init.chip).toBe(true); // in INIT_FIELD_ORDER → text form + copy/paste carry it
    expect(new FormatControllerNode(init).chip).toBe(true);
  });

  it("a plain FC does not chip", () => {
    expect(new FormatControllerNode().annotation().chip).toBe(false);
  });

  it("the string column's format row surfaces Chip as the picked value and the inherited hint", () => {
    const chipAnn: FormatAnnotation = { format: "auto", unit: "none", chip: true };
    // A local chip pick → the dropdown's selected value is "chip".
    expect(columnFormatRow(chipAnn, undefined, "string").value).toBe("chip");
    // Inherited chip (no local pick) → the muted column-row hint reads "← Chip".
    expect(columnFormatRow(undefined, chipAnn, "string").hint).toBe("← Chip");
  });

  // An EDITABLE popup cell must render the chip while unfocused (the render bug: it stayed
  // plain text where the read-only path chips). Node env can't render, so pin the source
  // branch: it reuses the ONE chipCols + CategoryChip mechanism, only in Formatted mode.
  it("the editable popup cell shows the chip while unfocused, via the shared chipCols/CategoryChip", () => {
    const src = readFileSync("src/graph/components/TablePopup.tsx", "utf8");
    // Gated to Formatted mode (fmtEdit) — Source mode keeps raw text.
    expect(src).toMatch(/const chipHere = fmtEdit && chipCols\.has\(c\)/);
    // Shown only while the cell is not being edited (swaps to the raw input on focus).
    expect(src).toMatch(/const chipShown = chipHere && !editingHere/);
    // Same component + same chipCols keying as readOnlyCell, not a second mechanism.
    expect(src).toMatch(/chipShown && \([\s\S]*?<CategoryChip value=\{row\[c\] \?\? ""\} index=\{chipCols\.get\(c\)!\.get\(row\[c\] \?\? ""\) \?\? 0\}/);
  });
});
