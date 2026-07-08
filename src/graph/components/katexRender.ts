// KaTeX + its stylesheet, isolated so they land in one dynamically-imported chunk
// (~250 kB + CSS). Nothing imports this statically — katexLoader.ts pulls it in on
// first formula render. Mirrors chartRender.tsx's role for recharts.
import katex, { type KatexOptions } from "katex";
import "katex/dist/katex.min.css";

export function renderTex(latex: string, options?: KatexOptions): string {
  // output: "html" — the default (htmlAndMathml) emits a hidden MathML copy of the
  // whole formula alongside the visible HTML tree, nearly doubling each formula's
  // DOM node count for no visual difference. Canvas cards render dozens of formulas.
  return katex.renderToString(latex, { output: "html", ...options });
}
