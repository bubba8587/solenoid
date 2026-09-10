import { useEffect, useState } from "react";
import { hasKnapSyntax, knapErrorText, renderKnap, renderKnapPages } from "../knapTemplate";

export interface KnapPreview {
  /** The rendered body — the body itself when it carries no template tag. A batch
   *  preview joins its pages, each under an italic `name.md` line. */
  text: string;
  /** `line:column message` lines, "" when the template rendered. */
  errors: string;
}

export interface KnapBatch {
  records: Record<string, unknown>[];
  pageName: string;
}

/** A body's Knap render for a LIVE preview, against the host node's current
 *  variables. Synchronous passthrough for a tag-less body with no batch; otherwise
 *  the last render stays up while the next one settles, so the pane never flashes
 *  empty. `version` re-renders on demand (the graph recomputed the variables). */
export function useKnapRender(body: string, variables: Record<string, unknown>, version = 0, batch: KnapBatch | null = null): KnapPreview {
  const live = batch !== null || hasKnapSyntax(body);
  const [state, setState] = useState<KnapPreview>({ text: live ? "" : body, errors: "" });
  useEffect(() => {
    if (!live) return;
    let current = true;
    const run = batch
      ? renderKnapPages(body, variables, batch.records, batch.pageName).then((r) => ({
          text: r.pages.map((p) => `*${p.name}.md*\n\n${p.body}`).join("\n\n---\n\n"),
          errors: knapErrorText(r.errors),
        }))
      : renderKnap(body, variables).then((r) => ({ text: r.output, errors: knapErrorText(r.errors) }));
    void run.then((next) => { if (current) setState(next); });
    return () => { current = false; };
  }, [body, variables, version, live, batch]);
  return live ? state : { text: body, errors: "" };
}
