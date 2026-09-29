import { describe, it, expect, afterEach } from "vitest";
import type { NodeEditor } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { setActiveGraph } from "../../src/graph/activeGraph";
import { NoteNode, ReportNode } from "../../src/graph/rete-nodes";
import { documentSourceNode } from "../../src/graph/documentSource";

function fakeEditor(nodes: { id: string }[]): NodeEditor<Schemes> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { getNode: (id: string) => byId.get(id), getNodes: () => [...byId.values()] } as unknown as NodeEditor<Schemes>;
}

afterEach(() => setActiveGraph(null));

describe("documentSourceNode — a document chip's source, wherever it lives", () => {
  it("finds a Report or Note inside a composite drill-in, not only on the main canvas", () => {
    const report = new ReportNode();
    const note = new NoteNode();
    setEditorRefs(fakeEditor([]), {} as never, {} as never);
    setActiveGraph({ editor: fakeEditor([report, note]), view: {} as never });
    expect(documentSourceNode(report.id)).toBe(report);
    expect(documentSourceNode(note.id)).toBe(note);
  });
  it("anything else, or no id, has no source", () => {
    setEditorRefs(fakeEditor([{ id: "x" }]), {} as never, {} as never);
    expect(documentSourceNode("x")).toBeUndefined();
    expect(documentSourceNode(null)).toBeUndefined();
  });
});
