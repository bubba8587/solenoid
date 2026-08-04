import { marked } from "marked";
import "./Markdown.css";

marked.setOptions({ gfm: true, breaks: false });

/** The source must be TRUSTED (authored in-repo), never user input. */
export function Markdown({ md }: { md: string }) {
  const html = marked.parse(md, { async: false }) as string;
  return <div className="sol-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
