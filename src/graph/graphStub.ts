// Links both ways (bundle 24 item D): the graph stub note `Solenoid/<doc>.md` that a
// Write to Obsidian records itself in, plus the `solenoid:` wikilink value patched onto
// each note it writes. Pure string building; the node does the disk IO. Graph/DOM-free.
import { yamlScalar } from "./obsidianMarkdown";
import { parseNoteFrontmatter, type FrontmatterRow } from "./noteFrontmatter";

export interface StubWrite { node: string; target: string; }

/** A document name → a safe single filename segment. */
export function sanitizeDocName(doc: string): string {
  const s = (doc || "").replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
  return s || "Untitled";
}

/** The stub note's vault-relative path. */
export function stubRelPath(doc: string): string {
  return `Solenoid/${sanitizeDocName(doc)}.md`;
}

/** The `solenoid:` value a written note carries: a wikilink to the stub + the writer. */
export function stubLink(doc: string, node: string): string {
  return `[[Solenoid/${sanitizeDocName(doc)}]] › ${node}`;
}

/** The complete stub note (Solenoid owns it whole, so it's rebuilt, never patched). */
export function buildStub(doc: string, writes: readonly StubWrite[], updated: string): string {
  const fm = [
    "---",
    "type: solenoid",
    writes.length ? `nodes: [${writes.map((w) => yamlScalar(w.node)).join(", ")}]` : "nodes: []",
    "writes:",
    ...writes.map((w) => `  - {node: ${yamlScalar(w.node)}, target: ${yamlScalar(w.target)}}`),
    `updated: ${updated}`,
    "---",
  ].join("\n");
  const body = [
    "",
    `# ${doc}`,
    "",
    `Notes in this vault written by the **${doc}** Solenoid graph:`,
    "",
    ...writes.map((w) => `- **${w.node}** → \`${w.target}\``),
    "",
    writes.length ? `Run headless: \`run-graph "${doc}" --run "${writes[0].node}"\`` : "",
    "",
  ].join("\n");
  return `${fm}\n${body}`;
}

/** Merge one writer's entry into the existing stub (or a fresh one), rebuilt. A later
 *  write from the same node updates its target; a new node is appended. */
export function mergeStub(existing: string | null, doc: string, node: string, target: string, updated: string): string {
  const map = new Map<string, string>();
  if (existing) {
    const w = parseNoteFrontmatter(existing).fields.find((f) => f.key === "writes");
    if (w && Array.isArray(w.value)) {
      for (const row of w.value as FrontmatterRow[]) {
        if (row && typeof row.node === "string") map.set(row.node, typeof row.target === "string" ? row.target : "");
      }
    }
  }
  map.set(node, target);
  return buildStub(doc, [...map].map(([n, t]) => ({ node: n, target: t })), updated);
}
