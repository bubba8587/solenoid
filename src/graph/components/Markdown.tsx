import { marked } from "marked";
import "./Markdown.css";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Render a trusted markdown string (authored in-repo, not user input) as styled
 * HTML. Used by the Reference overlay's Help / Notes tabs.
 */
export function Markdown({ md }: { md: string }) {
  const html = marked.parse(md, { async: false }) as string;
  return <div className="sol-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
