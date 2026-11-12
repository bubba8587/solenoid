// [[save-format#A save loses nothing quietly]], [[save-format#The strict validator]], [[inline-literal-maps#One field per input]]
import { describe, it, expect } from "vitest";
import { buildGroundingSpec } from "../../src/graph/aiGrounding";
import { validateText } from "../../src/graph/graphValidate";

/** Each card's class and the keys its "inline:" line names, without the open-ended note. */
function inlineKeys(): { type: string; lit: string[]; str: string[] }[] {
  const cards = buildGroundingSpec().split(/\n(?=#### )/).slice(1);
  return cards.flatMap((card) => {
    const type = /^#### `(\w+)`/.exec(card)?.[1];
    const line = card.split("\n").find((l) => l.startsWith("- inline: "));
    if (!type || !line) return [];
    const keys = (kind: string) =>
      (new RegExp(`${kind}: ([^·]*)`).exec(line)?.[1] ?? "").split(",").map((k) => k.trim()).filter((k) => k !== "" && !k.startsWith("("));
    return [{ type, lit: keys("lit"), str: keys("str") }];
  });
}

describe("the card reference's inline keys", () => {
  it("names GROUPBY's keys, a field born empty and so in no map", () => {
    expect(inlineKeys().find((c) => c.type === "GroupByFrameNode")?.str).toEqual(["column", "keys"]);
  });

  it("names only keys a card reads: none is refused as dropped on load", () => {
    const refused: string[] = [];
    for (const { type, lit, str } of inlineKeys()) {
      const line = `N: ${type} ${[...lit.map((k) => `lit:${k}=1`), ...str.map((k) => `str:${k}="x"`)].join(" ")}`;
      for (const issue of validateText(`${line}\n---\n{}`).issues) {
        if (/no field on|takes no inline/.test(issue.message)) refused.push(`${type}: ${issue.message}`);
      }
    }
    expect(refused).toEqual([]);
  });
});
