import { describe, it, expect } from "vitest";
import { highlightKnap } from "../../src/graph/knapHighlight";

describe("highlightKnap", () => {
  it("wraps variable and logic tags in spans, escapes the rest, and ends on a newline", () => {
    expect(highlightKnap("a <b> {{ x | join:\"&\" }} {% if y %}z{% endif %}")).toBe(
      'a &lt;b&gt; <span class="knap-tag">{{ x | join:"&amp;" }}</span> <span class="knap-tag knap-tag--logic">{% if y %}</span>z<span class="knap-tag knap-tag--logic">{% endif %}</span>\n',
    );
  });
  it("a tag spanning lines is one span; an unclosed brace is plain text", () => {
    expect(highlightKnap("{{\n a\n}}")).toBe('<span class="knap-tag">{{\n a\n}}</span>\n');
    expect(highlightKnap("{{ open")).toBe("{{ open\n");
  });
});
