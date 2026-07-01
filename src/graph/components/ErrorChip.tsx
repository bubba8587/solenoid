import { ERROR_EXPLANATIONS, type SolError } from "../errorValue";
import "./errorChip.css";

// One shared treatment for tagged #CODE! errors so they read identically wherever
// they surface (result boxes, frame/table cells, the cable inspector, pins/HUD,
// group readouts). CLAUDE.md: "a new result display needs an isSolError branch" —
// route that branch through here so the colour + tooltip can't drift per-site.

/** The hover for an error: the producer's structural message plus the general
 *  plain-language explanation + usual fix for the code. Single source of truth so
 *  every surface shows the same tooltip (previously most showed message only). */
export function errorTip(err: SolError): string {
  const explain = ERROR_EXPLANATIONS[err.code];
  return err.message ? `${err.message}\n\n${explain}` : explain;
}

/** The shared inline red `#CODE!` badge — used on the wire, in pins/HUD and in
 *  group readouts. Node value boxes keep their own box chrome
 *  (`.solenoid-node__display-value--error`) but draw from the same `--sol-error`
 *  token, so the red is identical everywhere. */
export function ErrorChip({ err, className }: { err: SolError; className?: string }) {
  return (
    <span className={`sol-error-chip${className ? ` ${className}` : ""}`} title={errorTip(err)}>
      {err.code}
    </span>
  );
}
