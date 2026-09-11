import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards, isSolError, type SolError } from "../../src/graph/errorValue";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { NoteNode } from "../../src/graph/nodes/annotation";
import { ReportNode } from "../../src/graph/nodes/report";
import { isDocumentValue, type DocumentValue } from "../../src/graph/documentValue";

// The Knap render is the ONE async data() in the document family; this pins that
// the real engine + the two Canvas wrappers (coercion, error guard) await it.

function connect(editor: NodeEditor<Schemes>, src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string) {
  return editor.addConnection(new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"]);
}

function makeEditor() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  return { editor, engine };
}

describe("Knap through the engine", () => {
  it("a Report template reads a wired number as data and embeds a wired Note's rendered document", async () => {
    const { editor, engine } = makeEditor();
    const n = new NumberInputNode({ value: 1234.5 });
    const note = new NoteNode({ body: "---\ntitle: Method\n---\n## {{ title }}" });
    const report = new ReportNode({ body: "Total {{ n | number_format:2 }} ({{ n }})\n{{ note }} {{ note | upper }}" });
    for (const x of [n, note, report]) await editor.addNode(x);
    await connect(editor, n, "value", report, "n");
    await connect(editor, note, "document", report, "note");
    const out = await engine.fetch(report.id) as { document: DocumentValue };
    expect(isDocumentValue(out.document)).toBe(true);
    // The bare tags are ref spans (resolved by kind downstream); the Note arrived RENDERED.
    expect(out.document.body).toBe("Total 1,234.50 (`=n`)\n`=note` ---\nTITLE: METHOD\n---\n## METHOD");
    expect(isDocumentValue(out.document.refs.note)).toBe(true);
    expect((out.document.refs.note as DocumentValue).body).toBe("---\ntitle: Method\n---\n## Method");
  });

  it("a broken template lands as a tagged #SYNTAX! on the document output", async () => {
    const { editor, engine } = makeEditor();
    const report = new ReportNode({ body: "{% for x in xs %}" });
    await editor.addNode(report);
    const out = await engine.fetch(report.id) as { document: unknown };
    expect(isSolError(out.document)).toBe(true);
    expect((out.document as SolError).code).toBe("#SYNTAX!");
    expect((out.document as SolError).origin?.nodeId).toBe(report.id);
  });
});
