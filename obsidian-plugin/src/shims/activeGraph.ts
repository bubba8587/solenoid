// [[C107]] obsidianPlugin
import type { GraphEditor } from "../../../src/graph/graphEditor";
import type { Schemes } from "../../../src/graph/schemes";
import type { View } from "../../../src/graph/view";

export function getOwningEditor(_nodeId: string): GraphEditor<Schemes> | null {
  return null;
}

export function getOwningView(_nodeId: string): View | null {
  return null;
}

export function getActiveView(): View | null {
  return null;
}

export function allTopEditors(): GraphEditor<Schemes>[] {
  return [];
}
