import { describe, it, expect } from "vitest";
import { NODE_EXCEL } from "./nodeExcel";
import { FLAT_CATALOG } from "./catalogUtils";
import { NODE_COMPONENTS, componentForNode } from "./nodeRegistry";

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
