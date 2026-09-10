// Syntax tint for a Knap source pane: the text as HTML with every `{{ … }}` and
// `{% … %}` tag wrapped in a span, the backdrop a transparent textarea sits over.
// Escapes first (braces are not HTML), then marks tags, so the output is safe to
// set as innerHTML.

const TAG_RE = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The pane's backdrop HTML: tags in `.knap-tag` (`.knap-tag--logic` for `{% %}`),
 *  everything else escaped text. Ends with a newline so the backdrop's height
 *  matches the textarea's when the source ends on an empty line. */
export function highlightKnap(source: string): string {
  return escapeHtml(source).replace(TAG_RE, (tag) =>
    `<span class="knap-tag${tag.startsWith("{%") ? " knap-tag--logic" : ""}">${tag}</span>`) + "\n";
}
