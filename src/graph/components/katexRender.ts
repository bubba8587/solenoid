// KaTeX + its stylesheet, isolated into one dynamic chunk — nothing may import this
// statically; katexLoader.ts pulls it in on first formula render.
import katex, { type KatexOptions } from "katex";
import "katex/dist/katex.min.css";

export function renderTex(latex: string, options?: KatexOptions): string {
  // output: "html" — the default also emits a hidden MathML copy, nearly doubling the
  // DOM node count per formula for no visual difference.
  return katex.renderToString(latex, { output: "html", ...options });
}
