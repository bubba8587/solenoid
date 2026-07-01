import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { NoteNode } from "./nodes/annotation";
import { FormatControllerNode } from "./rete-nodes";

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;

// Core-promise guard: a type change at a Note's frontmatter output must propagate
// to a downstream Format Controller so it stops formatting by the stale type — a
// date serial retyped to a plain number must no longer render as a date. This is
// exactly the per-FC work reconcileFcTypes() drives after a retype.
describe("Note frontmatter retype propagates type to a downstream FC", () => {
  it("date → number retype re-adapts the FC and drops the date format", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const note = new NoteNode({ body: "---\nx: 2026-01-01\n---" });
    const fc = new FormatControllerNode(); // wired FC (no docked host)
    await editor.addNode(note as never);
    await editor.addNode(fc as never);
    await editor.addConnection(
      new ClassicPreset.Connection(note as never, "x", fc as never, "in") as never,
    );

    // FC adopts the date type and auto-picks a date format.
    fc.adaptTypeFromConnections(editor as never);
    expect(fc.socketDataType).toBe("date");
    expect(fc.format).toBe("date_dmy");

    // Retype the field: date serial → plain number (value no longer parses as a date).
    note.body = "---\nx: 5\n---";
    const { retyped } = note.syncFields();
    expect(retyped).toEqual([{ key: "x", type: "number" }]);
    expect(note.outputs.x).toBeDefined(); // same key, new socket — cable still references it

    // Re-adapting now sees the NEW upstream type and reverts the date format.
    const changed = fc.adaptTypeFromConnections(editor as never);
    expect(changed).toBe(true);
    expect(fc.socketDataType).toBe("number");
    expect(fc.format).toBe("auto");
  });

  it("resolves through a passthrough (any) node between the Note and the FC", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const note = new NoteNode({ body: "---\nd: 2026-03-01\n---" });
    // A minimal passthrough node: one `any` input, one `any` output (like a Display).
    const anySock = new (class extends ClassicPreset.Socket {})("any");
    const pass = new ClassicPreset.Node("Pass") as ClassicPreset.Node & { data: () => unknown };
    pass.addInput("in", new ClassicPreset.Input(anySock, "In"));
    pass.addOutput("out", new ClassicPreset.Output(anySock, "Out"));
    const fc = new FormatControllerNode();
    await editor.addNode(note as never);
    await editor.addNode(pass as never);
    await editor.addNode(fc as never);
    await editor.addConnection(new ClassicPreset.Connection(note as never, "d", pass as never, "in") as never);
    await editor.addConnection(new ClassicPreset.Connection(pass as never, "out", fc as never, "in") as never);

    fc.adaptTypeFromConnections(editor as never);
    expect(fc.socketDataType).toBe("date"); // resolved through the any passthrough

    note.body = "---\nd: 42\n---";
    note.syncFields();
    fc.adaptTypeFromConnections(editor as never);
    expect(fc.socketDataType).toBe("number");
    expect(fc.format).toBe("auto");
  });
});
