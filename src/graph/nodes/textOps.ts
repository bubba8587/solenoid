// [[C17]] shareImpl
// Must not import `text.ts` (it imports `excelFunctions`; the cycle would drag the graph model into the formula path).
export type TextAfterBeforeOp = "after" | "before";
export type UrlEncodeOp = "encode" | "decode" | "base64" | "unbase64";
export type RegexOp = "test" | "extract" | "extract_all" | "extract_groups" | "replace";

export type SimilarityMethod = "ratio" | "levenshtein" | "damerau" | "jaro_winkler";

export type PadSide = "left" | "right" | "center";

const TEMPLATE_TOKEN = /\{\{|\}\}|\{\s*([A-Za-z_][\w .-]*?|\d+)\s*(?::([^{}]*))?\}/g;

export function templatePlaceholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TEMPLATE_TOKEN)) {
    const name = m[1];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

