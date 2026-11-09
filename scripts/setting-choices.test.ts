// [[C26]] opArgDistinct
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error a plain .mjs script, untyped
import { OUT, settingChoices, render } from "./setting-choices.mjs";
import choices from "../src/graph/settingChoices.json";
import { FLAT_CATALOG } from "../src/graph/catalogUtils";
import { validateText } from "../src/graph/graphValidate";

describe("setting choices", () => {
  it("the table is current with the card classes' types (run node scripts/setting-choices.mjs)", () => {
    expect(readFileSync(OUT as string, "utf8")).toBe((render as (c: unknown) => string)((settingChoices as () => unknown)()));
  });

  it("every card starts on one of its setting's choices", () => {
    const off: string[] = [];
    for (const leaf of FLAT_CATALOG.values()) {
      const inst = leaf.create() as unknown as Record<string, unknown>;
      const ctor = (inst as object).constructor.name;
      for (const [field, allowed] of Object.entries((choices as Record<string, Record<string, string[]>>)[ctor] ?? {})) {
        const v = inst[field];
        if (typeof v === "string" && !allowed.includes(v)) off.push(`${ctor}.${field} = ${v}`);
      }
    }
    expect(off).toEqual([]);
  });

  it("the validator refuses a setting outside its choices and names them", () => {
    const { issues } = validateText(`J: JoinNode how="leftouter"\nS: SortFrameNode dir="desc"\n---\n{}`);
    expect(issues.map((i) => i.message)).toEqual(['unknown how "leftouter" for JoinNode. Values: anti, asof, cross, inner, left, outer, right, semi.']);
  });
});
