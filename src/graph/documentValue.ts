// DocumentValue — a Note/Report's renderable content on a cable. Markdown
// serialization is deliberately NOT done here: the consumer (Write node) resolves
// each ref by kind, deferring the DOM-dependent chart render to where it belongs.

/** A resolved value keyed by its `` `=name` `` ref (a frame, chart, mermaid, scalar,
 *  or a whole DocumentValue — a wired Note embeds through the same refs). */
export type DocumentRefs = Record<string, unknown>;

export interface DocumentValue {
  __document: true;
  /** YAML frontmatter fields (a Note's; a Report has none). */
  frontmatter?: Record<string, unknown>;
  /** The raw markdown body — `` `=name` `` refs NOT yet substituted; the consumer
   *  resolves them against `refs` at serialize time. */
  body: string;
  /** The resolved value of each `` `=name` `` ref in `body` (empty for a Note). */
  refs: DocumentRefs;
  /** The producing node (Report/Note) — lets the Document chip open its source.
   *  Runtime-only (documents are recomputed, never persisted on cables). */
  sourceId?: string;
}

/** Brand check — DocumentValues cross React roots, so detect by brand, not structure. */
export function isDocumentValue(v: unknown): v is DocumentValue {
  return typeof v === "object" && v !== null && (v as { __document?: unknown }).__document === true;
}

/** Build a DocumentValue (the one place the brand is stamped). */
export function makeDocument(body: string, refs: DocumentRefs = {}, frontmatter?: Record<string, unknown>, sourceId?: string): DocumentValue {
  return { __document: true, body, refs, ...(frontmatter ? { frontmatter } : {}), ...(sourceId ? { sourceId } : {}) };
}
