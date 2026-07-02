import { describe, it, expect } from "vitest";
import type { ClassicPreset } from "rete";
import { FLAT_CATALOG } from "./catalogUtils";
import { extractInit } from "./copyPaste";

// Catalog-wide persistence fixed-point sweep (v1.0 audit finding 38): node
// state survives save/load ONLY if extractInit captures it AND the constructor
// re-applies it. A field missed on either side silently drops on reload with
// nothing to catch it — this sweep is the net. For every catalog entry:
//   init₁ = extractInit(node)         (what a save captures)
//   node₂ = new Ctor(init₁) + literal-map restore (what a load rebuilds)
//   init₂ = extractInit(node₂)        (what the NEXT save would capture)
// and init₂ must equal init₁ — a fixed point. Then flip every boolean and
// perturb every literal to prove non-default values survive too.

type AnyNode = Record<string, unknown>;

function rebuild(n1: ClassicPreset.Node): ClassicPreset.Node {
  const Ctor = n1.constructor as new (init?: Record<string, unknown>) => ClassicPreset.Node;
  const n2 = new Ctor(extractInit(n1));
  // The load/paste path restores the literal maps after construction
  // (copyPaste.cloneNode / persistence) — mirror that.
  const a = n1 as unknown as AnyNode, b = n2 as unknown as AnyNode;
  if (a.literals && typeof a.literals === "object") b.literals = { ...(a.literals as object) };
  if (a.stringLiterals && typeof a.stringLiterals === "object") b.stringLiterals = { ...(a.stringLiterals as object) };
  return n2;
}

// Fields a constructor legitimately normalizes (clamps/derives), so a blind
// perturbation is expected NOT to round-trip. Add entries WITH A REASON.
const PERTURB_SKIP = new Set<string>([
  // GroupNode derives its label from `title`; NodeShell titles feed `label`.
  "label",
]);

describe("persistence fixed-point sweep (every catalog node)", () => {
  const entries = [...FLAT_CATALOG.entries()];

  it("extractInit is a fixed point through one construct cycle", () => {
    const broken: string[] = [];
    for (const [type, entry] of entries) {
      let n1: ClassicPreset.Node;
      try { n1 = entry.create() as ClassicPreset.Node; } catch { continue; } // constructability is catalogRegistry.test's job
      try {
        const init1 = extractInit(n1);
        const init2 = extractInit(rebuild(n1));
        expect(init2, `catalog type "${type}"`).toEqual(init1);
      } catch (e) {
        broken.push(`${type}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("perturbed booleans and literals survive the cycle", () => {
    const broken: string[] = [];
    for (const [type, entry] of entries) {
      let n1: ClassicPreset.Node;
      try { n1 = entry.create() as ClassicPreset.Node; } catch { continue; }
      const a = n1 as unknown as AnyNode;
      // Flip every captured boolean own-field.
      for (const key of Object.keys(a)) {
        if (PERTURB_SKIP.has(key)) continue;
        if (typeof a[key] === "boolean") a[key] = !a[key];
      }
      // Perturb the literal maps (free-form by definition).
      if (a.literals && typeof a.literals === "object") {
        const lits = a.literals as Record<string, number>;
        for (const k of Object.keys(lits)) lits[k] = (lits[k] ?? 0) + 7;
      }
      if (a.stringLiterals && typeof a.stringLiterals === "object") {
        const lits = a.stringLiterals as Record<string, string>;
        for (const k of Object.keys(lits)) lits[k] = `${lits[k] ?? ""}~X`;
      }
      try {
        const init1 = extractInit(n1);
        const init2 = extractInit(rebuild(n1));
        expect(init2, `catalog type "${type}" (perturbed)`).toEqual(init1);
      } catch (e) {
        broken.push(`${type}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
