// [[C68]] knapIsTheDocumentSyntax
// Nothing may import this statically; katexLoader.ts pulls the chunk in on first formula render.
import katex, { type KatexOptions } from "katex";
import "katex/dist/katex.min.css";

export function renderTex(latex: string, options?: KatexOptions): string {
  // output "html": the default also emits a hidden MathML copy, nearly doubling the DOM per formula.
  return katex.renderToString(latex, { output: "html", ...options });
}
