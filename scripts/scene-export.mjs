// Captures the live canvas as a scene for the fast renderers (docs/fast-render.md): every card as a flat display list
// (boxes, text runs, SVG shapes) taken from Chromium's layout at zoom 1, the cables as the app drew them, the camera and
// the grid. Also writes the canvas's DOM and CSS as one HTML page for Blitz, and the app's fonts as TTF for GPUI.
//   node scripts/scene-export.mjs <seed-id | graph.json> [--out dir] [--size 1600x1000] [--shape diagonal]
// Writes <dir>/scene.json, <dir>/canvas.html, <dir>/chromium.png (the app at the scene's camera) and <dir>/fonts/*.ttf (dir defaults to .dev/scenes/<name>). Needs the dev
// server (started if down) and python3 with fontTools + brotli for the fonts (skipped with a warning otherwise).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";
import { expand } from "./shot-graph-expand.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);
const opt = { out: null, size: [1600, 1000], shape: null, src: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opt.out = argv[++i];
  else if (a === "--size") opt.size = argv[++i].split("x").map(Number);
  else if (a === "--shape") opt.shape = argv[++i];
  else opt.src = a;
}
if (!opt.src) {
  console.error("usage: node scripts/scene-export.mjs <seed-id | graph.json> [--out dir] [--size WxH] [--shape spline|diagonal|straight]");
  process.exit(2);
}
const isFile = opt.src.endsWith(".json") && existsSync(opt.src);
const name = isFile ? basename(opt.src, ".json") : opt.src;
const outDir = opt.out ?? join(ROOT, ".dev", "scenes", name);
mkdirSync(join(outDir, "fonts"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

execFileSync(process.execPath, [join(ROOT, "scripts", "dev-up.mjs")], { stdio: "inherit" });
const [W, H] = opt.size;
const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, args: ["--no-sandbox", `--window-size=${W},${H}`] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((shape) => {
    if (shape) localStorage.setItem("solenoid.cableShape", shape);
  }, opt.shape);
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2", timeout: 90_000 });
  await page.waitForSelector(".solenoid-node", { timeout: 60_000 });
  await sleep(1500);
  if (isFile) {
    const graph = expand(JSON.parse(readFileSync(opt.src, "utf8")));
    await page.evaluate(async (g) => {
      const { loadGraph } = await import("/src/graph/persistence.ts");
      await loadGraph(g);
    }, graph);
  } else {
    await page.evaluate(async (id) => {
      const { clearAndLoadSeed } = await import("/src/graph/seeds.ts");
      await clearAndLoadSeed(id);
    }, opt.src);
  }
  await sleep(3500);

  // Zoom 1, the graph's top-left at the viewport's, so every card renders as live DOM at its real size.
  const camera = await page.evaluate(async () => {
    const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
    const st = [...devRfStores][0].getState();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of st.nodeLookup.values()) {
      const p = n.internals.positionAbsolute, w = n.measured?.width ?? 0, h = n.measured?.height ?? 0;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + w); maxY = Math.max(maxY, p.y + h);
    }
    const fit = Math.min(st.width / (maxX - minX + 80), st.height / (maxY - minY + 80), 1);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const fitCam = { x: st.width / 2 - cx * fit, y: st.height / 2 - cy * fit, zoom: fit };
    await st.panZoom.setViewport({ x: 40 - minX, y: 40 - minY, zoom: 1 });
    return fitCam;
  });
  await sleep(2500);

  if (process.env.SCENE_LAYERS) await page.evaluate(() => { globalThis.__keepLayers = true; });
  const scene = await page.evaluate(capture, { camera, W, H });
  scene.name = name;
  writeFileSync(join(outDir, "scene.json"), JSON.stringify(scene));

  const html = await page.evaluate(captureHtml);
  writeFileSync(join(outDir, "canvas.html"), html);

  // Chromium's own picture at the scene's camera, chrome hidden, for comparing a renderer against.
  await page.evaluate(async (cam) => {
    const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
    await [...devRfStores][0].getState().panZoom.setViewport(cam);
  }, camera);
  await page.addStyleTag({ content: ".react-flow__panel, .solenoid-statusbar, .solenoid-menubar, .solenoid-hud-stack, .solenoid-topbar, .solenoid-apptools, .solenoid-nav, .react-flow__minimap { visibility: hidden !important; }" });
  await sleep(1500);
  const pane = await page.$(".react-flow");
  await pane.screenshot({ path: join(outDir, "chromium.png") });

  const items = scene.cards.reduce((n, c) => n + c.items.length, 0);
  console.log(`scene ${name}: ${scene.cards.length} cards, ${items} items, ${scene.cables.length} cables -> ${outDir}`);
  for (const e of errors.slice(0, 5)) console.log("  page:", e.slice(0, 200));
} finally {
  await browser.close();
}
exportFonts(join(outDir, "fonts"));

function exportFonts(dir) {
  const fontRoot = join(ROOT, "node_modules", "@fontsource-variable");
  const want = [];
  for (const fam of readdirSync(fontRoot)) {
    for (const f of readdirSync(join(fontRoot, fam, "files"))) {
      if (f.includes("-latin-wght-")) want.push(join(fontRoot, fam, "files", f));
    }
  }
  // Static instances of each variable font at the weights the app uses, named by family alone: GPUI matches fonts by
  // family name and weight, and a variable font's default instance names itself by its default weight.
  const py = `
import sys, os, re
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
out = sys.argv[1]
for src in sys.argv[2:]:
    base = os.path.basename(src).replace('.woff2', '')
    for w in (400, 500, 600, 700):
        dst = os.path.join(out, f"{base}-{w}.ttf")
        if os.path.exists(dst): continue
        f = TTFont(src)
        f.flavor = None
        if 'fvar' in f:
            f = instancer.instantiateVariableFont(f, {"wght": w}, updateFontNames=False)
        fam = re.sub(r' (Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)$', '', f['name'].getDebugName(1))
        for rec in f['name'].names:
            if rec.nameID in (1, 16):
                rec.string = fam
        f['OS/2'].usWeightClass = w
        f.save(dst)
`;
  try {
    execFileSync("python3", ["-I", "-c", py, dir, ...want], { stdio: "inherit" });
  } catch {
    console.warn("scene-export: fonts not converted (pip install fonttools brotli); renderers fall back to system fonts");
  }
}

// ---- runs in the page ----

async function capture({ camera, W, H }) {
  const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
  const { cableShapeStore } = await import("/src/graph/cableShape.tsx");
  const st = [...devRfStores][0].getState();
  const [tx, ty, k] = st.transform;
  const fonts = [];
  const svgs = [];
  const svgIndex = (src) => {
    let i = svgs.indexOf(src);
    if (i < 0) { svgs.push(src); i = svgs.length - 1; }
    return i;
  };
  const fontIndex = (fam) => {
    const first = fam.split(",")[0].trim().replace(/^["']|["']$/g, "");
    let i = fonts.indexOf(first);
    if (i < 0) { fonts.push(first); i = fonts.length - 1; }
    return i;
  };
  const px = (v) => parseFloat(v) || 0;
  const visibleColor = (c) => c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c);
  // Chromium writes newer color spaces (oklch, color(srgb …)) for color-mix(); a canvas turns any of them into rgb.
  const ctx = document.createElement("canvas").getContext("2d");
  const rgb = (c) => {
    if (!c || c === "none") return "transparent";
    if (/^(rgb|#|color\(srgb )/.test(c) || c === "transparent") return c;
    ctx.fillStyle = "#000"; ctx.fillStyle = c;
    const v = ctx.fillStyle;
    return typeof v === "string" ? v : "transparent";
  };
  const withAlpha = (c, a) => {
    const v = rgb(c);
    if (a >= 0.999) return v;
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${(p[3] ?? 1) * a})`;
    }
    const srgb = v.match(/^color\(srgb ([^)]+)\)$/);
    if (srgb) {
      const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return `color(srgb ${p[0]} ${p[1]} ${p[2]} / ${(p[3] ?? 1) * a})`;
    }
    if (/^#[0-9a-f]{6}$/i.test(v)) return `rgba(${parseInt(v.slice(1, 3), 16)}, ${parseInt(v.slice(3, 5), 16)}, ${parseInt(v.slice(5, 7), 16)}, ${a})`;
    return v;
  };

  const cards = [];
  for (const el of document.querySelectorAll(".react-flow__viewport .react-flow__node")) {
    const id = el.dataset.id;
    const n = st.nodeLookup.get(id);
    if (!n || el.style.visibility === "hidden" || getComputedStyle(el).display === "none") continue;
    const root = el.firstElementChild;
    const er = el.getBoundingClientRect();
    const toCard = (r) => ({ x: (r.left - er.left) / k, y: (r.top - er.top) / k, w: r.width / k, h: r.height / k });
    const rcs = root ? getComputedStyle(root) : null;
    const kind = !root ? "card"
      : root.classList.contains("solenoid-group") ? "group"
      : root.classList.contains("solenoid-node") ? "card"
      : (root.className.split(" ")[0] || "card").replace(/^solenoid-/, "");
    const accent = rgb(rcs?.getPropertyValue("--node-accent").trim() || rcs?.getPropertyValue("--group-color").trim() || "#808080");
    const title = (el.querySelector(".solenoid-node__label-display, .solenoid-group__label")?.textContent ?? "").trim();
    const typeName = (el.querySelector(".solenoid-node__type-hint")?.textContent ?? "").trim();
    const header = el.querySelector(".solenoid-node__header, .solenoid-group__header");
    const items = [];
    const opacityOf = (node) => {
      let o = 1;
      for (let e = node; e && e !== el.parentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
      return o;
    };
    const clipOf = (node) => {
      // The nearest clipping ancestor inside the card, in card coordinates.
      for (let e = node.parentElement; e && e !== el && el.contains(e); e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.overflow !== "visible" || cs.overflowX !== "visible") return toCard(e.getBoundingClientRect());
      }
      return null;
    };
    const outside = (r, clip) => clip && (r.x >= clip.x + clip.w || r.y >= clip.y + clip.h || r.x + r.w <= clip.x || r.y + r.h <= clip.y);

    // CSS paints positioned elements after in-flow ones, and by z-index among themselves; items carry that key so the
    // card's list can be put in paint order (a header's absolutely placed chevron over the header's fill).
    const layers = new Map();
    const layerOf = (node) => {
      let e = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      if (layers.has(e)) return layers.get(e);
      let key = 0;
      for (let a = e; a && a !== root && a !== el; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.position !== "static") {
          const z = parseInt(acs.zIndex);
          key = (Number.isFinite(z) ? z : 0) * 2 + 1;
          break;
        }
      }
      layers.set(e, key);
      return key;
    };
    const push = (node, item) => {
      item.layer = layerOf(node);
      if (!("clip" in item)) item.clip = clipOf(node.nodeType === Node.TEXT_NODE ? node : node);
      items.push(item);
    };
    // One-color SVG icons the CSS draws: a mask over a background color (chevrons, select arrows), on the element or
    // its ::before / ::after, or an SVG background image.
    const icons = (e, br, o) => {
      for (const pseudo of [null, "::before", "::after"]) {
        const pcs = getComputedStyle(e, pseudo);
        if (pseudo && (pcs.content === "none" || pcs.display === "none")) continue;
        const mask = pcs.maskImage && pcs.maskImage !== "none" ? pcs.maskImage : pcs.webkitMaskImage;
        const useMask = mask && mask !== "none" && /svg/.test(mask);
        const img = useMask ? mask : pcs.backgroundImage;
        const m = img && img.match(/url\("?data:image\/svg\+xml(;base64)?,([^")]+)"?\)/);
        if (!m) continue;
        let src;
        try { src = m[1] ? atob(m[2]) : decodeURIComponent(m[2]); } catch { continue; }
        const color = useMask ? pcs.backgroundColor : (src.match(/(?:stroke|fill)=['"](#[0-9a-fA-F]{3,6}|rgb[^'"]+)['"]/)?.[1] ?? pcs.color);
        let w = pseudo ? px(pcs.width) || br.width / k : br.width / k;
        let h = pseudo ? px(pcs.height) || br.height / k : br.height / k;
        const size = (useMask ? (pcs.maskSize || pcs.webkitMaskSize) : pcs.backgroundSize) ?? "";
        const sm = size.match(/^([\d.]+)px(?:\s+([\d.]+)px)?/);
        let iw = sm ? +sm[1] : Math.min(w, h), ih = sm ? +(sm[2] ?? sm[1]) : Math.min(w, h);
        const box = toCard(br);
        let x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
        if (pseudo && pcs.position === "absolute") {
          if (pcs.left !== "auto") x = box.x + px(pcs.left);
          else if (pcs.right !== "auto") x = box.x + box.w - px(pcs.right) - w;
          if (pcs.top !== "auto") y = box.y + px(pcs.top);
          else if (pcs.bottom !== "auto") y = box.y + box.h - px(pcs.bottom) - h;
        }
        const tm = pcs.transform.match(/matrix\(([^,]+),\s*([^,]+)/);
        const rotate = tm ? Math.atan2(+tm[2], +tm[1]) * 180 / Math.PI : 0;
        const rect = { x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih };
        if (!visibleColor(color) || iw <= 0) continue;
        push(e, { t: "icon", rect, svg: svgIndex(src), color: withAlpha(color, o * parseFloat(pcs.opacity)), rotate });
      }
    };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\s+/g, " ");
        if (!text.trim()) continue;
        const parent = node.parentElement;
        const cs = getComputedStyle(parent);
        if (cs.visibility !== "visible" || parent.closest("svg")) continue;
        const o = opacityOf(parent);
        if (o < 0.02) continue;
        const clip = clipOf(node);
        // One item per line box, as Chromium broke the lines, so no renderer wraps text its own way.
        const tt = cs.textTransform;
        const cased = (t) => tt === "uppercase" ? t.toUpperCase() : tt === "lowercase" ? t.toLowerCase()
          : tt === "capitalize" ? t.replace(/\b\p{L}/gu, (m) => m.toUpperCase()) : t;
        for (const line of lineBoxes(node)) {
          line.text = cased(line.text);
          if (cs.textOverflow === "ellipsis" && clip) ellipsize(node, line, clip, er, k);
          const rect = toCard(line.rect);
          if (outside(rect, clip)) continue;
          push(node, {
            t: "text", rect, text: line.text, color: withAlpha(cs.color, o), size: px(cs.fontSize),
            weight: parseInt(cs.fontWeight) || 400, family: fontIndex(cs.fontFamily), italic: cs.fontStyle === "italic",
            align: "left", line_h: rect.h, clip,
          });
        }
        continue;
      }
      const e = node;
      const cs = getComputedStyle(e);
      if (cs.display === "none") { skipChildren(walker, e); continue; }
      if (cs.visibility !== "visible" && e.tagName !== "svg") continue;
      const o = opacityOf(e);
      if (o < 0.02) { skipChildren(walker, e); continue; }
      const br = e.getBoundingClientRect();
      if (br.width === 0 && br.height === 0 && e.tagName !== "svg") continue;
      const rect = toCard(br);
      const clip = clipOf(e);
      if (outside(rect, clip)) { skipChildren(walker, e); continue; }

      if (e instanceof SVGElement) {
        if (e.tagName === "svg") continue;
        if (["defs", "clipPath", "mask", "pattern", "linearGradient", "radialGradient", "title", "g", "text", "tspan"].includes(e.tagName)) {
          if (e.tagName !== "g") skipChildren(walker, e);
          continue;
        }
        const fill = cs.fill.startsWith("url(") ? cs.color : cs.fill;
        const fillOk = fill && fill !== "none" && px(cs.fillOpacity) > 0;
        const strokeOk = cs.stroke && cs.stroke !== "none" && !cs.stroke.startsWith("url(") && px(cs.strokeWidth) > 0;
        if (!fillOk && !strokeOk) continue;
        const ctm = e.getScreenCTM();
        const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
        const fo = o * (cs.fillOpacity === "" ? 1 : px(cs.fillOpacity));
        const so = o * (cs.strokeOpacity === "" ? 1 : px(cs.strokeOpacity));
        const strokeW = strokeOk ? px(cs.strokeWidth) * scale / k : 0;
        if ((e.tagName === "circle" || e.tagName === "ellipse" || e.tagName === "rect") && ctm && Math.abs(ctm.b) < 1e-6) {
          const rx = e.tagName === "rect" ? px(cs.rx) * scale / k : rect.w / 2;
          // Strokes straddle the outline; the box is the outline.
          const r = e.tagName === "rect" ? toCard(e.getBoundingClientRect()) : rect;
          const inset = strokeW / 2;
          push(e, {
            t: "box", rect: e.tagName === "rect" ? r : { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset },
            fill: fillOk ? withAlpha(fill, fo) : "transparent", stroke: strokeOk ? withAlpha(cs.stroke, so) : "transparent",
            stroke_w: strokeW, radius: e.tagName === "rect" ? rx : Math.max(0, rect.w / 2 - inset),
          });
          continue;
        }
        if (typeof e.getTotalLength !== "function" || !ctm) continue;
        let len = 0;
        try { len = e.getTotalLength(); } catch { continue; }
        if (!(len > 0)) continue;
        const n = Math.min(160, Math.max(8, Math.ceil(len * scale / 3)));
        const segs = [];
        const d = e.getAttribute("d") ?? "";
        // A path of several subpaths samples into one polyline with jumps; break at each jump.
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const p = e.getPointAtLength((len * i) / n).matrixTransform(ctm);
          const q = { x: (p.x - er.left) / k, y: (p.y - er.top) / k };
          const jump = prev && Math.hypot(q.x - prev.x, q.y - prev.y) > (len * scale / n) * 2.5 + 1;
          segs.push({ op: i === 0 || jump ? "move" : "line", to: q });
          prev = q;
        }
        if (/[zZ]\s*$/.test(d) || e.tagName === "polygon") segs.push({ op: "line", to: segs[0].to });
        push(e, { t: "path", path: segs, fill: fillOk ? withAlpha(fill, fo) : "transparent", stroke: strokeOk ? withAlpha(cs.stroke, so) : "transparent", stroke_w: strokeW });
        continue;
      }

      if (e.tagName === "CANVAS" || e.tagName === "IMG") {
        try {
          let src = e.tagName === "IMG" ? e.currentSrc : e.toDataURL("image/png");
          if (e.tagName === "IMG" && !src.startsWith("data:")) {
            const c = document.createElement("canvas"); c.width = e.naturalWidth; c.height = e.naturalHeight;
            c.getContext("2d").drawImage(e, 0, 0); src = c.toDataURL("image/png");
          }
          push(e, { t: "image", rect, src });
        } catch { /* a tainted canvas: nothing to draw */ }
        continue;
      }

      const bg = cs.backgroundColor;
      const gradient = cs.backgroundImage !== "none" ? cs.backgroundImage.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i)?.[0] : null;
      const fill = visibleColor(bg) ? bg : gradient;
      const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
      const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
      const sides = bw.map((w, i) => w > 0 && cs[["borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle"][i]] !== "none" && visibleColor(bc[i]));
      const uniform = sides.every(Boolean) && bw.every((w) => w === bw[0]) && bc.every((c) => c === bc[0]);
      const radius = px(cs.borderTopLeftRadius);
      const shadowM = cs.boxShadow !== "none" ? cs.boxShadow.match(/^(rgba?\([^)]+\)|#\w+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/) : null;
      const shadow = shadowM && !/inset/.test(cs.boxShadow) ? { color: withAlpha(shadowM[1], o), dx: +shadowM[2], dy: +shadowM[3], blur: +shadowM[4] } : null;
      if (fill || uniform || shadow) {
        push(e, {
          t: "box", rect, fill: fill ? withAlpha(fill, o) : "transparent",
          stroke: uniform ? withAlpha(bc[0], o) : "transparent", stroke_w: uniform ? bw[0] : 0, radius, shadow,
          dashed: uniform && cs.borderTopStyle === "dashed",
        });
      }
      if (!uniform) {
        // Single sides (a divider, an underline) as thin filled boxes.
        const [t, r, b, l] = bw;
        const boxes = [
          sides[0] && { x: rect.x, y: rect.y, w: rect.w, h: t, c: bc[0] },
          sides[1] && { x: rect.x + rect.w - r, y: rect.y, w: r, h: rect.h, c: bc[1] },
          sides[2] && { x: rect.x, y: rect.y + rect.h - b, w: rect.w, h: b, c: bc[2] },
          sides[3] && { x: rect.x, y: rect.y, w: l, h: rect.h, c: bc[3] },
        ].filter(Boolean);
        for (const s of boxes) push(e, { t: "box", rect: { x: s.x, y: s.y, w: s.w, h: s.h }, fill: withAlpha(s.c, o), stroke: "transparent", stroke_w: 0, radius: 0 });
      }
      icons(e, br, o);
      if (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT") {
        const type = e.getAttribute("type") ?? "";
        if (["checkbox", "radio", "range", "color", "file", "hidden"].includes(type)) continue;
        const value = e.tagName === "SELECT" ? (e.selectedOptions[0]?.textContent ?? "") : e.value;
        const shown = value || e.placeholder || "";
        if (!shown) { if (e.tagName === "SELECT") skipChildren(walker, e); continue; }
        const pl = px(cs.paddingLeft) + bw[3], pr = px(cs.paddingRight) + bw[1];
        const color = value ? cs.color : getComputedStyle(e, "::placeholder").color;
        const fs = px(cs.fontSize);
        const lh = cs.lineHeight === "normal" ? fs * 1.2 : px(cs.lineHeight);
        const multi = e.tagName === "TEXTAREA";
        push(e, {
          t: "text", rect: { x: rect.x + pl, y: multi ? rect.y + px(cs.paddingTop) + bw[0] : rect.y + (rect.h - lh) / 2, w: Math.max(1, rect.w - pl - pr), h: multi ? rect.h - px(cs.paddingTop) - px(cs.paddingBottom) : lh },
          text: shown, color: withAlpha(color, o), size: fs, weight: parseInt(cs.fontWeight) || 400, family: fontIndex(cs.fontFamily),
          italic: cs.fontStyle === "italic", align: cs.textAlign === "right" || cs.textAlign === "end" ? "right" : cs.textAlign === "center" ? "center" : "left", line_h: lh,
        });
        if (e.tagName === "SELECT") skipChildren(walker, e);
      }
    }

    const sockets = [];
    for (const s of el.querySelectorAll("[data-socket-key]")) {
      const h = s.querySelector(".react-flow__handle") ?? s;
      const r = h.getBoundingClientRect();
      const dot = s.querySelector("circle, rect, path");
      const dcs = dot ? getComputedStyle(dot) : null;
      sockets.push({
        key: s.dataset.socketKey, side: s.dataset.socketSide === "output" ? "out" : "in",
        at: { x: (r.left + r.width / 2 - er.left) / k, y: (r.top + r.height / 2 - er.top) / k }, radius: r.width / 2 / k,
        color: rgb(dcs?.fill ?? "#888"), ring: rgb(dot?.nextElementSibling ? getComputedStyle(dot.nextElementSibling).stroke : "transparent"),
        shape: s.dataset.socketShape ?? "circle",
      });
    }
    // A member of a collapsed group stays in the DOM with nothing drawn.
    if (!items.length) continue;
    // Paint order: by layer, stable, so DOM order holds within one.
    items.sort((p, q) => p.layer - q.layer);
    if (!globalThis.__keepLayers) for (const it of items) delete it.layer;
    const p = n.internals.positionAbsolute;
    cards.push({
      id, kind, title, type_name: typeName, accent,
      rect: { x: p.x, y: p.y, w: n.measured?.width ?? er.width / k, h: n.measured?.height ?? er.height / k },
      z: parseInt(el.style.zIndex) || 0, parent: n.parentId ?? null,
      header_h: header ? header.getBoundingClientRect().height / k : 0, items, sockets,
    });
  }

  const cables = [];
  for (const e of st.edges) {
    const g = document.querySelector(`.react-flow__edge[data-id="${CSS.escape(e.id)}"]`);
    const path = g?.querySelector(".react-flow__edge-path");
    if (!path || e.hidden) continue;
    const cs = getComputedStyle(path);
    const d = path.getAttribute("d") ?? "";
    cables.push({
      id: e.id, source: e.source, source_key: e.sourceHandle ?? "", target: e.target, target_key: e.targetHandle ?? "",
      color: rgb(cs.stroke), width: px(cs.strokeWidth) || 1.8, opacity: parseFloat(cs.opacity) * parseFloat(getComputedStyle(g).opacity),
      path: parseD(d),
    });
  }

  const pane = document.querySelector(".react-flow");
  const backing = document.querySelector(".sol-canvas-backing");
  const dot = document.querySelector(".react-flow__viewport pattern circle, pattern circle");
  return {
    version: 1, viewport: { x: st.width, y: st.height }, camera,
    background: rgb(getComputedStyle(backing ?? pane).backgroundColor),
    grid: dot ? { gap: 24, radius: 1, color: rgb(getComputedStyle(dot).fill) } : null,
    cable_shape: cableShapeStore.get(), fonts, cards, cables, svgs,
  };

  function ellipsize(textNode, line, clip, er, k) {
    // Chromium draws "…" where the text meets its box; cut the run at the last character that fits with it.
    const right = er.left + (clip.x + clip.w) * k;
    if (line.rect.right <= right + 0.5) return;
    const range = document.createRange();
    const full = textNode.textContent;
    const room = right - k * 7;
    let cut = 0;
    for (let i = 0; i < full.length; i++) {
      range.setStart(textNode, i);
      range.setEnd(textNode, i + 1);
      const r = range.getClientRects()[0];
      if (r && r.right > room) break;
      cut = i + 1;
    }
    line.text = full.slice(0, cut).replace(/\s+/g, " ").trimEnd() + "…";
    line.rect = new DOMRect(line.rect.left, line.rect.top, right - line.rect.left, line.rect.height);
  }

  function lineBoxes(textNode) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return [];
    const full = textNode.textContent;
    if (rects.length === 1) return [{ rect: rects[0], text: full.replace(/\s+/g, " ").trim() }];
    // Several lines: group characters by the line box they land in.
    const lines = [];
    let cur = null;
    for (let i = 0; i < full.length; i++) {
      range.setStart(textNode, i);
      range.setEnd(textNode, i + 1);
      const r = range.getClientRects()[0];
      if (!r || r.width === 0) { if (cur) cur.text += full[i]; continue; }
      if (!cur || Math.abs(r.top - cur.top) > r.height / 2) {
        cur = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, text: "" };
        lines.push(cur);
      }
      cur.text += full[i];
      cur.left = Math.min(cur.left, r.left); cur.right = Math.max(cur.right, r.right); cur.bottom = Math.max(cur.bottom, r.bottom);
    }
    return lines
      .map((l) => ({ rect: new DOMRect(l.left, l.top, l.right - l.left, l.bottom - l.top), text: l.text.replace(/\s+/g, " ").trim() }))
      .filter((l) => l.text);
  }

  function skipChildren(w, e) {
    // Move the walker past e's subtree: to e's last descendant, so nextNode() leaves it.
    let last = e;
    while (last.lastChild) last = last.lastChild;
    w.currentNode = last;
  }

  function parseD(d) {
    const out = [];
    const re = /([MLCQHVZmlcqhvz])([^MLCQHVZmlcqhvz]*)/g;
    let m, cur = { x: 0, y: 0 }, start = cur;
    while ((m = re.exec(d))) {
      const nums = (m[2].match(/-?[\d.]+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      const pts = []; for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
      const c = m[1].toUpperCase();
      if (c === "M") { cur = pts[0]; start = cur; out.push({ op: "move", to: cur }); for (const p of pts.slice(1)) { out.push({ op: "line", to: p }); cur = p; } }
      else if (c === "L") for (const p of pts) { out.push({ op: "line", to: p }); cur = p; }
      else if (c === "H") { cur = { x: nums[0], y: cur.y }; out.push({ op: "line", to: cur }); }
      else if (c === "V") { cur = { x: cur.x, y: nums[0] }; out.push({ op: "line", to: cur }); }
      else if (c === "Q") for (let i = 0; i + 1 < pts.length; i += 2) { out.push({ op: "quad", c: pts[i], to: pts[i + 1] }); cur = pts[i + 1]; }
      else if (c === "C") for (let i = 0; i + 2 < pts.length; i += 3) { out.push({ op: "cubic", c1: pts[i], c2: pts[i + 1], to: pts[i + 2] }); cur = pts[i + 2]; }
      else if (c === "Z") { out.push({ op: "line", to: start }); cur = start; }
    }
    return out;
  }
}

function captureHtml() {
  // The canvas subtree with its ancestors' tags and classes (selectors depend on them), every stylesheet the page has,
  // and the root's theme attributes, as one static page Blitz can draw.
  const vp = document.querySelector(".react-flow__viewport");
  let inner = vp.outerHTML;
  for (let e = vp.parentElement; e && e !== document.body; e = e.parentElement) {
    const attrs = [...e.attributes].filter((a) => a.name === "class" || a.name === "style" || a.name.startsWith("data-")).map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join("");
    inner = `<${e.tagName.toLowerCase()}${attrs}>${inner}</${e.tagName.toLowerCase()}>`;
  }
  const css = [];
  for (const sheet of document.styleSheets) {
    try { for (const r of sheet.cssRules) css.push(r.cssText); } catch { /* cross-origin */ }
  }
  const htmlAttrs = [...document.documentElement.attributes].map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join("");
  const bodyAttrs = [...document.body.attributes].map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join("");
  const origin = location.origin;
  const style = css.join("\n").replace(/url\("?\/(?!\/)/g, `url("${origin}/`);
  return `<!doctype html><html${htmlAttrs}><head><meta charset="utf-8"><style>${style}</style></head><body${bodyAttrs}>${inner}</body></html>`;
}
