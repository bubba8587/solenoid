import { describe, it, expect } from "vitest";
import { renderNoteMarkdown } from "../../src/graph/noteMarkdown";
import { marked } from "marked";

describe("renderNoteMarkdown — Obsidian inline forms", () => {
  it("a wikilink renders as a titled span; alias, heading and embed forms", () => {
    expect(renderNoteMarkdown("See [[Deep Work]].")).toContain('<span class="sol-md__wikilink" title="Deep Work">Deep Work</span>');
    expect(renderNoteMarkdown("[[Notes/Deep Work|the book]]")).toContain('title="Notes/Deep Work">the book</span>');
    expect(renderNoteMarkdown("[[Deep Work#Rules]]")).toContain('title="Deep Work#Rules">Deep Work#Rules</span>');
    expect(renderNoteMarkdown("![[Diagram]]")).toContain('class="sol-md__wikilink sol-md__wikilink--embed"');
  });

  it("a tag renders as a chip; it ends at whitespace and punctuation", () => {
    expect(renderNoteMarkdown("#learning #spanish, done")).toBe('<p><span class="sol-md__tag">#learning</span> <span class="sol-md__tag">#spanish</span>, done</p>\n');
    expect(renderNoteMarkdown("nested #area/home-office ok")).toContain('<span class="sol-md__tag">#area/home-office</span> ok');
  });

  it("an error code, a mid-word hash, a bare number and a heading are not tags", () => {
    expect(renderNoteMarkdown("gives #NAME? and #DIV/0! and #N/A")).not.toContain("sol-md__tag");
    expect(renderNoteMarkdown("issue#42 and C#")).not.toContain("sol-md__tag");
    expect(renderNoteMarkdown("rank #1 today")).not.toContain("sol-md__tag");
    expect(renderNoteMarkdown("# Heading\n\ntext")).toContain("<h1>Heading</h1>");
  });

  it("code spans and code blocks keep their text", () => {
    expect(renderNoteMarkdown("`#tag` and `[[x]]`")).toBe("<p><code>#tag</code> and <code>[[x]]</code></p>\n");
    expect(renderNoteMarkdown("```\n#tag [[x]]\n```")).toContain("<code>#tag [[x]]\n</code>");
  });

  it("escapes markup inside a link target or tag", () => {
    expect(renderNoteMarkdown('[[<b>x</b>|"q"]]')).toContain('title="&lt;b&gt;x&lt;/b&gt;">&quot;q&quot;</span>');
  });

  it("leaves the shared marked instance alone: help prose keeps `#NAME?` and [[ ]] as text", () => {
    const html = marked.parse("#NAME? and [[not a link]]", { async: false }) as string;
    expect(html).not.toContain("sol-md__");
  });
});
