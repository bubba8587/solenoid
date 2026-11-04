// [[B18]] safeToShare: a card copied out of a document someone else made keeps asking wherever it is pasted.
import { describe, it, expect, afterEach } from "vitest";
import type { View } from "../../src/graph/view";
import { GraphEditor } from "../../src/graph/graphEditor";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes, SolenoidNode } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { setSelectNode, setUnselectAllNodes } from "../../src/graph/canvasCommands";
import { copySelected, pasteClipboard } from "../../src/graph/copyPaste";
import { ScriptNode } from "../../src/graph/nodes/script";
import { ImageNode } from "../../src/graph/nodes/annotation";
import { docMetaStore } from "../../src/graph/docMetaStore";
import { foreignCardStore } from "../../src/graph/foreignCardStore";
import { scriptGate, allowScripts } from "../../src/graph/scriptGate";
import { allowNetwork, networkAllowed } from "../../src/graph/connectionStore";
import { savedNodeBody, restoreNodeState } from "../../src/graph/savedNodeBody";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";
import { throughBoundary } from "./boundaryKit";

function canvas() {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const view = {
    position: (id: string) => editor.getNode(id)?.position,
    moveNode: async (id: string, p: { x: number; y: number }) => { const n = editor.getNode(id); if (n) n.position = { ...p }; },
    rerenderNode: async () => {},
    rerenderCables: async () => {},
    nodeElement: () => null,
    hasNode: (id: string) => !!editor.getNode(id),
  } as unknown as View;
  setEditorRefs(editor, engine, view);
  setUnselectAllNodes(() => { for (const n of editor.getNodes()) n.selected = false; });
  setSelectNode((id, acc) => { for (const n of editor.getNodes()) n.selected = n.id === id || (acc && n.selected === true); });
  return editor;
}

/** Copies `src` while the document is foreign, then pastes it into the user's own document. */
async function carry<T extends SolenoidNode>(src: T): Promise<T> {
  const editor = canvas();
  docMetaStore.setDocMeta({ foreign: true });
  await editor.addNode(src);
  src.position = { x: 0, y: 0 };
  src.selected = true;
  copySelected();
  docMetaStore.setDocMeta(null);
  await pasteClipboard(0, 0);
  const pasted = editor.getNodes().find((n) => n.id !== src.id);
  if (!pasted) throw new Error("nothing was pasted");
  return pasted as unknown as T;
}

afterEach(() => { docMetaStore.setDocMeta(null); forgetAllNodes(); });

describe("a card copied out of a foreign document", () => {
  it("a pasted script waits in the user's own document, then runs once allowed", async () => {
    const pasted = await carry(new ScriptNode({ expr: "() => 7" }) as unknown as SolenoidNode) as unknown as ScriptNode;
    throughBoundary(pasted as unknown as Parameters<typeof throughBoundary>[0]);
    expect(docMetaStore.isForeign()).toBe(false);
    expect((await (pasted.data({}) as Promise<{ result: unknown }>)).result).toBe(null);
    expect(scriptGate.waiting(pasted.id)).toBe(true);
    await allowScripts();
    expect((await (pasted.data({}) as Promise<{ result: unknown }>)).result).toBe(7);
    expect(docMetaStore.docMeta()?.scriptsAllowed).toBeUndefined();
  });

  it("a pasted web image is held until the network is allowed, the user's own cards are not", async () => {
    const own = new ImageNode({ url: "https://example.com/own.png" });
    const pasted = await carry(new ImageNode({ url: "https://example.com/a.png" }) as unknown as SolenoidNode) as unknown as ImageNode;
    expect(pasted.data().image?.held).toBe(true);
    expect(own.data().image?.held).toBeUndefined();
    expect(networkAllowed(own.id)).toBe(true);
    allowNetwork();
    expect(pasted.data().image?.held).toBeUndefined();
  });

  it("the mark saves with the card and comes back on load", async () => {
    const pasted = await carry(new ScriptNode({ expr: "() => 7" }) as unknown as SolenoidNode);
    const body = savedNodeBody(pasted as unknown as Parameters<typeof savedNodeBody>[0]);
    expect(body.foreign).toEqual({ scripts: true, network: true });
    restoreNodeState("reloaded", body);
    expect(foreignCardStore.holds("reloaded", "scripts")).toBe(true);
  });

  it("a card from the user's own document pastes unmarked", async () => {
    const editor = canvas();
    const src = new ScriptNode({ expr: "() => 7" }) as unknown as SolenoidNode;
    await editor.addNode(src);
    src.position = { x: 0, y: 0 };
    src.selected = true;
    copySelected();
    await pasteClipboard(0, 0);
    const pasted = editor.getNodes().find((n) => n.id !== src.id)!;
    expect(foreignCardStore.get(pasted.id)).toBeUndefined();
  });
});

describe("an AI rewrite keeps each card's mark", async () => {
  const { keepCardTrust } = await import("../../src/graph/textForm");
  it("matches cards by the text form's names", () => {
    const current = { v: 2, connections: [], nodes: [
      { id: "a", name: "s", type: "ScriptNode", init: {}, x: 0, y: 0, foreign: { scripts: true as const } },
      { id: "b", name: "t", type: "ScriptNode", init: {}, x: 0, y: 0 },
    ] };
    const next = { v: 2, connections: [], nodes: [
      { id: "s", name: "s", type: "ScriptNode", init: { expr: "() => 8" }, x: 0, y: 0 },
      { id: "t", name: "t", type: "ScriptNode", init: {}, x: 0, y: 0 },
    ] };
    const kept = keepCardTrust(current, next);
    expect(kept.nodes[0].foreign).toEqual({ scripts: true });
    expect(kept.nodes[1].foreign).toBeUndefined();
  });
});
