import { ERROR_EXPLANATIONS, type SolError } from "../errorValue";
import { flyToNode } from "../flyToNode";
import "./errorChip.css";

/** Single source of truth so every surface shows the same tooltip. */
export function errorTip(err: SolError): string {
  const explain = ERROR_EXPLANATIONS[err.code];
  const tip = err.message ? `${err.message}\n\n${explain}` : explain;
  return err.origin ? `${tip}\n\n…caused by ${err.origin.nodeName}` : tip;
}

/** The shared inline red `#CODE!` badge; node value boxes keep their own chrome but
 *  draw the same `--sol-error` token, so the red is identical everywhere. */
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
