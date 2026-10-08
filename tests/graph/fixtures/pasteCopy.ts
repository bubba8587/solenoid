import { NodeEditor, type ClassicPreset } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode } from "../../../src/graph/schemes";
import type { View } from "../../../src/graph/view";
import { setEditorRefs } from "../../../src/graph/process";
import { setSelectNode, setUnselectAllNodes } from "../../../src/graph/canvasCommands";
import { copySelected, pasteClipboard } from "../../../src/graph/copyPaste";

/** The card a copy and paste of `src` puts on a fresh canvas, through the real clipboard path. */
export async function pasteCopy<T extends ClassicPreset.Node>(src: T): Promise<T> {
  const editor = new NodeEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const view = {
    position: (id: string) => editor.getNode(id)?.position,
    moveNode: async (id: string, p: { x: number; y: number }) => { const n = editor.getNode(id); if (n) n.position = { ...p }; },
    rerenderNode: async () => {},
    nodeElement: () => null,
    hasNode: (id: string) => !!editor.getNode(id),
  } as unknown as View;
  setEditorRefs(editor, engine, view);
  setUnselectAllNodes(() => { for (const n of editor.getNodes()) n.selected = false; });
  setSelectNode((id, acc) => { for (const n of editor.getNodes()) n.selected = n.id === id || (acc && n.selected === true); });
  const node = src as unknown as SolenoidNode;
  await editor.addNode(node);
  node.position = { x: 0, y: 0 };
  node.selected = true;
  copySelected();
  await pasteClipboard(0, 0);
  const pasted = editor.getNodes().find((n) => n.id !== src.id);
  if (!pasted) throw new Error("nothing was pasted");
  return pasted as unknown as T;
}
