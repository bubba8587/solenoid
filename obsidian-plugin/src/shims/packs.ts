// [[C107]] obsidianPlugin
// Packs gate node menus and add FC units; nothing a property shows depends on one being active.
import type { PackFormat, PackUnit } from "../../../src/graph/formatAnnotationStore";

export function allPacks(): { id: string; units?: PackUnit[]; formats?: PackFormat[] }[] {
  return [];
}

export const packsStore = {
  isActive: (_id: string): boolean => false,
  subscribe: (_listener: () => void): (() => void) => () => {},
  version: (): number => 0,
};
