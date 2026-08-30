import { describe, it, expect } from "vitest";
import { ClassicPreset } from "rete";
import * as Nodes from "../../src/graph/rete-nodes";
import { SolenoidSocket, canConnect } from "../../src/graph/sockets";
import { CURRENT_SAVE_VERSION } from "../../src/graph/persistenceCore";
import { parseNoteFrontmatter } from "../../src/graph/noteFrontmatter";

// Validates every seed graph against the REAL node classes: each saved type
// resolves to a constructor, each connection lands on sockets that exist with
// compatible types, and cross-references (group members, FC hosts, standoff
// ends) resolve. Hand-authored seeds (and refactors that rename a class or a
// socket key) fail here instead of silently dropping nodes at load time.

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};
type SavedConnection = { source: string; sourceOutput: string; target: string; targetInput: string };
type SavedStandoff = { a: { nodeId: string; anchor: string }; b: { nodeId: string; anchor: string }; min: number; max: number };
type SavedGraph = { v: number; nodes: SavedNode[]; connections: SavedConnection[]; standoffs?: SavedStandoff[] };

const ANCHORS = new Set(["n", "e", "s", "w", "ne", "nw", "se", "sw"]);
/** Node types whose `body` is markdown prose the user reads on the canvas. */
const PROSE_TYPES = new Set(["NoteNode", "ReportNode", "ImportObsidianNode", "PresentationNode"]);

const seedModules = import.meta.glob("../../src/graph/seedGraphs/*.json", { eager: true }) as Record<
  string, { default?: SavedGraph } & SavedGraph
>;

type Port = { socket?: ClassicPreset.Socket };
type AnyNode = ClassicPreset.Node & {
  inputs: Record<string, Port | undefined>;
  outputs: Record<string, Port | undefined>;
};

function dataTypeOf(port: Port | undefined): string | null {
  const s = port?.socket;
  return s instanceof SolenoidSocket ? s.dataType : null;
}

// The menu fields are mandatory: a seed without them falls into an unlabeled
// alphabetical tail (the pre-grouping menu), and duplicate orders make the
// listing depend on filename tiebreaks. The version pin keeps every seed on the
// single live save format — the loader refuses any other (persistenceCore).
describe("seed menu fields", () => {
  type MenuFields = { v?: unknown; label?: unknown; order?: unknown; group?: unknown };
  const entries = Object.entries(seedModules).map(([path, mod]) => ({
    name: path.replace("./seedGraphs/", ""),
    m: (mod.default ?? mod) as MenuFields,
  }));

  it("every seed is the current save format", () => {
    const stale = entries.filter(({ m }) => m.v !== CURRENT_SAVE_VERSION).map(({ name }) => name);
    expect(stale, `not v${CURRENT_SAVE_VERSION}: ${stale.join(", ")}`).toEqual([]);
  });

  it("every seed declares label, group, and a unique order", () => {
    const problems: string[] = [];
    const byOrder = new Map<number, string>();
    for (const { name, m } of entries) {
      if (typeof m.label !== "string" || !m.label) problems.push(`${name}: missing "label"`);
      if (typeof m.group !== "string" || !m.group) problems.push(`${name}: missing "group"`);
      if (typeof m.order !== "number") {
        problems.push(`${name}: missing "order"`);
      } else if (byOrder.has(m.order)) {
        problems.push(`${name}: order ${m.order} collides with ${byOrder.get(m.order)}`);
      } else {
        byOrder.set(m.order, name);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

for (const [path, mod] of Object.entries(seedModules)) {
  const g = (mod.default ?? mod) as SavedGraph;
  const name = path.replace("./seedGraphs/", "");

  describe(`seed ${name}`, () => {
    const byId = new Map<string, AnyNode>();

    it("every node type constructs", () => {
      for (const sn of g.nodes) {
        const typeName = sn.type;
        const Ctor = (Nodes as unknown as Record<string, unknown>)[typeName] as
          (new (init?: Record<string, unknown>) => AnyNode) | undefined;
        expect(Ctor, `unknown node type "${sn.type}" (id ${sn.id})`).toBeTypeOf("function");
        const node = new Ctor!({ ...sn.init });
        const anyNode = node as unknown as Record<string, unknown>;
        if (sn.literals) anyNode.literals = { ...sn.literals };
        if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
        byId.set(sn.id, node);
      }
    });

    // A seed may only author `literals` / `stringLiterals` where the user could
    // have typed them: a class DECLARES the map iff its card edits it inline.
    // A wire-driven card (the Equation family) declares neither, so authoring a
    // literal there would plant a hardcoded known the user can't see or edit on
    // the card — the "TVM fv: 0" bug. Load enforces the same rule (persistence
    // restores literals only onto declaring classes); this catches the seed at
    // authoring time instead of silently dropping it.
    it("authored literals land on inline-editable (declaring) classes only", () => {
      const problems: string[] = [];
      for (const sn of g.nodes) {
        const Ctor = (Nodes as unknown as Record<string, unknown>)[sn.type] as
          (new (init?: Record<string, unknown>) => AnyNode) | undefined;
        if (!Ctor) continue; // unknown type — already failed above
        const fresh = new Ctor({ ...sn.init }) as unknown as Record<string, unknown>;
        for (const field of ["literals", "stringLiterals"] as const) {
          const authored = sn[field];
          if (!authored || Object.keys(authored).length === 0) continue;
          if (typeof fresh[field] !== "object") {
            problems.push(
              `${sn.id} (${sn.type}) authors ${field} {${Object.keys(authored).join(", ")}} ` +
              `but the class doesn't declare ${field} — its card is wire-driven, so this ` +
              `hardcodes a value the user can't edit inline. Wire a visible input node instead.`,
            );
          }
        }
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });

    it("every connection lands on existing, compatible sockets", () => {
      for (const c of g.connections) {
        const src = byId.get(c.source);
        const tgt = byId.get(c.target);
        expect(src, `connection source ${c.source} missing`).toBeDefined();
        expect(tgt, `connection target ${c.target} missing`).toBeDefined();
        const out = src!.outputs[c.sourceOutput];
        const inp = tgt!.inputs[c.targetInput];
        expect(out, `${c.source} has no output "${c.sourceOutput}"`).toBeDefined();
        expect(inp, `${c.target} has no input "${c.targetInput}"`).toBeDefined();
        const a = dataTypeOf(out);
        const b = dataTypeOf(inp);
        if (a && b) {
          // Use the DIRECTIONAL canConnect (out → in), the SAME check the app's
          // connection guard runs — not the laxer symmetric areCompatible. A seed
          // connection that areCompatible allows but canConnect refuses is silently
          // DROPPED on load (this exact gap shipped the PF "projected nest egg = -$2k"
          // bug: Expression `numlist` outputs into `number` inputs, blocked by
          // canConnect). Catch it here instead.
          expect(
            canConnect(a as never, b as never),
            `${c.source}.${c.sourceOutput} (${a}) → ${c.target}.${c.targetInput} (${b}) would DROP on load (canConnect false)`,
          ).toBe(true);
        }
      }
    });

    // Group geometry invariants — violations here are the "groups freak out"
    // bug: reconcileGroupBox / drag-reconcile absorb any node whose CENTER
    // falls inside a group's box, so a seed group overlapping bystanders (or a
    // member whose center sits outside its own box) silently rewires
    // membership the first time the user drags or autofits.
    it("group boxes contain exactly their members' centers", () => {
      type Box = { x: number; y: number; w: number; h: number };
      const nodeBoxes = new Map<string, Box>();
      const groups: { id: string; box: Box; members: string[]; collapsed: boolean }[] = [];

      for (const sn of g.nodes) {
        const inst = byId.get(sn.id) as unknown as { width?: number; height?: number };
        const w = (sn.init?.width as number) ?? inst?.width ?? 180;
        const h = (sn.init?.height as number) ?? inst?.height ?? 100;
        const x = (sn as unknown as { x: number }).x;
        const y = (sn as unknown as { y: number }).y;
        const members = sn.init?.members as string[] | undefined;
        if (Array.isArray(members)) {
          groups.push({ id: sn.id, box: { x, y, w, h }, members, collapsed: sn.init?.collapsed === true });
        } else {
          nodeBoxes.set(sn.id, { x, y, w, h });
        }
      }

      const problems: string[] = [];
      const owner = new Map<string, string>();
      for (const grp of groups) {
        for (const m of grp.members) {
          if (owner.has(m)) problems.push(`${m} is in two groups (${owner.get(m)} and ${grp.id})`);
          owner.set(m, grp.id);
          const b = nodeBoxes.get(m);
          if (!b) continue; // dangling — caught by the resolve test
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          const inside = cx >= grp.box.x && cx <= grp.box.x + grp.box.w &&
                         cy >= grp.box.y && cy <= grp.box.y + grp.box.h;
          if (!inside) problems.push(`member ${m} center (${Math.round(cx)},${Math.round(cy)}) outside group ${grp.id} box`);
        }
      }
      // Bystanders: a non-member center inside an EXPANDED group's box gets
      // absorbed by the next reconcile. (Collapsed groups render small, and
      // expand-push clears neighbors, so only expanded boxes are landmines.)
      for (const grp of groups.filter((x) => !x.collapsed)) {
        for (const [id, b] of nodeBoxes) {
          if (grp.members.includes(id)) continue;
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          const inside = cx >= grp.box.x && cx <= grp.box.x + grp.box.w &&
                         cy >= grp.box.y && cy <= grp.box.y + grp.box.h;
          if (inside) problems.push(`non-member ${id} center (${Math.round(cx)},${Math.round(cy)}) inside group ${grp.id} box — will be absorbed on reconcile`);
        }
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });

    it("group members, FC hosts, and standoff ends resolve", () => {
      for (const sn of g.nodes) {
        const members = sn.init?.members as string[] | undefined;
        if (Array.isArray(members)) {
          for (const m of members) {
            expect(byId.has(m), `group ${sn.id} member ${m} missing`).toBe(true);
          }
        }
        const host = sn.init?.hostNodeId as string | undefined;
        if (typeof host === "string") {
          expect(byId.has(host), `FC ${sn.id} host ${host} missing`).toBe(true);
        }
      }
      for (const s of g.standoffs ?? []) {
        expect(byId.has(s.a.nodeId), `standoff end ${s.a.nodeId} missing`).toBe(true);
        expect(byId.has(s.b.nodeId), `standoff end ${s.b.nodeId} missing`).toBe(true);
        expect(ANCHORS.has(s.a.anchor) && ANCHORS.has(s.b.anchor)).toBe(true);
        expect(s.min).toBeLessThanOrEqual(s.max);
      }
    });

    // Note and Report bodies render with `breaks: true`, so a newline INSIDE a
    // paragraph is a hard <br> — the prose is frozen at whatever column the
    // author's editor wrapped at and cannot reflow to the card, which is what
    // the card's `pretty` wrapping (DESIGN.md §3) is there to do. A blank line
    // between paragraphs and one line per list item / table row are structure
    // and stay. 13 such breaks shipped across three seeds before this ran.
    it("prose bodies have no hard-wrapped lines mid-paragraph", () => {
      const startsBlock = (line: string) =>
        /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|\||```|~~~|!\[\[)/.test(line) || line.startsWith("    ");
      const problems: string[] = [];
      for (const sn of g.nodes) {
        if (!PROSE_TYPES.has(sn.type)) continue;
        const raw = sn.init?.body;
        if (typeof raw !== "string" || !raw.includes("\n")) continue;
        // A Note may open with a frontmatter block; only the RENDERED body below
        // it is prose (the block's lines are data, one field per line).
        const body = sn.type === "NoteNode" ? parseNoteFrontmatter(raw).body : raw;
        const lines = body.split("\n");
        let fenced = false;
        for (let i = 0; i < lines.length - 1; i++) {
          const cur = lines[i], next = lines[i + 1];
          if (/^\s*(```|~~~)/.test(cur)) fenced = !fenced;
          if (fenced) continue;
          // A blank line ends the paragraph; a heading closes its own block; a
          // block marker on the NEXT line means that line is not a continuation.
          if (!cur.trim() || !next.trim()) continue;
          if (/^\s*#{1,6}\s/.test(cur) || startsBlock(next)) continue;
          problems.push(
            `${sn.id} line ${i + 1} wraps mid-paragraph (renders as <br>):\n` +
              `      ...${cur.slice(-56)}\n    + ${next.slice(0, 56)}...`,
          );
        }
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });
  });
}
