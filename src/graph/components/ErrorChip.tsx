import { ERROR_EXPLANATIONS, type SolError } from "../errorValue";
import { flyToNode } from "../flyToNode";
import "./errorChip.css";

// One shared treatment for tagged #CODE! errors so they read identically wherever
// they surface (result boxes, frame/table cells, the cable inspector, pins/HUD,
// group readouts). CLAUDE.md: "a new result display needs an isSolError branch" —
// route that branch through here so the colour + tooltip can't drift per-site.

/** The hover for an error: the producer's structural message plus the general
 *  plain-language explanation + usual fix for the code, plus (when known) which
 *  node minted it. Single source of truth so every surface shows the same
 *  tooltip (previously most showed message only). */
export function errorTip(err: SolError): string {
  const explain = ERROR_EXPLANATIONS[err.code];
  const tip = err.message ? `${err.message}\n\n${explain}` : explain;
  return err.origin ? `${tip}\n\n…caused by ${err.origin.nodeName}` : tip;
}

/** The shared inline red `#CODE!` badge — used on the wire, in pins/HUD and in
 *  group readouts. Node value boxes keep their own box chrome
 *  (`.solenoid-node__display-value--error`) but draw from the same `--sol-error`
 *  token, so the red is identical everywhere. Clicking the badge flies to the
 *  origin node when one is known (provenance, Tier 1). */
export function ErrorChip({ err, className }: { err: SolError; className?: string }) {
  const origin = err.origin;
  return (
    <span
      className={`sol-error-chip${origin ? " sol-error-chip--clickable" : ""}${className ? ` ${className}` : ""}`}
      title={errorTip(err)}
      onClick={origin ? () => flyToNode(origin.nodeId) : undefined}
    >
      {err.code}
    </span>
  );
}
