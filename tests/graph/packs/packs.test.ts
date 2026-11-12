// [[B15]], [[C79]]
import { describe, it, expect } from "vitest";
import { BUILTIN_PACKS, NODE_PACK_TAGS, PACK_GROUP_ORDER } from "../../../src/graph/packs";
import { auditPackNodes } from "../../../src/graph/packs/formulaTestKit";
import { fcUnitToUnit } from "../../../src/graph/dimension";

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

  it("every input of a formula preset says what it is ([[composite-nodes#A pack node is a ready-made formula unless it says it needs custom code]])", () => {
    const bare: string[] = [];
    for (const p of BUILTIN_PACKS) {
      for (const { entry } of p.nodes ?? []) {
        const n = entry.create() as unknown as { locked?: boolean; varNames?: string[]; varDescriptions?: Record<string, string> };
        if (!n.locked || !n.varNames) continue;
        for (const v of n.varNames) if (!n.varDescriptions?.[v]?.trim()) bare.push(`${entry.type}: ${v}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it("a preset's physical constants arrive on a Physics Constant cabled into the variable", () => {
    const bad: string[] = [];
    for (const p of BUILTIN_PACKS) {
      for (const { entry } of p.nodes ?? []) {
        const host = entry.create() as unknown as { inputs: Record<string, unknown> };
        for (const c of entry.companions?.() ?? []) {
          const node = c.node as { constructor: { name: string }; outputs: Record<string, unknown> };
          if (node.constructor.name !== "PhysicsConstantNode") bad.push(`${entry.type}: companion ${node.constructor.name}`);
          if (!(c.output in node.outputs)) bad.push(`${entry.type}: no output ${c.output}`);
          if (!(c.input in host.inputs)) bad.push(`${entry.type}: no input ${c.input}`);
        }
      }
      // The card a pack's presets spawn shows in the Add menu whenever that pack is on.
      if (p.nodes?.some(({ entry }) => entry.companions) && !p.tags?.includes("physics-constant")) bad.push(`${p.id}: does not tag physics-constant`);
    }
    expect(bad).toEqual([]);
  });

  it("a preset's constant has no default: cut its cable and the card names it, never computing with a hidden copy", () => {
    const entry = BUILTIN_PACKS.flatMap((p) => p.nodes ?? []).find(({ entry: e }) => e.type === "em-coulomb-force")!.entry;
    const node = entry.create() as unknown as { varRequired: string[]; literals: Record<string, number>; data: (i: Record<string, unknown[]>) => { result: unknown } };
    expect(node.varRequired).toEqual(["ke"]);
    expect(node.literals.ke).toBeUndefined();
    const inputs = { q1: [1e-6], q2: [1e-6], r: [1] };
    expect(node.data(inputs).result).toMatchObject({ code: "#SYNTAX!", message: "ke is blank, and it has no default" });
    expect(node.data({ ...inputs, ke: [8.9875517923e9] }).result).toBeCloseTo(0.0089875517923, 12);
    node.literals.ke = 9e9;
    expect(node.data(inputs).result).toBeCloseTo(0.009, 12);
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

describe("[[C25]] firstClassUnits — physical presets read wired units in their declared unit", () => {
  type Runner = { data: (i: Record<string, unknown[]>) => Record<string, unknown> };
  const run = async (pack: string, type: string, inputs: Record<string, unknown>) => {
    const mod = await import(`../../../src/graph/packs/${pack}.ts`);
    const all = Object.values(mod).filter(Array.isArray).flat() as { type: string }[];
    const { formulaNode } = await import("../../../src/graph/packs/packShared");
    const entry = all.find((e) => e.type === type)!;
    const n = formulaNode(entry as never).create() as unknown as Runner;
    const { PHYS_CONSTANTS } = await import("../../../src/graph/nodes/physicsConstantsOps");
    const ins: Record<string, unknown[]> = {};
    // Its Physics Constants, cabled in as the Add menu does.
    for (const [k, op] of Object.entries((entry as { constants?: Record<string, keyof typeof PHYS_CONSTANTS> }).constants ?? {})) ins[k] = [PHYS_CONSTANTS[op].value];
    for (const [k, v] of Object.entries(inputs)) ins[k] = [v];
    return n.data(ins).result;
  };
  it("escape velocity with r in km matches r in m; Ohm's law reads kΩ; BMI reads cm", async () => {
    const { applyFcUnit } = await import("../../../src/graph/unitBridge");
    const m = await run("earthsky", "es-escape-velocity", { m: 5.972e24, r: 6.371e6 }) as number;
    expect(await run("earthsky", "es-escape-velocity", { m: 5.972e24, r: applyFcUnit(6371, "km") }) as number).toBeCloseTo(m, 6);
    expect(((await run("earthsky", "es-escape-velocity", { m: 5.972e24, r: applyFcUnit(5, "kg") })) as { code?: string }).code).toBe("#UNIT!");
    const bmi = await run("health", "hf-bmi", { w: 70, h: 1.75 }) as number;
    expect(await run("health", "hf-bmi", { w: 70, h: applyFcUnit(175, "cm") }) as number).toBeCloseTo(bmi, 9);
  });
});
