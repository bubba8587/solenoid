// [[B3]] sameNodeEverywhere
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { SITE_PAGES, withPrerender } from "../../../src/graph/landing/siteMeta";
import { SEEDS, SEED_GROUPS } from "../../../src/graph/seeds";
import { BUILTIN_PACKS, PACK_GROUP_ORDER } from "../../../src/graph/packs";

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

// What the site pages' text is made from: their own source (the copy), and the seed and pack fields the Examples and
// Packs pages print. A change to any of it without fresh snapshots fails here, so whoever changes site copy regenerates.
function sourceFingerprint(): string {
  const landing = new URL("../../../src/graph/landing/", import.meta.url);
  const files = readdirSync(landing).filter((f) => /\.tsx?$/.test(f)).sort();
  const h = createHash("sha256");
  for (const f of files) h.update(f + "\0" + readFileSync(new URL(f, landing), "utf8").replace(/\r\n/g, "\n"));
  h.update(JSON.stringify(SEED_GROUPS.map((g) => ({ head: g.head, seeds: g.ids.map((id) => SEEDS[id]?.label) }))));
  h.update(JSON.stringify({ order: PACK_GROUP_ORDER, packs: BUILTIN_PACKS.map((p) => [p.id, p.name, p.description, p.group, !!p.defaultActive]) }));
  return h.digest("hex");
}

describe("the snapshots are current", () => {
  const file = new URL("../../../prerender/fingerprint.txt", import.meta.url);
  it("match the site pages' sources; if this fails, run node scripts/prerender-site.mjs and commit prerender/", () => {
    // The script sets this after writing fresh snapshots.
    if (process.env.UPDATE_PRERENDER === "1") writeFileSync(file, sourceFingerprint() + "\n");
    expect(readFileSync(file, "utf8").trim(), "site page sources changed since the last prerender").toBe(sourceFingerprint());
  });
});
