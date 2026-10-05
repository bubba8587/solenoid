// [[B15]], [[C79]]
import { describe, it, expect } from "vitest";
import { BUILTIN_PACKS, NODE_PACK_TAGS, PACK_GROUP_ORDER } from "../../../src/graph/packs";
import { auditPackNodes } from "../../../src/graph/packs/formulaTestKit";
import { fcUnitToUnit } from "../../../src/graph/unitBridge";

// Structural health of every built-in pack: entries construct, type ids are
// unique pack-wide AND across packs (multi-pack claims must share the SAME
// entry object semantics — same label — or the dedupe hides a divergence),
// dependencies point at real packs.

describe("built-in packs", () => {
  it("every declared input unit resolves and names one of the preset's inputs ([[C25]] firstClassUnits)", () => {
    const bad: string[] = [];
    for (const p of BUILTIN_PACKS) {
      for (const { entry } of p.nodes ?? []) {
        const n = entry.create() as unknown as { varUnits?: Record<string, string>; inputs: Record<string, unknown> };
        for (const [k, u] of Object.entries(n.varUnits ?? {})) {
          if (!fcUnitToUnit(u)) bad.push(`${entry.type}: ${k} reads in "${u}", which is no unit`);
          if (!(k in n.inputs)) bad.push(`${entry.type}: ${k} is no input`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("every pack sits in a listed group, so Settings and the Packs page both show it", () => {
    for (const p of BUILTIN_PACKS) expect(PACK_GROUP_ORDER, `pack ${p.id}`).toContain(p.group);
  });

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

  it("no two preset types carry the same formula, across every pack ([[B11]] maximalMerge)", () => {
    // A pack that wants another pack's preset places the same entry (HYPOTENUSE's pattern), never a copy.
    const byExpr = new Map<string, string>();
    const dupes: string[] = [];
    for (const p of BUILTIN_PACKS) {
      for (const { entry } of p.nodes ?? []) {
        const expr = (entry.create() as { expr?: unknown }).expr;
        if (typeof expr !== "string") continue;
        const key = expr.replace(/\s/g, "");
        const prev = byExpr.get(key);
        if (prev !== undefined && prev !== entry.type) dupes.push(`${prev} = ${entry.type}`);
        byExpr.set(key, entry.type);
      }
    }
    expect(dupes).toEqual([]);
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
