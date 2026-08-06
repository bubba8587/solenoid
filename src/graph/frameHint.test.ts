import { describe, it, expect } from "vitest";
import { FLAT_CATALOG } from "./catalogUtils";
import type { FrameHint } from "./frameHint";

// Every class-declared frame-input example (frameHint.ts) must stay coherent:
// the hinted key is a REAL input on the node, columns carry 3–5 sample cells of
// the declared type, and rows stay rectangular — a drifted hint would render a
// confidently wrong example, which is worse than none.

type Hinted = { ctor: string; key: string; hint: FrameHint; inputs: Set<string> };

function collect(): Hinted[] {
  const seen = new Map<string, Hinted>();
  for (const entry of FLAT_CATALOG.values()) {
    let inst: unknown;
    try { inst = entry.create(); } catch { continue; }
    const ctor = (inst as object).constructor as { name: string; frameHints?: Record<string, FrameHint> };
    if (!ctor.frameHints) continue;
    const inputs = new Set(Object.keys((inst as { inputs?: Record<string, unknown> }).inputs ?? {}));
    for (const [key, hint] of Object.entries(ctor.frameHints)) {
      seen.set(`${ctor.name}.${key}`, { ctor: ctor.name, key, hint, inputs });
    }
  }
  return [...seen.values()];
}

describe("frame-input example hints", () => {
  const hinted = collect();

  it("at least the authored set is present", () => {
    // A refactor that silently drops the static fields would pass everything
    // else by vacuity.
    expect(hinted.length).toBeGreaterThanOrEqual(10);
  });

  it("every hint names a real input and carries 3–5 rectangular typed rows", () => {
    for (const { ctor, key, hint, inputs } of hinted) {
      expect(inputs.has(key), `${ctor}.${key}: no such input`).toBe(true);
      expect(hint.columns.length, `${ctor}.${key}: empty hint`).toBeGreaterThan(0);
      const rows = hint.columns[0].cells.length;
      expect(rows, `${ctor}.${key}: sample rows`).toBeGreaterThanOrEqual(3);
      expect(rows, `${ctor}.${key}: sample rows`).toBeLessThanOrEqual(5);
      for (const col of hint.columns) {
        expect(col.cells.length, `${ctor}.${key}.${col.name}: ragged rows`).toBe(rows);
        for (const cell of col.cells) {
          const want = col.type === "string" ? "string" : col.type === "logical" ? "boolean" : "number";
          expect(typeof cell, `${ctor}.${key}.${col.name}: cell type`).toBe(want);
        }
      }
    }
  });
});
