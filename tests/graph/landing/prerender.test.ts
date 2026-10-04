// [[B3]] sameNodeEverywhere
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SITE_PAGES, withPrerender } from "../../../src/graph/landing/siteMeta";

const snapshot = (name: string) => readFileSync(new URL(`../../../prerender/${name}.html`, import.meta.url), "utf8");

describe("site page text snapshots (scripts/prerender-site.mjs)", () => {
  it("every site page has one, with its heading, so a new page can't ship blank to crawlers", () => {
    for (const name of Object.keys(SITE_PAGES)) expect(snapshot(name), name).toMatch(/<h1>[^<]+<\/h1>/);
  });

  it("goes inside the empty #root and nowhere else", () => {
    const html = withPrerender('<body><div id="root"></div></body>', "<h1>Hi</h1>");
    expect(html).toContain('<div id="root"><style>');
    expect(html).toContain("<h1>Hi</h1>\n</main></div></body>");
    expect(() => withPrerender("<body></body>", "<h1>Hi</h1>")).toThrow();
  });
});
