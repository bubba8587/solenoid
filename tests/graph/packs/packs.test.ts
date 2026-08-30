import { describe, it, expect } from "vitest";
import { BUILTIN_PACKS, NODE_PACK_TAGS } from "../../../src/graph/packs";
import { auditPackNodes } from "../../../src/graph/packs/formulaTestKit";

// Structural health of every built-in pack: entries construct, type ids are
// unique pack-wide AND across packs (multi-pack claims must share the SAME
// entry object semantics — same label — or the dedupe hides a divergence),
// dependencies point at real packs.

describe("built-in packs", () => {
  it("every pack's node entries construct and have unique types", () => {
    for (const p of BUILTIN_PACKS) {
      expect(auditPackNodes(p), `pack ${p.id}`).toEqual([]);
    }
  });

  it("a type shared across packs keeps one label (deduped by the builder)", () => {
    const byType = new Map<string, string>();
    for (const p of BUILTIN_PACKS) {
      for (const { entry } of p.nodes ?? []) {
        const prev = byType.get(entry.type);
        if (prev !== undefined) expect(entry.label, entry.type).toBe(prev);
        byType.set(entry.type, entry.label);
      }
    }
  });

  it("dependsOn references existing pack ids", () => {
    const ids = new Set(BUILTIN_PACKS.map((p) => p.id));
    for (const p of BUILTIN_PACKS) {
      for (const dep of p.dependsOn ?? []) {
        expect(ids.has(dep), `${p.id} dependsOn ${dep}`).toBe(true);
      }
    }
  });

  it("NODE_PACK_TAGS derives from pack tags", () => {
    expect(NODE_PACK_TAGS["logic-nor"]).toEqual(["timesavers"]);
  });
});
