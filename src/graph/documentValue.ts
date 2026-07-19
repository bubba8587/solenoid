// ─── DocumentValue — a Note/Report's whole renderable content on a cable ──────
// A first-class value carrying everything needed to write a document out (to an
// Obsidian vault, an HTML file, …): its frontmatter, its RAW markdown body (with
// `` `=name` `` refs and `![[Note]]` embeds left intact), and the resolved VALUES of
// those refs. The markdown serialization is deliberately NOT done here — a consumer
// (the Write node's Run handler) walks the body and serializes each ref by kind
// (frame → table, mermaid → code, chart → a rendered image asset), which keeps this
// value lean and defers the DOM-dependent chart render to where it belongs.
//
// A Report has refs but no frontmatter (it's a pure sink for `=name`); a Note has
// frontmatter but no refs (a pure source — its body is literal). The type carries
// both so either producer fits.

/** A resolved embed value keyed by its ref/embed name (a frame, chart, mermaid,
 *  scalar, or — for `![[Note]]` — an embedded note's raw markdown body). */
export type DocumentRefs = Record<string, unknown>;

export interface DocumentValue {
  __document: true;
  /** YAML frontmatter fields (a Note's; a Report has none). */
  frontmatter?: Record<string, unknown>;
  /** The raw markdown body — `` `=name` `` refs and `![[Note]]` embeds NOT yet
   *  substituted; the consumer resolves them against `refs` at serialize time. */
  body: string;
  /** The resolved value of each `` `=name` `` ref in `body` (empty for a Note). */
  refs: DocumentRefs;
  /** The producing node (Report/Note) — lets the Document chip open its source.
   *  Runtime-only (documents are recomputed, never persisted on cables). */
  sourceId?: string;
}

/** Duck-typed brand check — a DocumentValue crosses `document`/`trueany` sockets and
 *  React roots, so it's detected by its brand, not structurally. */
export function isDocumentValue(v: unknown): v is DocumentValue {
  return typeof v === "object" && v !== null && (v as { __document?: unknown }).__document === true;
}

/** Build a DocumentValue (the one place the brand is stamped). */
export function makeDocument(body: string, refs: DocumentRefs = {}, frontmatter?: Record<string, unknown>, sourceId?: string): DocumentValue {
  return { __document: true, body, refs, ...(frontmatter ? { frontmatter } : {}), ...(sourceId ? { sourceId } : {}) };
}
