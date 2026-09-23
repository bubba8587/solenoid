// [[C68]] knapIsTheDocumentSyntax, [[B1]] obsidianBet
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
    expect(renderNoteMarkdown("read #1984/books")).toContain('<span class="sol-md__tag">#1984/books</span>');
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

  it("==text== is a highlight mark, with inline markup inside", () => {
    expect(renderNoteMarkdown("a ==big *deal*== here")).toBe('<p>a <mark class="sol-md__hl">big <em>deal</em></mark> here</p>\n');
    expect(renderNoteMarkdown("a == b == c")).not.toContain("sol-md__hl"); // spaced equals are not a mark
  });

  it("a `> [!kind] Title` blockquote is a callout: icon, title, body; a plain quote is untouched", () => {
    const html = renderNoteMarkdown("> [!warning] Mind the gap\n> Body line **one**\n> line two\n\n> just a quote");
    expect(html).toContain('<div class="sol-md__callout sol-md__callout--warning">');
    expect(html).toContain('<div class="sol-md__callout-title"><svg class="sol-md__callout-icon"');
    expect(html).toContain("<span>Mind the gap</span></div>");
    expect(html).toContain('<div class="sol-md__callout-body"><p>Body line <strong>one</strong><br>line two</p>');
    expect(html).toContain("<blockquote>\n<p>just a quote</p>\n</blockquote>");
    expect(html).not.toContain("[!warning]");
  });

  it("a callout with no title takes its kind's name; the danger kinds and fold markers", () => {
    expect(renderNoteMarkdown("> [!tip]\n> Do this")).toContain("<span>Tip</span>");
    expect(renderNoteMarkdown("> [!bug]- Flaky\n> text")).toContain('class="sol-md__callout sol-md__callout--bug sol-md__callout--danger"');
    expect(renderNoteMarkdown("> [!custom-kind] Hi")).toContain("sol-md__callout--custom-kind");
  });

  it("%% comments %% and trailing ^block-ids are hidden, except inside a code fence", () => {
    expect(renderNoteMarkdown("keep %% drop this %% this")).toBe("<p>keep  this</p>\n");
    expect(renderNoteMarkdown("a\n%% solenoid:begin x %%\nmanaged\n%% solenoid:end %%\nb")).toBe("<p>a<br>managed<br>b</p>\n");
    expect(renderNoteMarkdown("A line ^abc-123\nnext")).toBe("<p>A line<br>next</p>\n");
    expect(renderNoteMarkdown("```\n%% kept %% ^kept\n```")).toContain("%% kept %% ^kept");
    expect(renderNoteMarkdown("x^2 stays")).toContain("x^2 stays");
  });

  it("math renders through KaTeX once loaded, and shows its source before that", async () => {
    const before = renderNoteMarkdown("Euler: $e^{i\\pi}+1=0$ and\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nafter");
    expect(before).toContain("sol-md__math");
    expect(before).toContain("$e^{i\\pi}+1=0$");
    expect(before).toContain('<div class="sol-md__math-row">');
    expect(renderNoteMarkdown("costs $5 and $10 today")).not.toContain("sol-md__math"); // spaced dollars are money
    expect(renderNoteMarkdown("`$x$`")).toBe("<p><code>$x$</code></p>\n");
    await import("../../src/graph/components/katexRender"); // the chunk the loader pulls
    await new Promise((r) => setTimeout(r, 0));
    const after = renderNoteMarkdown("$e^{i\\pi}+1=0$");
    expect(after).toContain("katex");
    expect(after).not.toContain("sol-md__math--pending");
  });

  it("leaves the shared marked instance alone: help prose keeps `#NAME?` and [[ ]] as text", () => {
    const html = marked.parse("#NAME? and [[not a link]]", { async: false }) as string;
    expect(html).not.toContain("sol-md__");
  });
});
