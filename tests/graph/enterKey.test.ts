// [[B19]] spreadsheetHabits, [[components#The rules]]
import { describe, expect, it } from "vitest";
import { composing, isEnter } from "../../src/graph/enterKey";
import { gridKeyOf } from "../../src/graph/components/gridKeyboard";

describe("Enter is a commit only outside an input method's composition", () => {
  it("a plain Enter, from the DOM or from React, is Enter", () => {
    expect(isEnter({ key: "Enter" })).toBe(true);
    expect(isEnter({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(true);
  });
  it("the Enter that confirms a candidate is not, however the browser reports it", () => {
    expect(isEnter({ key: "Enter", isComposing: true })).toBe(false);
    expect(isEnter({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(false);
    expect(isEnter({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(false);
    expect(composing({ key: "a", keyCode: 229 })).toBe(true);
  });
  it("other keys are not Enter", () => expect(isEnter({ key: "Tab" })).toBe(false));
  it("the grid takes no key mid-composition", () => {
    const k = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
    expect(gridKeyOf(k)).toBe("Enter");
    expect(gridKeyOf({ ...k, nativeEvent: { isComposing: true } })).toBeNull();
  });
});
