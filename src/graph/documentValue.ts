// DocumentValue — a Note/Report's renderable content on a cable. Markdown
// serialization is deliberately NOT done here: the consumer (Write node) resolves
// each ref by kind, deferring the DOM-dependent chart render to where it belongs.

/** A resolved value keyed by its `` `=name` `` ref (a frame, chart, mermaid, scalar,
 *  or a whole DocumentValue — a wired Note embeds through the same refs). */
export type DocumentRefs = Record<string, unknown>;

/** One rendered page of a batch document (a Report with `rows` wired): the note
 *  name the sink writes it under (no extension) and its body. */
export interface DocumentPage {
  name: string;
  body: string;
}

export interface DocumentValue {
  __document: true;
  /** YAML frontmatter fields (a Note's; a Report has none). */
  frontmatter?: Record<string, unknown>;
  /** The rendered markdown body — `` `=name` `` refs NOT yet substituted; the consumer
   *  resolves them against `refs` at serialize time. A batch document's body is its
   *  pages joined by a rule, for a consumer that reads one document. */
  body: string;
  /** The resolved value of each `` `=name` `` ref in `body` (empty for a Note). */
  refs: DocumentRefs;
  /** The producing node (Report/Note) — lets the Document chip open its source.
   *  Runtime-only (documents are recomputed, never persisted on cables). */
  sourceId?: string;
  /** The UN-rendered Knap template the body came from (a Note's raw body), so a
   *  Report wired to it can render the template against its own variables. */
  source?: string;
  /** One page per row when the producing Report had `rows` wired; a sink writes
   *  one note per page. Absent on a single document. */
  pages?: DocumentPage[];
}

/** Brand check — DocumentValues cross React roots, so detect by brand, not structure. */
export function isDocumentValue(v: unknown): v is DocumentValue {
  return typeof v === "object" && v !== null && (v as { __document?: unknown }).__document === true;
}

/** Build a DocumentValue (the one place the brand is stamped). */
export function makeDocument(
  body: string, refs: DocumentRefs = {}, frontmatter?: Record<string, unknown>, sourceId?: string,
  extra?: { source?: string; pages?: DocumentPage[] },
): DocumentValue {
  return {
    __document: true, body, refs,
    ...(frontmatter ? { frontmatter } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(extra?.source !== undefined ? { source: extra.source } : {}),
    ...(extra?.pages ? { pages: extra.pages } : {}),
  };
}

/** The rule a batch document's pages join on, for a one-document consumer. */
export const PAGE_SEPARATOR = "\n\n---\n\n";
