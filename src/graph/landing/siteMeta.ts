// [[C8]] declareOnce, [[C2]] realCanvasScenes
export const SITE_ORIGIN = "https://solenoid-ngc.vercel.app";

export interface SitePageMeta {
  path: string;
  title: string;
  description: string;
}

export type SitePage = "obsidian" | "download" | "examples" | "packs";

export const SITE_PAGES: Record<SitePage, SitePageMeta> = {
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

export function pageHtml(indexHtml: string, page: SitePageMeta): string {
  const desc = escapeAttr(page.description);
  const title = escapeAttr(page.title);
  const swaps: [RegExp, string][] = [
    [/(<title>)[^<]*(<\/title>)/, title],
    [/(<meta name="description" content=")[^"]*(")/, desc],
    [/(<meta property="og:title" content=")[^"]*(")/, title],
    [/(<meta property="og:description" content=")[^"]*(")/, desc],
    [/(<meta property="og:url" content=")[^"]*(")/, `${SITE_ORIGIN}${page.path}`],
  ];
  let out = indexHtml;
  for (const [re, value] of swaps) {
    if (!re.test(out)) throw new Error(`index.html has no tag matching ${re}`);
    out = out.replace(re, (_m, open: string, close: string) => open + value + close);
  }
  return out;
}
