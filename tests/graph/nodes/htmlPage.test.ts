// [[C68]] knapIsTheDocumentSyntax, [[reports-and-notes#HTML pages]], [[engineering#Untrusted content]]
import { describe, it, expect, afterEach } from "vitest";
import { HtmlPageNode } from "../../../src/graph/nodes/htmlPage";
import { pageParts, scopeCss, slotsFor, localAssetPath, assetRefs, withAssets, PAGE_SCOPE, SLOT_ATTR } from "../../../src/graph/htmlPageText";
import { setFsProvider, type FsProvider } from "../../../src/graph/fileBridge";
import { settingsStore } from "../../../src/graph/settingsStore";
import { extractInit } from "../../../src/graph/nodeInit";
import type { FrameValue } from "../../../src/graph/frame";

const S = `.${PAGE_SCOPE}`;

describe("an HTML Page's CSS", () => {
  it("scopes every rule to the page, html, body and :root naming the page itself", () => {
    expect(scopeCss("body { margin: 0 }")).toBe(`${S} { margin: 0 }`);
    expect(scopeCss(":root { --ink: #222 }")).toBe(`${S} { --ink: #222 }`);
    expect(scopeCss("html body h1 { font-size: 2em }")).toBe(`${S} h1 { font-size: 2em }`);
    expect(scopeCss("body.dark p { color: white }")).toBe(`${S}.dark p { color: white }`);
    expect(scopeCss("h1, .card p { color: red }")).toBe(`${S} h1, ${S} .card p { color: red }`);
  });

  it("scopes the rules inside @media and leaves @keyframes' frames alone", () => {
    const out = scopeCss("@media (max-width: 600px) { .grid { display: block } } @keyframes rise { from { opacity: 0 } to { opacity: 1 } }");
    expect(out.startsWith("@media (max-width: 600px) {")).toBe(true);
    expect(out).toContain(`${S} .grid { display: block }`);
    expect(out).toContain("@keyframes rise { from { opacity: 0 } to { opacity: 1 } }");
    expect(out).not.toContain(`${S} from`);
  });

  it("follows the app's light or dark for prefers-color-scheme, at no extra specificity", () => {
    const dark = `:where(html[data-theme="dark"]) ${S}`;
    const out = scopeCss(":root { --ink: #222 } @media (prefers-color-scheme: dark) { :root { --ink: #eee } h1 { color: white } }");
    expect(out).toContain(`${S} { --ink: #222 }`);
    expect(out).toContain(`${dark} { --ink: #eee }`);
    expect(out).toContain(`${dark} h1 { color: white }`);
    expect(out).not.toContain("prefers-color-scheme");
    const both = scopeCss("@media (prefers-color-scheme: light) and (max-width: 600px) { p { margin: 0 } }");
    expect(both).toBe(`@media (max-width: 600px) { :where(html[data-theme="light"]) ${S} p { margin: 0 } }`);
  });

  it("keeps nothing that fetches: @import goes, a url() that isn't an inline image is none", () => {
    const out = scopeCss('@import url("https://x.test/a.css"); .hero { background: url(https://x.test/b.png) } .dot { background: url(data:image/png;base64,AA) }');
    expect(out).not.toContain("@import");
    expect(out).not.toContain("x.test");
    expect(out).toContain("background: none");
    expect(out).toContain("url(data:image/png;base64,AA)");
    // Quoted, as the card writes a local file it inlined; a quote mustn't let a fetch past either.
    expect(scopeCss('@font-face { src: url("data:font/woff2;base64,AA") }')).toContain('url("data:font/woff2;base64,AA")');
    expect(scopeCss('.a { background: url("https://x.test/c.png") }')).toContain("background: none");
  });
});

describe("an HTML Page's text", () => {
  it("takes a whole document's body and its style blocks; a fragment is its own body", () => {
    const doc = "<!doctype html><html><head><title>t</title><style>h1 { color: red }</style></head><body class=\"x\"><h1>Hi</h1></body></html>";
    expect(pageParts(doc)).toEqual({ body: "<h1>Hi</h1>", styles: ["h1 { color: red }"] });
    expect(pageParts("<p>{{ a }}</p>")).toEqual({ body: "<p>{{ a }}</p>", styles: [] });
  });

  it("turns a bare tag's span into a slot", () => {
    expect(slotsFor("A `=chart` and `=total!`")).toBe(`A <span ${SLOT_ATTR}="chart"></span> and <span ${SLOT_ATTR}="total" data-sol-hl="1"></span>`);
  });
});

describe("the HTML Page card", () => {
  const ROOT = "/data";
  const FILES: Record<string, string> = {
    "pages/q3.html": "<html><head><style>h1 { color: navy }</style></head><body><h1>{{ title }}</h1><h2>{{ title | upper }}</h2><p>Total {{ total }}</p>"
      + "<ul>{% for r in sales %}<li>{{ r.Region }}: {{ r.Amount }}</li>{% endfor %}</ul>{{ sales }}<p>{{ note }}</p></body></html>",
    "pages/q3.css": ".kpi { padding: 4px }",
  };
  const provider = {
    readTextFile: async (p: string) => {
      const rel = p.slice(ROOT.length + 1);
      if (!(rel in FILES)) throw new Error(`no such file ${rel}`);
      return FILES[rel];
    },
    join: async (...parts: string[]) => parts.join("/"),
  } as unknown as FsProvider;
  afterEach(() => { setFsProvider(null); settingsStore.set("csvFolder", ""); });
  const sales: FrameValue = { __frame: true, columns: [
    { name: "Region", type: "string", values: ["East", "West"] },
    { name: "Amount", type: "number", values: [150, 90] },
  ] } as FrameValue;

  const page = async (inputs: Record<string, unknown[]>, init: ConstructorParameters<typeof HtmlPageNode>[0] = {}) => {
    setFsProvider(provider);
    settingsStore.set("csvFolder", ROOT);
    const node = new HtmlPageNode({ fileName: "pages/q3.html", styleFile: "pages/q3.css", ...init });
    await node.data(inputs);
    await new Promise((r) => setTimeout(r, 0));
    return node;
  };

  it("has an input per variable the page reads, in first-use order", async () => {
    const node = await page({});
    expect(node.refKeys()).toEqual(["title", "total", "sales", "note"]);
    expect(Object.keys(node.inputs)).toEqual(["title", "total", "sales", "note"]);
    expect(node.sideVars).toEqual(["title", "total", "sales", "note"]);
  });

  it("renders the page from its inputs: text escaped, a loop over a Frame's rows, a bare tag a slot", async () => {
    const node = await page({ title: ["Q3 <draft>"], total: [240], sales: [sales] });
    const body = node.render!.body;
    expect(body).toContain(`<h1><span ${SLOT_ATTR}="title"></span></h1>`);
    expect(body).toContain("<h2>Q3 &lt;DRAFT&gt;</h2>");
    expect(body).toMatch(/<li>East: 150<\/li>\s*<li>West: 90<\/li>/);
    expect(body).toContain(`<span ${SLOT_ATTR}="sales"></span>`);
    expect(body).toContain(`<p>Total <span ${SLOT_ATTR}="total"></span></p>`);
    expect(node.refValue("sales")).toBe(sales);
  });

  it("prints a bare tag inside an attribute as text, since no value draws there", async () => {
    FILES["pages/attr.html"] = '<div class="bar" style="width: {{ total }}%" title="{{ title }}">{{ total }}</div>';
    const node = await page({ title: ['A "quoted" <b>'], total: [40] }, { fileName: "pages/attr.html", styleFile: "" });
    expect(node.render!.body).toBe(`<div class="bar" style="width: 40%" title="A &quot;quoted&quot; &lt;b&gt;"><span ${SLOT_ATTR}="total"></span></div>`);
    delete FILES["pages/attr.html"];
  });

  it("leaves an unwired variable's tag as written, so the page shows what it still needs", async () => {
    const node = await page({ title: ["Q3"] });
    expect(node.render!.body).toContain("{{ note }}");
  });

  it("scopes the file's CSS and the page's own style blocks to the page", async () => {
    const node = await page({});
    expect(node.render!.css).toContain(`${S} h1 { color: navy }`);
    expect(node.render!.css).toContain(`${S} .kpi { padding: 4px }`);
  });

  it("names a file it can't read, and keeps its inputs", async () => {
    const node = await page({}, { fileName: "pages/missing.html", sideVars: ["title"] });
    expect(node.render).toBeNull();
    expect(node.error?.code).toBe("#REF!");
    expect(node.error?.message).toContain("pages/missing.html");
    expect(node.refKeys()).toEqual(["title"]);
  });

  it("saves its files and variables and reloads with the same sockets", async () => {
    const node = await page({});
    const init = extractInit(node) as Record<string, unknown>;
    expect(init).toMatchObject({ fileName: "pages/q3.html", styleFile: "pages/q3.css", sideVars: ["title", "total", "sales", "note"] });
    expect(Object.keys(new HtmlPageNode(init as never).inputs)).toEqual(["title", "total", "sales", "note"]);
  });
});

describe("an HTML Page's pictures and fonts", () => {
  it("names a file in the data folder relative to the file that names it, or from its root", () => {
    expect(localAssetPath("img/a.png", "pages")).toBe("pages/img/a.png");
    expect(localAssetPath("../logo.svg", "pages/2026")).toBe("pages/logo.svg");
    expect(localAssetPath("/brand/logo.svg", "pages")).toBe("brand/logo.svg");
    expect(localAssetPath("fonts/A%20B.woff2?v=2", "pages")).toBe("pages/fonts/A B.woff2");
  });

  it("names nothing outside the data folder, at another address, or of a kind that isn't a picture or a font", () => {
    for (const ref of ["../../etc/x.png", "https://x.test/a.png", "data:image/png;base64,AA", "//x.test/a.png", "notes.md", "run.js", "#top"]) {
      expect(localAssetPath(ref, "pages"), ref).toBeNull();
    }
  });

  it("finds them in a src and a CSS url(), and puts each file inline in their place", () => {
    const html = '<img src="img/a.png"><div style="background: url(\'img/b.jpg\')"></div><img src="https://x.test/c.png">';
    expect(assetRefs(html, "pages")).toEqual(["pages/img/a.png", "pages/img/b.jpg"]);
    const out = withAssets(html, "pages", new Map([["pages/img/a.png", "data:image/png;base64,AA"]]));
    expect(out).toContain('src="data:image/png;base64,AA"');
    expect(out).toContain("url('img/b.jpg')");
    expect(out).toContain('src="https://x.test/c.png"');
  });

  it("reads HTML's only from its tags: a src shown as text on the page names nothing", () => {
    const html = '<p>Write <code>&lt;img src="img/a.png"&gt;</code> or url(img/b.png)</p><img src="img/a.png">';
    expect(assetRefs(html, "pages", true)).toEqual(["pages/img/a.png"]);
    const out = withAssets(html, "pages", new Map([["pages/img/a.png", "D"], ["pages/img/b.png", "E"]]), true);
    expect(out).toBe('<p>Write <code>&lt;img src="img/a.png"&gt;</code> or url(img/b.png)</p><img src="D">');
  });

  it("draws them inline on the page, a path from the data too, and names one it can't find", async () => {
    const ROOT = "/data";
    const TEXT: Record<string, string> = {
      "pages/p.html": '<img src="img/logo.svg">{% for r in rows %}<img src="{{ r.Photo }}">{% endfor %}<img src="img/gone.png">',
      "pages/p.css": '@font-face { font-family: X; src: url(fonts/x.woff2) } body { background: url("img/grain.png") }',
    };
    const BIN: Record<string, Uint8Array> = {
      "pages/img/logo.svg": new TextEncoder().encode("<svg/>"),
      "pages/photos/ada.png": new Uint8Array([137, 80, 78, 71]),
      "pages/fonts/x.woff2": new Uint8Array([119, 79, 70, 50]),
      "pages/img/grain.png": new Uint8Array([1, 2, 3]),
    };
    const rel = (p: string) => p.slice(ROOT.length + 1);
    setFsProvider({
      readTextFile: async (p: string) => { if (!(rel(p) in TEXT)) throw new Error("no"); return TEXT[rel(p)]; },
      readBinary: async (p: string) => { if (!(rel(p) in BIN)) throw new Error("no"); return BIN[rel(p)]; },
      join: async (...parts: string[]) => parts.join("/"),
    } as unknown as FsProvider);
    settingsStore.set("csvFolder", ROOT);
    const node = new HtmlPageNode({ fileName: "pages/p.html", styleFile: "pages/p.css" });
    const rows = { __frame: true, columns: [{ name: "Photo", type: "string", values: ["photos/ada.png"] }] };
    await node.data({ rows: [rows] });
    await new Promise((r) => setTimeout(r, 0));
    await node.data({ rows: [rows] });
    const body = node.render!.body;
    expect(body).toContain(`src="data:image/svg+xml;base64,${btoa("<svg/>")}"`);
    expect(body).toContain('src="data:image/png;base64,iVBORw=="');
    expect(body).toContain('src="img/gone.png"');
    expect(node.render!.css).toContain('url("data:font/woff2;base64,');
    expect(node.render!.css).toContain('url("data:image/png;base64,');
    expect(node.missingAssets).toEqual(["pages/img/gone.png isn't in the data folder"]);
    setFsProvider(null);
    settingsStore.set("csvFolder", "");
  });
});
