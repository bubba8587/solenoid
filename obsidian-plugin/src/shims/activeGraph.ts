// [[C107]] obsidianPlugin
import type { ClassicPreset, NodeEditor } from "rete";

type Editor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

export function getOwningEditor(_nodeId: string): Editor | null {
  return null;
}

export function getOwningView(_nodeId: string): null {
  return null;
}
