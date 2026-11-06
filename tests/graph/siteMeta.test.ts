// [[B3]] sameNodeEverywhere
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { SITE_PAGES, SITE_ORIGIN, pageHtml, type SitePage } from "../../src/graph/landing/siteMeta";

const index = readFileSync("index.html", "utf8");

describe("site page HTML", () => {
  it("each page's file carries its own title, description and URL", () => {
    for (const name of Object.keys(SITE_PAGES) as SitePage[]) {
      const page = SITE_PAGES[name];
      const html = pageHtml(index, page);
      expect(html).toContain(`<title>${page.title}</title>`);
      expect(html).toContain(`<meta name="description" content="${page.description}"`);
      expect(html).toContain(`<meta property="og:url" content="${SITE_ORIGIN}${page.path}"`);
      expect(html.match(/<title>/g)).toHaveLength(1);
      expect(html).toContain(`<meta property="og:image" content="${SITE_ORIGIN}${page.image}"`);
      expect(html).toContain(`<meta name="twitter:image" content="${SITE_ORIGIN}${page.image}"`);
      expect(existsSync(`public${page.image}`), page.image).toBe(true);
    }
  });

  it("vercel.json routes every page path to its file ahead of the catch-all", () => {
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    const catchAll = rewrites.findIndex((r) => r.source === "/(.*)");
    for (const name of Object.keys(SITE_PAGES) as SitePage[]) {
      const page = SITE_PAGES[name];
      for (const source of [page.path, `${page.path}/`]) {
        const i = rewrites.findIndex((r) => r.source === source);
        expect(i, source).toBeLessThan(catchAll);
        expect(rewrites[i].destination).toBe(`/${name}.html`);
      }
    }
  });
});

describe("the Script worker's own CSP ([[B18]] safeToShare, [[script-sandbox#The worker]])", () => {
  it("vercel.json serves the worker's file with a CSP that loads nothing and still lets it compile scripts", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { headers?: { source: string; headers: { key: string; value: string }[] }[] };
    const rule = vercel.headers?.find((h) => h.headers.some((x) => x.key === "Content-Security-Policy"));
    expect(rule).toBeDefined();
    // Vite names the worker's chunk after its module, `scriptWorker-<hash>.js`, beside the other assets.
    expect(new RegExp(`^${rule!.source}$`).test("/assets/scriptWorker-VwnzVBUU.js")).toBe(true);
    expect(readFileSync("src/graph/scriptExecutor.ts", "utf8")).toContain('new URL("./scriptWorker.ts", import.meta.url)');
    const csp = rule!.headers.find((x) => x.key === "Content-Security-Policy")!.value;
    expect(csp).toBe("default-src 'none'; script-src 'unsafe-eval'");
  });
});
