// [[C24]] arraySemantics, [[error-values#An error remembers the node where it started]], [[table-popup#Formatted and Source]]
import { describe, expect, it } from "vitest";
import { controlledCellText } from "../../src/graph/components/controlledCell";
import type { FormatAnnotation } from "../../src/graph/formatAnnotationStore";

const auto = { format: "auto", unit: "none" } as FormatAnnotation;
const none = () => ({ unit: "none" as const });

describe("controlledCellText", () => {
  it("shows the code of a date the column type reads as an error, never [object Object]", () => {
    expect(controlledCellText("3/4/2026", "date", auto, none)).toBe("#AMBIGUOUS!");
  });
  it("formats a readable date and leaves a blank blank", () => {
    expect(controlledCellText("2026-01-02", "date", auto, none)).toBe("02-Jan-2026");
    expect(controlledCellText("", "date", auto, none)).toBe("");
  });
});
