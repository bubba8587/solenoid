// [[B3]] sameNodeEverywhere
export const SITE_ORIGIN = "https://solenoid-ngc.vercel.app";

export interface SitePageMeta {
  path: string;
  title: string;
  description: string;
}

export type SitePage = "about" | "obsidian" | "download" | "examples" | "packs";

export const SITE_PAGES: Record<SitePage, SitePageMeta> = {
  about: {
    path: "/about",
    title: "Solenoid · Your workbooks, now in node-graph form",
    description:
      "Build your spreadsheets piece by piece. Each step is a card on a canvas, wired to the next, so a complex calculation stays easy to follow.",
  },
  obsidian: {
    path: "/obsidian",
    title: "Solenoid · The computation layer for your vault",
    description:
      "The Solenoid Properties plugin puts lists, tables, frames and cubes into Obsidian's properties, and the Solenoid app computes over your vault and writes the results back.",
  },
  download: {
    path: "/download",
    title: "Solenoid · Download",
    description: "Free and open source. Runs in the browser, or as a desktop app on Windows and Linux.",
  },
  examples: {
    path: "/examples",
    title: "Solenoid · Examples",
    description: "Every graph here ships in the app. Open one to load it on your canvas and take it apart.",
  },
  packs: {
    path: "/packs",
    title: "Solenoid · Packs",
    description: "Packs add nodes and functions for a domain, from geometry and health to circuits, fluids and chemistry.",
  },
};

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The page's plain-text snapshot (`prerender/<page>.html`) inside #root, for crawlers that don't run JavaScript;
 *  React replaces it on mount. */
export function withPrerender(html: string, snapshot: string): string {
  const root = '<div id="root"></div>';
  if (!html.includes(root)) throw new Error("index.html has no empty #root");
  return html.replace(root, `<div id="root"><style>#root > main a { color: var(--accent, #f5b914); }</style><main style="max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.5">\n${snapshot.trim()}\n</main></div>`);
}

export function pageHtml(indexHtml: string, page: SitePageMeta): string {
  const desc = escapeAttr(page.description);
  const title = escapeAttr(page.title);
  const swaps: [RegExp, string][] = [
    [/(<title>)[^<]*(<\/title>)/, title],
    [/(<meta name="description" content=")[^"]*(")/, desc],
    [/(<meta property="og:title" content=")[^"]*(")/, title],
    [/(<meta property="og:description" content=")[^"]*(")/, desc],
    [/(<meta property="og:url" content=")[^"]*(")/, `${SITE_ORIGIN}${page.path}`],
    [/(<link rel="canonical" href=")[^"]*(")/, `${SITE_ORIGIN}${page.path}`],
  ];
  let out = indexHtml;
  for (const [re, value] of swaps) {
    if (!re.test(out)) throw new Error(`index.html has no tag matching ${re}`);
    out = out.replace(re, (_m, open: string, close: string) => open + value + close);
  }
  return out;
}

/** Every crawlable URL: the app at `/`, then each site page. */
export function sitemapXml(): string {
  const urls = [`${SITE_ORIGIN}/`, ...Object.values(SITE_PAGES).map((p) => `${SITE_ORIGIN}${p.path}`)];
  const body = urls.map((u) => `  <url><loc>${u.replace(/&/g, "&amp;")}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}
