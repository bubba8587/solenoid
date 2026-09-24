// [[B3]] sameNodeEverywhere
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
    }
  });

  it("vercel.json routes every page path to its file ahead of the catch-all", () => {
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    const catchAll = rewrites.findIndex((r) => r.source === "/(.*)");
    for (const name of Object.keys(SITE_PAGES) as SitePage[]) {
      const page = SITE_PAGES[name];
      for (const source of [page.path, `${page.path}/`]) {
        const i = rewrites.findIndex((r) => r.source === source);
        expect(i, source).toBeGreaterThanOrEqual(0);
        expect(i, source).toBeLessThan(catchAll);
        expect(rewrites[i].destination).toBe(`/${name}.html`);
      }
    }
  });
});
