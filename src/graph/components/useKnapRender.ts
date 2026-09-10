import { useEffect, useState } from "react";
import { hasKnapSyntax, knapErrorText, renderKnap } from "../knapTemplate";

export interface KnapPreview {
  /** The rendered body — the body itself when it carries no template tag. */
  text: string;
  /** `line:column message` lines, "" when the template rendered. */
  errors: string;
}

/** A body's Knap render for a LIVE preview, against the host node's current
 *  variables. Synchronous passthrough for a tag-less body; otherwise the last
 *  render stays up while the next one settles, so the pane never flashes empty.
 *  `version` re-renders on demand (the graph recomputed the variables). */
export function useKnapRender(body: string, variables: Record<string, unknown>, version = 0): KnapPreview {
  const templated = hasKnapSyntax(body);
  const [state, setState] = useState<KnapPreview>({ text: templated ? "" : body, errors: "" });
  useEffect(() => {
    if (!templated) return;
    let live = true;
    void renderKnap(body, variables).then((r) => {
      if (live) setState({ text: r.output, errors: knapErrorText(r.errors) });
    });
    return () => { live = false; };
  }, [body, variables, version, templated]);
  return templated ? state : { text: body, errors: "" };
}
