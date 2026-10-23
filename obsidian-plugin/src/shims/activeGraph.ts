// [[C107]] obsidianPlugin
import type { GraphEditor } from "../../../src/graph/graphEditor";
import type { Schemes } from "../../../src/graph/schemes";

export function getOwningEditor(_nodeId: string): GraphEditor<Schemes> | null {
  return null;
}

export function getOwningView(_nodeId: string): null {
  return null;
}
