// [[C25]]
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import * as Nodes from "../../src/graph/nodeClasses";
import type { Schemes } from "../../src/graph/schemes";
import { isDocumentValue, type DocumentValue } from "../../src/graph/documentValue";
import type { ReportNode } from "../../src/graph/nodes/report";
import seed from "../fixtures/mail-merge.json"; // the retired seed, kept as the Report mail-merge fixture (2026-09-16)

// The Mail Merge seed is the worked example of the Report's two fixed inputs: a
// template NOTE wired into Template (its tags the inputs, its frontmatter the
// defaults) and a ledger wired into Rows (one page per row, named by the page
// name), the whole batch feeding Write to Obsidian.

type SavedNode = { id: string; type: string; init?: Record<string, unknown>; literals?: Record<string, number>; stringLiterals?: Record<string, string> };

function build() {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  return { editor, engine };
}

describe("Mail Merge seed", () => {
  it("merges one page per traveler from the template note, defaults from its frontmatter", async () => {
    const { editor, engine } = build();
    const byId = new Map<string, GraphNode>();
    for (const sn of (seed.nodes as SavedNode[])) {
      const Ctor = (Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => GraphNode>)[sn.type];
      const node = new Ctor({ ...sn.init });
      const anyN = node as unknown as Record<string, unknown>;
      if (sn.literals) anyN.literals = { ...sn.literals };
      if (sn.stringLiterals) anyN.stringLiterals = { ...sn.stringLiterals };
      byId.set(sn.id, node);
      await editor.addNode(node as Schemes["Node"]);
    }
    for (const c of seed.connections) {
      await editor.addConnection(new GraphConnection(byId.get(c.source)!, c.sourceOutput, byId.get(c.target)!, c.targetInput) as Schemes["Connection"]);
    }
    const report = byId.get("report") as unknown as ReportNode;
    const out = await engine.fetch(report.id) as { document: DocumentValue };

    // The template's variables ARE the sockets; the seed's sideVars match them.
    expect(report.refKeys()).toEqual(["subject", "total", "share", "treasurer"]);
    expect((seed.nodes.find((n) => n.id === "report")!.init as { sideVars: string[] }).sideVars).toEqual(report.sideVars);
    // Wired: total 240 over 4 travelers → share 60. Unwired: the note's own frontmatter.
    expect(report.refValue("total")).toBe(240);
    expect(report.refValue("share")).toBe(60);
    expect(report.refValue("subject")).toBe("Trip settle-up");
    expect(report.refValue("treasurer")).toBe("Ada");

    expect(isDocumentValue(out.document)).toBe(true);
    const pages = out.document.pages!;
    expect(pages.map((p) => p.name)).toEqual(["Settle-up Ada", "Settle-up Bob", "Settle-up Cy", "Settle-up Dee"]);
    // Ada paid 120 > 60: owed. Cy paid 0: pays. Each page keeps the frontmatter block.
    expect(pages[0].body).toContain("# `=subject`: Ada");
    expect(pages[0].body).toContain("You paid more than your share; `=treasurer` will send the difference back.");
    expect(pages[2].body).toContain("Please send **60.00** less what you paid to `=treasurer`.");
    expect(pages[3].body).toContain("*Letter 4 of 4, generated from the ledger.*");
    // Knap's shaping filters over the records: sorted roll, filtered stragglers.
    expect(pages[0].body).toContain("Paid so far, most first: Ada, Dee, Bob, Cy.");
    expect(pages[0].body).toContain("Still to chip in: Cy.");
    expect(pages[0].body.startsWith("---\nsubject: Trip settle-up\ntreasurer: Ada\n---\n")).toBe(true);
    // The sink sees the batch.
    const write = byId.get("write") as unknown as { cachedDoc: DocumentValue | null };
    await engine.fetch((write as unknown as { id: string }).id);
    expect(write.cachedDoc?.pages?.length).toBe(4);
  });
});
