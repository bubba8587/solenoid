// [[C107]] obsidianPlugin, [[obsidian-plugin#What's new]]
/** The plugin version and the app's What's New deck a user last saw the tab for. */
export interface SeenWhatsNew {
  plugin: string;
  app: string;
}

export function readSeenWhatsNew(v: unknown): SeenWhatsNew | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { plugin, app } = v as Record<string, unknown>;
  return typeof plugin === "string" && typeof app === "string" ? { plugin, app } : undefined;
}

/** Due on a fresh install, a new plugin version or a new app deck; never on an unchanged start. */
export function whatsNewDue(seen: SeenWhatsNew | undefined, now: SeenWhatsNew): boolean {
  return !seen || seen.plugin !== now.plugin || seen.app !== now.app;
}

/** Dotted numeric versions, compared part by part: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
