// [[C107]] obsidianPlugin
// Packs gate node menus and add FC units; nothing a property shows depends on one being active.
export function allPacks(): { id: string; units?: []; formats?: [] }[] {
  return [];
}

export const packsStore = {
  isActive: (): boolean => false,
  subscribe: (): (() => void) => () => {},
  version: (): number => 0,
};
