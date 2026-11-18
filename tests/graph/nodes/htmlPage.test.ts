// [[C68]] knapIsTheDocumentSyntax, [[reports-and-notes#HTML pages]], [[engineering#Untrusted content]]
import { describe, it, expect, afterEach } from "vitest";
import { HtmlPageNode } from "../../../src/graph/nodes/htmlPage";
import { pageParts, scopeCss, slotsFor, PAGE_SCOPE, SLOT_ATTR } from "../../../src/graph/htmlPageText";
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

  it("keeps nothing that fetches: @import goes, a url() that isn't an inline image is none", () => {
    const out = scopeCss('@import url("https://x.test/a.css"); .hero { background: url(https://x.test/b.png) } .dot { background: url(data:image/png;base64,AA) }');
    expect(out).not.toContain("@import");
    expect(out).not.toContain("x.test");
    expect(out).toContain("background: none");
    expect(out).toContain("url(data:image/png;base64,AA)");
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
