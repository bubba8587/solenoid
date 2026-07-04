import { describe, it, expect } from "vitest";
import { writeTextForm, readTextForm } from "./textForm";
import type { SavedGraph } from "./persistence";

// Round-trip losslessness for the text projection (Bet 2 — the addressable model,
// docs/subsystem-invariants.md "Addressable model"). Mirrors seeds.test.ts's
// load-every-seed structure (import.meta.glob, lines 24+): for every seed, write
// text, re-read into a graph, re-write, and assert the SECOND write is
// byte-identical to the first — the idempotence guarantee the design session
// settled on, machine-checked the same way cablePaths.test.ts guards continuity.

const seedModules = import.meta.glob("./seedGraphs/*.json", { eager: true }) as Record<
  string,
  { default?: SavedGraph } & SavedGraph
>;

for (const [path, mod] of Object.entries(seedModules)) {
  const g = (mod.default ?? mod) as SavedGraph;
  const name = path.replace("./seedGraphs/", "");

  describe(`text form round-trip: ${name}`, () => {
    it("second write is byte-identical to the first", () => {
      const text1 = writeTextForm(g);
      const reloaded = readTextForm(text1);
      const text2 = writeTextForm(reloaded);
      expect(text2).toBe(text1);
    });

    it("every node survives with a unique name and its original type", () => {
      const text = writeTextForm(g);
      const reloaded = readTextForm(text);
      expect(reloaded.nodes.length).toBe(g.nodes.length);
      const names = new Set(reloaded.nodes.map((n) => n.name));
      expect(names.size).toBe(reloaded.nodes.length);
      const originalTypes = new Set(g.nodes.map((n) => n.type));
      const reloadedTypes = new Set(reloaded.nodes.map((n) => n.type));
      expect(reloadedTypes).toEqual(originalTypes);
    });

    it("every connection survives, re-addressed by name", () => {
      const text = writeTextForm(g);
      const reloaded = readTextForm(text);
      expect(reloaded.connections.length).toBe(g.connections.length);
      // Every connection must resolve to real (name-addressed) nodes in the
      // round-tripped graph, and no two connections collapse into one.
      const names = new Set(reloaded.nodes.map((n) => n.name));
      const keys = new Set<string>();
      for (const c of reloaded.connections) {
        expect(names.has(c.source)).toBe(true);
        expect(names.has(c.target)).toBe(true);
        keys.add(`${c.source}.${c.sourceOutput}->${c.target}.${c.targetInput}`);
      }
      expect(keys.size).toBe(reloaded.connections.length);
    });

    it("node lines are in valid topological order (forward references only inside a real dependency cycle, if any)", () => {
      // A graph can contain a genuine wiring cycle on purpose (error-codes.json
      // demonstrates #CIRC!) — no total topological order exists for one, so the
      // writer's documented fallback (append cycle remnants alphabetically by
      // name) necessarily violates SOME edge inside that cycle. What must still
      // hold: every edge NOT part of a cycle stays forward-referencing.
      const text = writeTextForm(g);
      const lines = text.split("\n---\n")[0].split("\n").filter((l) => l.length > 0);
      const adj = new Map<string, string[]>();
      for (const line of lines) {
        const name = line.slice(0, line.indexOf(":"));
        const refs = [...line.matchAll(/<-([A-Za-z_][A-Za-z0-9_]*)\./g)].map((m) => m[1]);
        for (const ref of refs) {
          const arr = adj.get(ref);
          if (arr) arr.push(name); else adj.set(ref, [name]);
        }
      }
      const inCycle = new Set<string>();
      for (const start of adj.keys()) {
        const stack = [start];
        const visited = new Set<string>();
        while (stack.length > 0) {
          const u = stack.pop()!;
          if (u === start && visited.size > 0) { inCycle.add(start); break; }
          if (visited.has(u)) continue;
          visited.add(u);
          for (const v of adj.get(u) ?? []) stack.push(v);
        }
      }
      const seen = new Set<string>();
      for (const line of lines) {
        const name = line.slice(0, line.indexOf(":"));
        const refs = [...line.matchAll(/<-([A-Za-z_][A-Za-z0-9_]*)\./g)].map((m) => m[1]);
        for (const ref of refs) {
          if (inCycle.has(ref) && inCycle.has(name)) continue; // a real cycle — no total order exists
          expect(seen.has(ref), `"${name}" references "${ref}" before it's defined`).toBe(true);
        }
        seen.add(name);
      }
    });

    it("standoffs and pins round-trip", () => {
      const text = writeTextForm(g);
      const reloaded = readTextForm(text);
      expect(reloaded.standoffs?.length ?? 0).toBe(g.standoffs?.length ?? 0);
      expect(reloaded.pins?.length ?? 0).toBe(g.pins?.length ?? 0);
    });
  });
}

describe("text form: unit cases", () => {
  const base: SavedGraph = { v: 2, nodes: [], connections: [] };

  it("round-trips an empty graph", () => {
    const text1 = writeTextForm(base);
    const text2 = writeTextForm(readTextForm(text1));
    expect(text2).toBe(text1);
    expect(text1.startsWith("---\n")).toBe(true);
  });

  it("assigns type-scoped default names when a node has none", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [
        { id: "a1", type: "FilterNode", x: 0, y: 0, init: {} },
        { id: "a2", type: "FilterNode", x: 10, y: 10, init: {} },
      ],
      connections: [],
    };
    const reloaded = readTextForm(writeTextForm(g));
    const names = reloaded.nodes.map((n) => n.name).sort();
    expect(names).toEqual(["Filter_1", "Filter_2"]);
  });

  it("preserves an explicit valid unique name", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [{ id: "a1", type: "FilterNode", name: "MyFilter", x: 0, y: 0, init: {} }],
      connections: [],
    };
    const reloaded = readTextForm(writeTextForm(g));
    expect(reloaded.nodes[0].name).toBe("MyFilter");
  });

  it("re-synthesizes a name that collides with another node's name", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [
        { id: "a1", type: "FilterNode", name: "Dup", x: 0, y: 0, init: {} },
        { id: "a2", type: "SortNode", name: "Dup", x: 10, y: 10, init: {} },
      ],
      connections: [],
    };
    const reloaded = readTextForm(writeTextForm(g));
    const names = reloaded.nodes.map((n) => n.name);
    expect(new Set(names).size).toBe(2);
  });

  it("encodes a value with embedded newlines and quotes on one line", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [
        {
          id: "n1",
          type: "NoteNode",
          x: 0,
          y: 0,
          init: { body: 'line one\nline "two"\nline three', title: "T" },
        },
      ],
      connections: [],
    };
    const text = writeTextForm(g);
    const nodeLine = text.split("\n---\n")[0];
    expect(nodeLine.split("\n").length).toBe(1);
    const reloaded = readTextForm(text);
    expect(reloaded.nodes[0].init.body).toBe('line one\nline "two"\nline three');
  });

  it("translates connection endpoints from id to name and back", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [
        { id: "src", type: "NumberInputNode", name: "Num_1", x: 0, y: 0, init: {} },
        { id: "tgt", type: "FilterNode", name: "Filter_1", x: 10, y: 0, init: {} },
      ],
      connections: [{ source: "src", sourceOutput: "value", target: "tgt", targetInput: "list" }],
    };
    const text = writeTextForm(g);
    expect(text).toContain("list<-Num_1.value");
    const reloaded = readTextForm(text);
    expect(reloaded.connections).toEqual([{ source: "Num_1", sourceOutput: "value", target: "Filter_1", targetInput: "list" }]);
  });

  it("translates hostNodeId / members id-references to names", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [
        { id: "host", type: "SortNode", name: "Sort_1", x: 0, y: 0, init: {} },
        { id: "fc", type: "FormatControllerNode", name: "FC_1", x: 10, y: 0, init: { hostNodeId: "host" } },
        { id: "m1", type: "SortNode", name: "Member_1", x: 0, y: 20, init: {} },
        { id: "grp", type: "GroupNode", name: "Group_1", x: 0, y: 40, init: { members: ["host", "m1"] } },
      ],
      connections: [],
    };
    const text = writeTextForm(g);
    expect(text).toContain('hostNodeId="Sort_1"');
    expect(text).toContain('members=["Sort_1","Member_1"]');
    const reloaded = readTextForm(text);
    const fc = reloaded.nodes.find((n) => n.name === "FC_1")!;
    expect(fc.init.hostNodeId).toBe("Sort_1");
    const grp = reloaded.nodes.find((n) => n.name === "Group_1")!;
    expect(grp.init.members).toEqual(["Sort_1", "Member_1"]);
  });

  it("translates Presentation step node-id sets to names", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [
        { id: "a", type: "NumberNode", name: "Number_1", x: 0, y: 0, init: {} },
        { id: "b", type: "NumberNode", name: "Number_2", x: 0, y: 20, init: {} },
        {
          id: "p", type: "PresentationNode", name: "Presentation_1", x: 10, y: 0,
          init: { label: "Deck", steps: [{ title: "Intro", nodeIds: ["a"] }, { title: "End", nodeIds: ["a", "b"] }], activeIndex: 1 },
        },
      ],
      connections: [],
    };
    const text = writeTextForm(g);
    expect(text).toContain('steps=[{"title":"Intro","nodeIds":["Number_1"]},{"title":"End","nodeIds":["Number_1","Number_2"]}]');
    const reloaded = readTextForm(text);
    const pres = reloaded.nodes.find((n) => n.name === "Presentation_1")!;
    // Step node-ids are now names (which ARE the reconstructed ids) — so rebuildGraph's
    // idMap can remap them to fresh live ids, unlike the raw rete ids they'd otherwise be.
    expect(pres.init.steps).toEqual([
      { title: "Intro", nodeIds: ["Number_1"] },
      { title: "End", nodeIds: ["Number_1", "Number_2"] },
    ]);
    expect(pres.init.activeIndex).toBe(1);
  });

  it("breaks a cycle deterministically instead of hanging or throwing", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [
        { id: "a", type: "FilterNode", name: "A", x: 0, y: 0, init: {} },
        { id: "b", type: "FilterNode", name: "B", x: 10, y: 0, init: {} },
      ],
      connections: [
        { source: "a", sourceOutput: "out", target: "b", targetInput: "list" },
        { source: "b", sourceOutput: "out", target: "a", targetInput: "list" },
      ],
    };
    expect(() => writeTextForm(g)).not.toThrow();
    const text = writeTextForm(g);
    const reloaded = readTextForm(text);
    expect(reloaded.nodes.length).toBe(2);
    expect(reloaded.connections.length).toBe(2);
  });
});
