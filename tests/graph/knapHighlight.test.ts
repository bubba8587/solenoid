import { describe, it, expect } from "vitest";
import { highlightKnap } from "../../src/graph/knapHighlight";

/** The backdrop must carry EVERY source character (plus the trailing newline), or the
 *  transparent textarea over it drifts: strip the spans and compare. */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("highlightKnap", () => {
  it("preserves every character of the source, escaped, plus a trailing newline", () => {
    const src = "# T <b> & {{ x | join:\"&\" }}\n{% if y %}z{% endif %}\n- item\n```\ncode\n```";
    expect(text(highlightKnap(src))).toBe(src + "\n");
  });

  it("tokens inside a tag: delimiters, keywords, filters after a pipe, strings, numbers, variables", () => {
    const html = highlightKnap('{% for r in rows | sort:("Paid", 2) %}{{ r.Name | upper }}{% endfor %}');
    expect(html).toContain('<span class="fx-op">{%</span>');
    expect(html).toContain('<span class="fx-kw">for</span>');
    expect(html).toContain('<span class="fx-var">rows</span>');
    expect(html).toContain('<span class="fx-fn">sort</span>');
    expect(html).toContain('<span class="fx-str">&quot;Paid&quot;</span>'.replace(/&quot;/g, '"'));
    expect(html).toContain('<span class="fx-num">2</span>');
    expect(html).toContain('<span class="fx-fn">upper</span>');
    expect(html).toContain('<span class="fx-kw">endfor</span>');
    // The whole tag sits in one wrapper so it can carry a background.
    expect(html.match(/<span class="knap-tag">/g)?.length).toBe(3);
  });

  it("markdown: heading lines, list markers, quotes, fences, and inline marks", () => {
    const html = highlightKnap("# Title\n- [ ] task **bold** `code` [l](u) ![[e]]\n> quote *em*\n```\n**not** bold\n```");
    expect(html).toContain('<span class="md-heading"># Title</span>');
    expect(html).toContain('<span class="md-list">- [ ] </span>');
    expect(html).toContain('<span class="md-strong">**bold**</span>');
    expect(html).toContain('<span class="md-code">`code`</span>');
    expect(html).toContain('<span class="md-link">[l](u)</span>');
    expect(html).toContain('<span class="md-link">![[e]]</span>');
    expect(html).toContain('<span class="md-quote">&gt; </span>');
    expect(html).toContain('<span class="md-em">*em*</span>');
    expect(html).toContain('<span class="md-code">**not** bold</span>'); // fenced: no inline marks
  });

  it("a tag inside a heading keeps the heading; a tag spanning lines is one tag", () => {
    const html = highlightKnap("# Hi {{ name }}\n{{\n a\n}}");
    expect(html).toContain('<span class="md-heading"># Hi <span class="knap-tag">');
    expect(html.match(/<span class="knap-tag">/g)?.length).toBe(2);
    expect(text(html)).toBe("# Hi {{ name }}\n{{\n a\n}}\n");
  });
});
