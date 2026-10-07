// What scripts/site-shots.mjs shoots. A shot opens `graph` (a seed id or a file in this folder), frames the cards
// whose labels match (`frame.labels`, empty for all) and saves a PNG; `out` also copies it into the repo. Cards
// compose shots into the link-preview and README images. Zoom 1.25 throughout: browser zoom, so chrome reads larger.
const Z = 1.25;
const canvas = (name, graph, extra = {}) =>
  ({ name, graph, zoom: Z, crop: "canvas", frame: { labels: [], pad: 32, maxK: 2 }, ...extra });
const editFrame = (view) => [
  { clickText: { sel: "button", text: "Edit Frame" } },
  { clickText: { sel: ".table-popup__view button", text: view } },
];

export const SHOTS = [
  { name: "hero", graph: "solar-payback.json", zoom: Z, frame: { labels: [], pad: 28, clearTop: 40, maxK: 2 }, out: "docs/assets/hero.png" },
  { name: "hero-light", graph: "solar-payback.json", zoom: Z, theme: "light", frame: { labels: [], pad: 28, clearTop: 40, maxK: 2 } },
  { name: "phone", graph: "solar-payback.json", phone: true, size: [390, 844], dpr: 3, frame: { labels: [], k: 0.6, clearTop: 50 } },
  canvas("types", "types.json", { out: "docs/assets/types.png" }),
  canvas("units", "units.json", { out: "docs/assets/units.png" }),
  canvas("formulas", "formulas.json", { out: "docs/assets/formulas.png" }),
  canvas("table-verbs", "table-verbs.json", { out: "docs/assets/table-verbs.png" }),
  canvas("obsidian", "obsidian.json", { settle: 4500, out: "docs/assets/obsidian.png" }),
  canvas("packs", "packs.json", { settle: 3000, crop: "nodes", cropPad: 28 }),
  { name: "form-light", graph: "records.json", zoom: Z, size: [1000, 760], theme: "light", frame: { labels: [], k: 1 }, crop: "popup", steps: editFrame("Form") },
  { name: "cards", graph: "records.json", zoom: Z, size: [1000, 900], frame: { labels: [], k: 1 }, crop: "popup", steps: editFrame("Cards") },
  { name: "report", graph: "report-showcase", zoom: Z, crop: "popup", frame: { labels: ["quarterly review"], k: 1 },
    steps: [{ clickText: { sel: ".solenoid-node:has(.solenoid-array-chip--document) .solenoid-array-chip--document", text: "" } }],
    out: "docs/assets/report.png" },
];

// ── Cards ───────────────────────────────────────────────────────────────────────────────────────────────────────
// DESIGN.md's instrument panel: the canvas void with its dot grid, the gold coil wordmark, Atkinson type, flat.
const INK = "#e8e8e8", DIM = "#9aa0a6", GOLD = "#f5b914", VOID = "#0b0b0b", LINE = "#2d2d2d";
const ground = `background:${VOID} radial-gradient(circle, #2a2a2a 1.2px, transparent 1.4px) 0 0 / 22px 22px;`;
const frame = (src, css = "") =>
  `<img src="${src}" style="display:block;border:1px solid ${LINE};border-radius:10px;${css}">`;
const wordmark = (asset, size = 30) => `<div style="display:flex;align-items:center;gap:${size * 0.4}px">
  <img src="${asset("public/favicon.svg")}" style="width:${size}px;height:${size}px">
  <span style="color:${GOLD};font-weight:800;font-size:${size}px;letter-spacing:0.02em">SOLENOID</span></div>`;
const domain = `<div style="font-family:'Atkinson Hyperlegible Mono Variable',monospace;color:${GOLD};font-size:22px">solenoid-ngc.com</div>`;

/** Text on the left, a picture bleeding off the right edge: every link-preview card shares it. */
const preview = ({ title, sub, art }) => ({ asset, w, h }) => `
  <div style="position:relative;width:${w}px;height:${h}px;${ground}overflow:hidden">
    <div style="position:absolute;left:64px;top:60px;width:440px;display:flex;flex-direction:column;gap:26px">
      ${wordmark(asset)}
      <div style="color:${INK};font-weight:700;font-size:46px;line-height:1.12">${title}</div>
      <div style="color:${DIM};font-size:22px;line-height:1.4">${sub}</div>
    </div>
    <div style="position:absolute;left:64px;bottom:52px">${domain}</div>
    <div style="position:absolute;left:560px;top:60px">${art}</div>
  </div>`;

/** A window-sized close-up of a shot: `scale` is the shot's drawn width, `at` its top-left offset. */
const tile = (src, w, h, scale, [x, y] = [0, 0]) =>
  `<div style="width:${w}px;height:${h}px;border:1px solid ${LINE};border-radius:10px;background:${VOID} url(${src}) ${-x}px ${-y}px / ${scale}px auto no-repeat"></div>`;
const phoneFrame = (src, width) =>
  `<img src="${src}" style="display:block;width:${width}px;border:6px solid #2a2a2a;border-radius:26px;box-shadow:0 18px 40px rgba(0,0,0,0.55)">`;

/** The hero in both themes, split on a diagonal. */
const split = (shot, width) => `<div style="position:relative;width:${width}px">
    ${frame(shot("hero"), `width:${width}px`)}
    <div style="position:absolute;inset:0;clip-path:polygon(62% 0,100% 0,100% 100%,38% 100%)">${frame(shot("hero-light"), `width:${width}px`)}</div>
  </div>`;

export const CARDS = [
  { name: "og-hero", size: [1200, 630], out: "public/og-hero.png",
    html: (ctx) => preview({ title: "Your workbooks, now in node-graph form.", sub: "Build your spreadsheets piece by piece.", art: split(ctx.shot, 900) })(ctx) },
  { name: "og-obsidian", size: [1200, 630], out: "public/og-obsidian.png",
    html: (ctx) => preview({ title: "The computation layer for your vault.", sub: "Read a folder of notes as one table, compute over it, write the results back.", art: frame(ctx.shot("obsidian"), "width:820px") })(ctx) },
  { name: "og-download", size: [1200, 630], out: "public/og-download.png",
    html: (ctx) => preview({ title: "Free and open source.", sub: "Runs in the browser, or as a desktop app on Windows and Linux.",
      art: `<div style="position:relative">${frame(ctx.shot("hero-light"), "width:800px")}<div style="position:absolute;left:-44px;top:96px">${phoneFrame(ctx.shot("phone"), 196)}</div></div>` })(ctx) },
  { name: "og-examples", size: [1200, 630], out: "public/og-examples.png",
    html: (ctx) => preview({ title: "Examples", sub: "Every graph here ships in the app. Open one and take it apart.",
      art: `<div style="display:grid;grid-template-columns:repeat(2,330px);gap:16px">
        ${tile(ctx.shot("table-verbs"), 330, 238, 900, [560, 190])}${tile(ctx.shot("units"), 330, 238, 900, [380, 40])}
        ${tile(ctx.shot("types"), 330, 238, 900, [400, 15])}${tile(ctx.shot("report"), 330, 238, 900, [458, 40])}</div>` })(ctx) },
  { name: "og-packs", size: [1200, 630], out: "public/og-packs.png",
    html: (ctx) => preview({ title: "Packs", sub: "Nodes and functions for a domain, from geometry and health to circuits and chemistry.", art: frame(ctx.shot("packs"), "width:680px") })(ctx) },
  // GitHub's social preview: Settings → General → Social preview takes a 1280×640 upload.
  { name: "social-preview", size: [1280, 640], dpr: 1, out: "docs/assets/social-preview.png",
    html: (ctx) => preview({ title: "Your workbooks, now in node-graph form.", sub: "A node graph calculator. Free and open source.", art: split(ctx.shot, 960) })(ctx) },
  { name: "records", size: [1500, 580], out: "docs/assets/records.png",
    html: ({ shot, w, h }) => `<div style="width:${w}px;height:${h}px;${ground}display:flex;gap:28px;align-items:center;justify-content:center;box-sizing:border-box">
      ${frame(shot("form-light"), "width:700px")}${frame(shot("cards"), "width:700px")}</div>` },
];
