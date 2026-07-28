import { describe, it, expect } from "vitest";
import { NODE_EXCEL } from "./nodeExcel";
import { FLAT_CATALOG } from "./catalogUtils";
import { NODE_COMPONENTS, componentForNode } from "./nodeRegistry";
import { extractInit } from "./copyPaste";

// HARD version of the dev-only catalogValidator console warnings (v1.0 audit,
// quality): catalog↔registry drift previously surfaced only as a dev console
// warn nobody reads — which let a fully dead node class (the old NaNode, whose
// menu entry silently built a ConstantNode instead) live in the registry for
// weeks. These assertions fail the build instead.

describe("catalog ↔ registry consistency", () => {
  it("every NODE_EXCEL key resolves to a catalog entry", () => {
    const stale = Object.keys(NODE_EXCEL).filter((type) => !FLAT_CATALOG.has(type));
    expect(stale).toEqual([]);
  });

  it("every registered node class is constructable by some catalog entry", () => {
    // Instantiate each catalog entry once and collect the concrete classes the
    // menu can actually create.
    const constructable = new Set<unknown>();
    for (const entry of FLAT_CATALOG.values()) {
      try {
        constructable.add((entry.create() as object).constructor);
      } catch {
        /* an entry that throws is caught by the next assertion */
      }
    }
    // Registry classes that no catalog entry creates. Allow-list classes that
    // are created by OTHER means than the Add menu — extend WITH A REASON.
    const allowed = new Set<string>([
      // Created by the LOADER for unknown node types (lossless placeholder);
      // deliberately absent from the Add menu.
      "PlaceholderNode",
    ]);
    const dead = NODE_COMPONENTS
      .map(([ctor]) => ctor)
      .filter((ctor) => !constructable.has(ctor) && !allowed.has(ctor.name))
      .map((ctor) => ctor.name);
    expect(dead).toEqual([]);
  });

  // PERSIST-6, the uniqueness half. The save format stores
  // `type: n.constructor.name` and the ctor registry maps name → class
  // FIRST-WINS (nodeCtorRegistry) — so two classes sharing a name means every
  // saved instance of the loser reconstructs as the WRONG class: the init
  // fields it doesn't know are ignored, different sockets build, cables that
  // still fit re-attach, and the graph opens looking mostly right while
  // computing something else. No placeholder fires — that path needs an ABSENT
  // type, and a collision is indistinguishable from a hit.
  it("no two catalog classes share a constructor name (PERSIST-6)", () => {
    const byName = new Map<string, Set<unknown>>();
    for (const entry of FLAT_CATALOG.values()) {
      let inst: object;
      try { inst = entry.create() as object; } catch { continue; }
      const name = inst.constructor.name;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(inst.constructor);
    }
    const collisions = [...byName].filter(([, ctors]) => ctors.size > 1).map(([n]) => n);
    expect(collisions, `class-name collisions — saves of the losing class reload as the winner: ${collisions.join(", ")}`).toEqual([]);
  });

  // EFFECT-1's persistence half: an external-effect arm flag must never
  // round-trip — every load (save reopen, paste, placeholder restore) starts
  // disarmed, so opening a shared file can never write to YOUR disk. The two
  // sink families pin this per-class (sink.test.ts / obsidian.test.ts); this is
  // the catalog-wide quantifier, so a FUTURE sink whose author whitelists the
  // flag (or names it `enabled` on a new node) fails here by name.
  it("no catalog class persists an `enabled` arm flag, and none constructs armed (EFFECT-1)", () => {
    const offenders: string[] = [];
    for (const entry of FLAT_CATALOG.values()) {
      let inst: Record<string, unknown> & object;
      try { inst = entry.create() as typeof inst; } catch { continue; }
      if (inst.enabled === true) offenders.push(`${inst.constructor.name} constructs ARMED (enabled=true)`);
      const init = extractInit(inst as never) as Record<string, unknown>;
      if ("enabled" in init) offenders.push(`${inst.constructor.name} persists \`enabled\` — an armed sink would round-trip through a shared file`);
    }
    expect(offenders, offenders.join("\n  ")).toEqual([]);
  });

  // VAL-14, the ONLY-IF direction. Declaring `literals` / `stringLiterals` is
  // the class's statement that its card edits those values inline, and the
  // persistence load gate trusts it: a save's maps are restored onto any
  // declaring class. A class that declares a map its card never edits therefore
  // lets a hand-authored save inject a value the user can never see or change.
  // (The IF direction — a typeable list input implies a stringLiterals
  // declaration — is in coerceInputs.test.ts.)
  //
  // "The card edits it" is checked against the component function's source: it
  // renders the generic inline editor (InlineInputs) or touches the maps itself
  // (`data.literals[...]` / `data.stringLiterals[...]` — the bespoke draw-your-
  // data and toggle cards). Crude, but exactly as crude as the failure mode: an
  // editing surface is a reference to the map or the editor by name.
  it("no class declares a literal map its component never edits (VAL-14 only-if)", () => {
    const offenders: string[] = [];
    const seen = new Set<unknown>();
    for (const entry of FLAT_CATALOG.values()) {
      let inst: Record<string, unknown> & object;
      try { inst = entry.create() as typeof inst; } catch { continue; }
      const ctor = inst.constructor;
      if (seen.has(ctor)) continue;
      seen.add(ctor);
      const declared = (["literals", "stringLiterals"] as const)
        .filter((k) => typeof inst[k] === "object" && inst[k] !== null);
      if (declared.length === 0) continue;
      const comp = componentForNode(inst);
      const src = comp ? String(comp) : "";
      if (!/InlineInputs|ExtensibleInputs|[lL]iterals/.test(src)) {
        offenders.push(`${ctor.name} (leaf "${entry.type}") declares ${declared.join(" + ")}`);
      }
    }
    expect(
      offenders,
      `These classes declare a literal map their component never edits (VAL-14): ` +
      `the load gate will restore saved values onto them that the card cannot show. ` +
      `Drop the declaration, or give the card an editing surface:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("every catalog entry constructs without throwing", () => {
    const broken: string[] = [];
    for (const [type, entry] of FLAT_CATALOG) {
      try {
        entry.create();
      } catch {
        broken.push(type);
      }
    }
    expect(broken).toEqual([]);
  });

  it("every registered class resolves to ITS OWN component (subclass shadowing)", () => {
    // ImportObsidianNode extends NoteNode: with a plain first-match instanceof
    // scan, whichever entry came first won — an Imported Note once rendered as a
    // plain Note. componentForNode's exact-constructor pass makes entry order
    // irrelevant for registered classes; this pins that for every future subclass.
    const wrong = NODE_COMPONENTS
      .filter(([ctor, component]) => componentForNode(Object.create(ctor.prototype) as object) !== component)
      .map(([ctor]) => ctor.name);
    expect(wrong).toEqual([]);
  });
});
