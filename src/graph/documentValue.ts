// [[C68]] knapIsTheDocumentSyntax

export type DocumentRefs = Record<string, unknown>;

export interface DocumentPage {
  name: string;
  body: string;
}

export interface DocumentValue {
  __document: true;
  frontmatter?: Record<string, unknown>;
  body: string;
  refs: DocumentRefs;
  sourceId?: string;
  source?: string;
  pages?: DocumentPage[];
  total?: number;
}

export function isDocumentValue(v: unknown): v is DocumentValue {
  return typeof v === "object" && v !== null && (v as { __document?: unknown }).__document === true;
}

export function makeDocument(
  body: string, refs: DocumentRefs = {}, frontmatter?: Record<string, unknown>, sourceId?: string,
  extra?: { source?: string; pages?: DocumentPage[]; total?: number },
): DocumentValue {
  const pageCount = extra?.pages?.length ?? 0;
  return {
    __document: true, body, refs,
    ...(frontmatter ? { frontmatter } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(extra?.source !== undefined ? { source: extra.source } : {}),
    ...(extra?.pages ? { pages: extra.pages } : {}),
    ...(extra?.total !== undefined && extra.total > pageCount ? { total: extra.total } : {}),
  };
}

export const PAGE_SEPARATOR = "\n\n---\n\n";
