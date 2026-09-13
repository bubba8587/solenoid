import { describe, expect, it } from "vitest";
import { FLAT_CATALOG, nodeDisplayName, nodeTypeName } from "../../src/graph/catalogUtils";

// NAME-3 (revised): a placed card shows its FAMILY name (class-derived), op-agnostic —
// the op dropdown on the card already carries the op, so the header never repeats it. So
// an op family's every leaf lands on ONE shared card name ("Series", not "Range"), and the
// search-only "Family: Op" form never leaks onto a card. A create()-time label still wins.
describe("card title", () => {
  const DERIVED = new Set(["conduit", "composite-input", "composite-output"]);
  const leaves = [...FLAT_CATALOG.values()].filter(
    (e) => !e.type.includes("__op-") && !e.type.includes("__excel-") && !DERIVED.has(e.type),
  );

  it("a card is named by its family, never the op or the search-only form", () => {
    const byCtor = new Map<string, Set<string>>();
    const bad: string[] = [];
    for (const leaf of leaves) {
      let inst: object;
      try { inst = leaf.create() as object; } catch { continue; }
      const name = nodeDisplayName(inst);
      // The "Family: Op" form is a search-menu artifact; it must never be a card title.
      if (name.includes(": ")) bad.push(`${leaf.type}: card "${name}" leaked the search-only form`);
      // Op families: every op leaf that keeps the default (unlabeled) card must share ONE
      // name — the family. A create()-time label (Slider, KPI, …) legitimately overrides it.
      const label = ((inst as { label?: string }).label ?? "").trim();
      if (!label) {
        const ctor = (inst as { constructor: { name: string } }).constructor.name;
        (byCtor.get(ctor) ?? byCtor.set(ctor, new Set()).get(ctor)!).add(name);
      }
    }
    for (const [ctor, names] of byCtor) {
      if (names.size > 1) bad.push(`${ctor}: op leaves disagree on the card name: ${[...names].join(", ")}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("nodeTypeName is the class family name, de-suffixed and spaced", () => {
    expect(nodeTypeName({ constructor: { name: "SeriesNode" } })).toBe("Series");
    expect(nodeTypeName({ constructor: { name: "NumberInputNode" } })).toBe("Number Input");
  });
});
