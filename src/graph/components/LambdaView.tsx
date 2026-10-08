// [[C118]] formatTravelsWithValue (the lambda view-as: tree/specs/values/format-model.md)
// The Report's inline embed has a separate KaTeX-first variant honoring the same annotation.
import { useKatexRender } from "./katexLoader";
import { lambdaToLatex } from "../excelFormula";
import { highlightFormula } from "../formulaSyntax";
import { formatLambda, type LambdaValue } from "../nodes/lambda";
import type { LambdaView } from "../formatAnnotationStore";
import "./FormulaEditor.css";
import "./LambdaView.css";

export function lambdaSourceText(v: LambdaValue): string {
  const sig = `λ(${v.params.join(", ")})`;
  const expr = (v.expr ?? "").trim();
  return expr ? `${sig} = ${expr}` : sig;
}

export function LambdaValueView({ value, view }: { value: LambdaValue; view: LambdaView | undefined }) {
  // Unconditional: hook order must not depend on the view.
  const render = useKatexRender();
  const expr = (value.expr ?? "").trim();

  if (view === "katex" && expr && render) {
    const latex = lambdaToLatex(value.params, expr);
    let html: string | null = null;
    try {
      html = latex ? render(latex, { throwOnError: false, displayMode: true }) : null;
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
    // Also the fallback while KaTeX loads and for an empty/unparseable body.
    return (
      <div className="solenoid-node__display-value solenoid-lambda-view solenoid-lambda-view--mono">
        {lambdaSourceText(value)}
      </div>
    );
  }

  return <div className="solenoid-node__display-value">{formatLambda(value)}</div>;
}
