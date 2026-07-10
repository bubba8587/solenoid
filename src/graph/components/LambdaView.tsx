// Lambda view-as rendering (the FC's `lambdaView` annotation): how a flowing
// LambdaValue draws in a value box. The value already carries its source
// (`expr`, `params`), so every view derives from the same object — signature
// (the compact default), a KaTeX equation, the highlighted formula, or the
// plain monospace source. Shared by the Lambda node's hero box and the
// Display node; the Report's inline embed has its own KaTeX-first variant
// (inlineRefDisplay's LambdaFormula) that honors the same annotation.
import { useKatexRender } from "./katexLoader";
import { formulaToLatex } from "../excelFormula";
import { highlightFormula } from "../formulaSyntax";
import { formatLambda, type LambdaValue } from "../nodes/lambda";
import type { LambdaView } from "../formatAnnotationStore";
import "./FormulaEditor.css";
import "./LambdaView.css";

/** Plain-text source form: `λ(params) = expr` (signature alone when the body is empty). */
export function lambdaSourceText(v: LambdaValue): string {
  const sig = `λ(${v.params.join(", ")})`;
  const expr = (v.expr ?? "").trim();
  return expr ? `${sig} = ${expr}` : sig;
}

export function LambdaValueView({ value, view }: { value: LambdaValue; view: LambdaView | undefined }) {
  // Unconditional — hook order must not depend on the view.
  const render = useKatexRender();
  const expr = (value.expr ?? "").trim();

  if (view === "katex" && expr && render) {
    const params = value.params.map((p) => p.replace(/[\\{}]/g, "")).join(",\\,");
    let html: string | null = null;
    try {
      html = render(`f(${params}) = ${formulaToLatex(expr)}`, { throwOnError: false, displayMode: true });
    } catch { html = null; /* unparseable body — fall through to the source form */ }
    if (html) {
      return (
        <div
          className="solenoid-node__display-value solenoid-lambda-view solenoid-lambda-view--katex"
          title={lambdaSourceText(value)}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
  }

  if (view === "syntax" && expr) {
    return (
      <div className="solenoid-node__display-value solenoid-lambda-view solenoid-lambda-view--mono fx-tokens">
        {`λ(${value.params.join(", ")}) = `}
        <span dangerouslySetInnerHTML={{ __html: highlightFormula(expr) }} />
      </div>
    );
  }

  if (view === "mono" || view === "syntax" || view === "katex") {
    // Monospace source — also the fallback while KaTeX is still loading, and
    // for an empty/unparseable body.
    return (
      <div className="solenoid-node__display-value solenoid-lambda-view solenoid-lambda-view--mono">
        {lambdaSourceText(value)}
      </div>
    );
  }

  // Default / "signature": the compact λ(params) readout.
  return <div className="solenoid-node__display-value">{formatLambda(value)}</div>;
}
