// [[reports-and-notes#HTML pages]], [[A1]] visualGraphCalculator
// The covers a Contents page shows: each HTML Page in a seed, opened in the running app with the cards of its group, its
// top in the light theme, as pages/images/thumbs/<page>.webp in the demo vault. Run after a page changes; needs the dev
// server (`node scripts/dev-up.mjs`).
//
//   node scripts/page-covers.mjs [seed id, default html-showcase] [page file names to redo, default all]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [seedId = "html-showcase", ...only] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(join(ROOT, "src", "graph", "seedGraphs", `${seedId}.json`), "utf8"));
const OUT = join(ROOT, "demo-vault", "Data", "pages", "images", "thumbs");
const work = mkdtempSync(join(tmpdir(), "page-covers-"));
mkdirSync(OUT, { recursive: true });

const groups = seed.nodes.filter((n) => n.type === "GroupNode");
for (const page of seed.nodes.filter((n) => n.type === "HtmlPageNode" && n.init?.fileName)) {
  const name = basename(page.init.fileName).replace(/\.html?$/i, "");
  if (name === "index" || (only.length && !only.some((o) => name === o.replace(/\.html?$/i, "")))) continue;
  const members = new Set(groups.find((g) => g.init?.members?.includes(page.id))?.init.members ?? [page.id]);
  // The page's own band, its card first so it holds the first Open Page button.
  const graph = {
    nodes: seed.nodes.filter((n) => members.has(n.id)).sort((a, b) => (a.id === page.id ? -1 : b.id === page.id ? 1 : 0)),
    connections: seed.connections.filter((c) => members.has(c.source) && members.has(c.target)),
  };
  const file = join(work, `${name}.json`);
  const shot = join(work, `${name}.png`);
  writeFileSync(file, JSON.stringify(graph));
  execFileSync("node", [join(ROOT, "scripts", "shot-graph.mjs"), file, "--setting", "useDemoVault=true", "--light", "--full",
    "--out", shot, "--wait", "6000",
    "--eval", "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Open Page')).click()",
    "--wait", "4000", "--eval", "document.querySelector('.sol-htmlpage__back').style.display = 'none'", "--wait", "200"],
  { stdio: "ignore" });
  // The middle 1280 of a 1600-wide window, its top 800, at 560×350.
  execFileSync("convert", [shot, "-crop", "1280x800+160+0", "+repage", "-resize", "560x350", "-quality", "72", join(OUT, `${name}.webp`)]);
  console.log(`${name}.webp`);
}
