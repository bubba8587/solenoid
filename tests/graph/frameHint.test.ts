import { describe, it, expect } from "vitest";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import type { FrameHint } from "../../src/graph/frameHint";

// frameLabelHint (rules.md): a role-chain-labeled frame input and its example hint are
// ONE contract — the hint must exist, its column names must match the label's
// roles, and every hint (role-labeled or not) must stay well-formed: real input
// key, 3–5 rectangular rows, cells matching the declared types. A drifted hint
// renders a confidently wrong example, which is worse than none.

// Standard column-group initialisms a role may compact to (frameLabelGrammar).
const INITIALISMS: Record<string, string[]> = {
  OHLC: ["Open", "High", "Low", "Close"],
};

type Hinted = { ctor: string; key: string; hint: FrameHint; inputs: Set<string> };
type RoleLabeled = { ctor: string; key: string; label: string; hint: FrameHint | undefined };

function inputLabels(inst: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const inputs = (inst as { inputs?: Record<string, { label?: string }> }).inputs ?? {};
  for (const [key, port] of Object.entries(inputs)) {
    if (typeof port?.label === "string") out.set(key, port.label);
  }
  return out;
}

function collect(): { hinted: Hinted[]; roleLabeled: RoleLabeled[] } {
  const hinted = new Map<string, Hinted>();
  const roleLabeled = new Map<string, RoleLabeled>();
  for (const entry of FLAT_CATALOG.values()) {
    let inst: unknown;
    try { inst = entry.create(); } catch { continue; }
    const ctor = (inst as object).constructor as { name: string; frameHints?: Record<string, FrameHint> };
    const labels = inputLabels(inst);
    for (const [key, label] of labels) {
      if (label.includes(" + ")) {
        roleLabeled.set(`${ctor.name}.${key}`, { ctor: ctor.name, key, label, hint: ctor.frameHints?.[key] });
      }
    }
    if (!ctor.frameHints) continue;
    const inputs = new Set(labels.keys());
    for (const [key, hint] of Object.entries(ctor.frameHints)) {
      hinted.set(`${ctor.name}.${key}`, { ctor: ctor.name, key, hint, inputs });
    }
  }
  return { hinted: [...hinted.values()], roleLabeled: [...roleLabeled.values()] };
}

describe("frame-input example hints", () => {
  const { hinted, roleLabeled } = collect();

  it("every role-chain-labeled frame input declares a hint whose columns match the label (frameLabelHint)", () => {
    expect(roleLabeled.length, "role-chain-labeled inputs in the catalog").toBeGreaterThanOrEqual(5);
    for (const { ctor, key, label, hint } of roleLabeled) {
      expect(hint, `${ctor}.${key} ("${label}"): role-labeled input with no frameHints entry`).toBeDefined();
      const roles = label.split(" + ").flatMap((r) => INITIALISMS[r] ?? [r]);
      expect(
        hint!.columns.map((c) => c.name),
        `${ctor}.${key}: hint columns must match the label's roles in order`,
      ).toEqual(roles);
    }
  });

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
