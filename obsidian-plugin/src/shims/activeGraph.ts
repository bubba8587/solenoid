// [[C107]] obsidianPlugin
// No graph in Obsidian: a value formats by its own type, with no socket annotation to find.
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
