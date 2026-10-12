// [[C121]]
// Reads a graph off the live app as a vector scene for the motion engine (engine.py): every card's boxes,
// borders, SVG shapes (frames, sockets, icons, CSS-mask icons), slider parts and glyphs, in flow px, in paint
// order, each tagged with the element that drew it, so a clip can take a card apart and build it back up from
// the app's own geometry, colors and type. Cables come as their real paths and strokes, the canvas as its
// colors and dot spacing, and a reference shot of the graph at zoom 1 lets verify.py flag an engine build
// that strays from the app. One load per state: a state overrides node init/literals, so a value that
// changes on camera is laid out by the app, not faked.
//   node scripts/motion/capture.mjs <scene.json> [--out dir]
// scene.json: { graph: <shot-graph short form with x/y>, states?: [{ name, set: { <nodeId>: { init?, literals?, frame? } } }],
//               sweep?: { node, init: <field>, from, to, step } or { node, init, values: [...] } }
// A sweep is one state per value, named s0, s1, …; `values` takes any list (each prefix of a formula, say).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { browserPath } from "../browser.mjs";
import { expand } from "../shot-graph-expand.mjs";

const argv = process.argv.slice(2);
const sceneFile = argv.find((a) => !a.startsWith("--"));
const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : join(".dev", "motion", "capture");
if (!sceneFile) { console.error("usage: node scripts/motion/capture.mjs <scene.json> [--out dir]"); process.exit(2); }
const scene = JSON.parse(readFileSync(sceneFile, "utf8"));
const REF_SCALE = 3;
const W = 1600, H = 1000;

execFileSync(process.execPath, [fileURLToPath(new URL("../dev-up.mjs", import.meta.url))], { stdio: "inherit" });
mkdirSync(out, { recursive: true });

const withState = (state) => {
  const g = structuredClone(scene.graph);
  for (const [id, over] of Object.entries(state?.set ?? {})) {
    const n = g.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`state ${state.name}: no node ${id}`);
    if (over.init) n.init = { ...n.init, ...over.init };
    if (over.literals) n.literals = { ...n.literals, ...over.literals };
    if (over.frame) n.frame = over.frame;
  }
  return expand(g);
};

const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, args: ["--no-sandbox", `--window-size=${W},${H}`, "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: REF_SCALE });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" || m.text().startsWith("[motion]")) console.log(m.text()); });

const load = async (graph) => {
  const doc = { id: "motion", name: "Motion", graph, updatedAt: Date.now() };
  await page.goto("http://localhost:1420/#blank", { waitUntil: "domcontentloaded" });
  await page.evaluate((doc) => {
    localStorage.clear();
    localStorage.setItem("solenoid.docs.index.a", JSON.stringify({ seq: 1, currentId: doc.id, docs: [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }] }));
    localStorage.setItem(`solenoid.docs.doc.${doc.id}.a`, JSON.stringify({ seq: 2, doc }));
  }, doc);
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2", timeout: 90_000 });
  await page.waitForSelector(".solenoid-node", { timeout: 30_000 });
  await page.mouse.move(1, H - 1);
  // Zoom 1, the graph centered: one flow px is one CSS px, so every measurement below is in flow px.
  await page.evaluate(async () => {
    const v = (await import("/src/graph/process.ts")).getView();
    const r0 = v.container.getBoundingClientRect(), { x: tx, y: ty, k } = v.transform;
    const fl = [...document.querySelectorAll(".react-flow__node")].map((el) => { const r = el.getBoundingClientRect(); return { x: (r.left - r0.left - tx) / k, y: (r.top - r0.top - ty) / k, w: r.width / k, h: r.height / k }; });
    const x0 = Math.min(...fl.map((b) => b.x)), y0 = Math.min(...fl.map((b) => b.y));
    const x1 = Math.max(...fl.map((b) => b.x + b.w)), y1 = Math.max(...fl.map((b) => b.y + b.h));
    v.transform.k = 1;
    v.pan(Math.round(v.container.clientWidth / 2 - (x0 + x1) / 2), Math.round(v.container.clientHeight / 2 - (y0 + y1) / 2));
  });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1500));
};

// The page-side reader. Everything it returns is in flow px; colors are [r, g, b, a] with r, g, b in 0..255.
const read = () => page.evaluate(async () => {
  const v = (await import("/src/graph/process.ts")).getView();
  const r0 = v.container.getBoundingClientRect();
  const { x: tx, y: ty, k } = v.transform;
  const fx = (x) => (x - r0.left - tx) / k, fy = (y) => (y - r0.top - ty) / k;
  const rect = (r) => ({ x: fx(r.left), y: fy(r.top), w: r.width / k, h: r.height / k });

  // Any CSS color (rgb(), color(srgb …), a var chain) → [r, g, b, a], resolved through a probe element.
  const probe = document.createElement("div");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const ctx2d = document.createElement("canvas").getContext("2d");
  const parse = (css) => {
    let m = /^rgba?\(([^)]+)\)/.exec(css);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = /^color\(srgb ([^)]+)\)/.exec(css);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return null;
  };
  const color = (css, el) => {
    if (!css || css === "none" || css === "transparent") return null;
    const direct = parse(css);
    if (direct) return direct;
    (el && !["INPUT", "TEXTAREA", "SELECT", "IMG"].includes(el.tagName) ? el : el?.parentElement ?? document.body).appendChild(probe);
    probe.style.color = css;
    const c = getComputedStyle(probe).color;
    document.body.appendChild(probe);
    return parse(c);
  };
  const alphaOf = (el, stop) => { let a = 1; for (let e = el; e && e !== stop.parentElement; e = e.parentElement) a *= Number(getComputedStyle(e).opacity); return a; };

  // SVG geometry in flow px: subpaths as point lists (closed or open), through each element's screen CTM.
  const toFlow = (m, x, y) => [fx(m.a * x + m.c * y + m.e), fy(m.b * x + m.d * y + m.f)];
  const roundRect = (x, y, w, h, rx, ry, n = 6) => {
    rx = Math.min(rx, w / 2); ry = Math.min(ry || rx, h / 2);
    if (rx <= 0 || ry <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const pts = [];
    const arc = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (Math.PI / 2) * (i / n); pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } };
    arc(x + w - rx, y + ry, -Math.PI / 2); arc(x + w - rx, y + h - ry, 0); arc(x + rx, y + h - ry, Math.PI / 2); arc(x + rx, y + ry, Math.PI);
    return pts;
  };
  const NS = "http://www.w3.org/2000/svg";
  const shapeOf = (g) => {
    const tag = g.tagName.toLowerCase(), cs = getComputedStyle(g);
    const num = (prop, attr) => { const v = parseFloat(cs[prop]); return Number.isFinite(v) ? v : parseFloat(g.getAttribute(attr) ?? "0") || 0; };
    if (tag === "rect") {
      const bb = g.getBBox();
      const rx = parseFloat(cs.rx) || parseFloat(g.getAttribute("rx")) || 0, ry = parseFloat(cs.ry) || parseFloat(g.getAttribute("ry")) || rx;
      return [{ pts: roundRect(bb.x, bb.y, bb.width, bb.height, rx, ry), closed: true }];
    }
    if (tag === "circle" || tag === "ellipse") {
      const cx = num("cx", "cx"), cy = num("cy", "cy");
      const rx = tag === "circle" ? num("r", "r") : num("rx", "rx"), ry = tag === "circle" ? rx : num("ry", "ry");
      return [{ pts: Array.from({ length: 64 }, (_, i) => [cx + rx * Math.cos((i / 64) * 2 * Math.PI), cy + ry * Math.sin((i / 64) * 2 * Math.PI)]), closed: true }];
    }
    if (tag === "line") return [{ pts: [[+g.getAttribute("x1"), +g.getAttribute("y1")], [+g.getAttribute("x2"), +g.getAttribute("y2")]], closed: false }];
    if (tag === "polygon" || tag === "polyline") {
      const n = (g.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      return [{ pts, closed: tag === "polygon" }];
    }
    if (tag === "path") {
      // One subpath per moveto, each sampled on its own temp path so sampling never bridges a jump.
      const d = g.getAttribute("d") ?? "";
      const tmp = document.createElementNS(NS, "path");
      g.ownerSVGElement.appendChild(tmp);
      const subs = [];
      const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
      let pen = [0, 0], start = [0, 0], piece = null, m;
      const end = (dd) => { tmp.setAttribute("d", dd); const L = tmp.getTotalLength(); const p = tmp.getPointAtLength(L); return [p.x, p.y]; };
      const flush = () => {
        if (!piece) return;
        tmp.setAttribute("d", piece.d);
        const len = tmp.getTotalLength();
        const steps = Math.max(2, Math.ceil(len / 0.2));
        subs.push({ pts: Array.from({ length: steps + 1 }, (_, i) => { const p = tmp.getPointAtLength((len * i) / steps); return [p.x, p.y]; }), closed: piece.closed });
        piece = null;
      };
      while ((m = re.exec(d))) {
        const [, c, args] = m;
        const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) ?? []).map(Number);
        if (c === "M" || c === "m") {
          flush();
          const x = c === "M" ? n[0] : pen[0] + n[0], y = c === "M" ? n[1] : pen[1] + n[1];
          start = [x, y];
          let dd = `M${x} ${y}`;
          for (let i = 2; i + 1 < n.length; i += 2) dd += `${c === "M" ? "L" : "l"}${n[i]} ${n[i + 1]}`;
          piece = { d: dd, closed: false };
          pen = end(dd);
          continue;
        }
        if (!piece) piece = { d: `M${pen[0]} ${pen[1]}`, closed: false };
        piece.d += c + args;
        if (c === "Z" || c === "z") { piece.closed = true; pen = [...start]; } else pen = end(piece.d);
      }
      flush();
      tmp.remove();
      return subs;
    }
    return [];
  };
  const svgPrims = (svg, card, opts = {}) => {
    const prims = [];
    for (const g of svg.querySelectorAll("rect, circle, ellipse, line, polyline, polygon, path")) {
      if (g.closest("defs, clipPath, mask")) continue;
      const cs = getComputedStyle(g);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const m = g.getScreenCTM();
      const subs = shapeOf(g).map((s) => ({ ...s, pts: s.pts.map(([x, y]) => toFlow(m, x, y)) })).filter((s) => s.pts.length > 1);
      if (!subs.length) continue;
      const scale = Math.hypot(m.a, m.b) / k;
      const a = alphaOf(g, card) * (opts.alpha ?? 1);
      // a clip-path on an ancestor <g>: the clip's first shape, in the same space
      let clip = null;
      const cg = g.closest("[clip-path]");
      const cid = cg && /url\(#([^)]+)\)/.exec(cg.getAttribute("clip-path"))?.[1];
      const cel = cid && svg.querySelector(`[id="${CSS.escape(cid)}"] > *`);
      if (cel) clip = shapeOf(cel).map((s) => s.pts.map(([x, y]) => toFlow(cel.getScreenCTM(), x, y)))[0];
      // an <svg> that hides its overflow clips everything in it to its own box
      if (!clip && getComputedStyle(svg).overflow !== "visible") {
        const sr = rect(svg.getBoundingClientRect());
        clip = [[sr.x, sr.y], [sr.x + sr.w, sr.y], [sr.x + sr.w, sr.y + sr.h], [sr.x, sr.y + sr.h]];
      }
      const fill = color(cs.fill, g);
      const stroke = color(cs.stroke, g);
      const fo = Number(cs.fillOpacity), so = Number(cs.strokeOpacity);
      if (fill && fill[3] * fo > 0) prims.push({ kind: "fill", subs, rule: cs.fillRule, color: [...fill.slice(0, 3), fill[3] * fo * a], clip });
      if (stroke && stroke[3] * so > 0 && parseFloat(cs.strokeWidth) > 0) {
        prims.push({ kind: "stroke", subs, width: parseFloat(cs.strokeWidth) * scale, cap: cs.strokeLinecap, join: cs.strokeLinejoin, miter: Number(cs.strokeMiterlimit), color: [...stroke.slice(0, 3), stroke[3] * so * a], clip });
      }
    }
    return prims;
  };

  // A CSS mask icon (a ::before painted with background-color through an SVG data URL): mount the SVG as a
  // real element over the pseudo-element's box, read its coverage, paint it the pseudo-element's color.
  const maskPrims = (el, card) => {
    const ps = getComputedStyle(el, "::before");
    if (ps.content === "none" || !/url\(/.test(ps.maskImage)) return [];
    const src = decodeURIComponent(/url\("?data:image\/svg\+xml(?:;utf8)?,([^"]*)"?\)/.exec(ps.maskImage)?.[1] ?? "");
    if (!src) return [];
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const w = parseFloat(ps.width), h = parseFloat(ps.height);
    const bl = parseFloat(cs.borderLeftWidth), bt = parseFloat(cs.borderTopWidth);
    const cw = r.width - bl - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ch = r.height - bt - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const flex = cs.display.includes("flex") || cs.display.includes("grid");
    const left = r.left + bl + parseFloat(cs.paddingLeft) + (flex && /center/.test(cs.justifyContent) ? (cw - w) / 2 : 0);
    const top = r.top + bt + parseFloat(cs.paddingTop) + (flex && /center/.test(cs.alignItems) ? (ch - h) / 2 : 0);
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${w}px;height:${h}px;pointer-events:none;margin:0;padding:0;transform:${ps.transform};transform-origin:${ps.transformOrigin}`;
    host.innerHTML = src;
    const svg = host.querySelector("svg");
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    svg.style.display = "block";
    document.body.appendChild(host);
    const paint = color(ps.backgroundColor, el);
    const prims = svgPrims(svg, card, { mask: true, alpha: alphaOf(el, card) });
    for (const p of prims) p.color = [...paint.slice(0, 3), paint[3] * p.color[3]];
    host.remove();
    return prims;
  };

  // An SVG background-image (a select's chevron, say): mounted at its background-position and -size inside the
  // padding box and read in its own colors. One image, no-repeat; other backgrounds are not read.
  const bgImagePrims = (el, card) => {
    const cs = getComputedStyle(el);
    const src = /url\("?data:image\/svg\+xml(?:;utf8)?,([^"]*)"?\)/.exec(cs.backgroundImage)?.[1];
    if (!src) return [];
    const r = el.getBoundingClientRect();
    const bl = parseFloat(cs.borderLeftWidth), bt = parseFloat(cs.borderTopWidth);
    const pw = r.width - bl - parseFloat(cs.borderRightWidth), ph = r.height - bt - parseFloat(cs.borderBottomWidth);
    const [w, h] = cs.backgroundSize.split(" ").map(parseFloat);
    // a background-position component: "Npx", "N%", "left|right|top|bottom Npx", "center", "calc(100% - Npx)"
    const place = (v, room) => {
      let m;
      if ((m = /^(?:right|bottom) (-?[\d.]+)px$/.exec(v))) return room - +m[1];
      if ((m = /^(?:left|top) (-?[\d.]+)px$/.exec(v))) return +m[1];
      if ((m = /^calc\(100% - (-?[\d.]+)px\)$/.exec(v))) return room - +m[1];
      if ((m = /^(-?[\d.]+)%$/.exec(v))) return (room * +m[1]) / 100;
      if (v === "center") return room / 2;
      return parseFloat(v) || 0;
    };
    const fx0 = (v) => /^(right|calc|\d+%|center)/.test(v) && !/^left/.test(v);
    const px = cs.backgroundPositionX, py = cs.backgroundPositionY;
    // percentages and keywords place the image's own matching point; px offsets from right/bottom place its far edge
    const ax = /%$|^center$/.test(px) ? place(px, pw - w) : fx0(px) ? place(px, pw) - w : place(px, pw);
    const ay = /%$|^center$/.test(py) ? place(py, ph - h) : fx0(py) ? place(py, ph) - h : place(py, ph);
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:${r.left + bl + ax}px;top:${r.top + bt + ay}px;width:${w}px;height:${h}px;pointer-events:none;margin:0;padding:0`;
    host.innerHTML = decodeURIComponent(src);
    const svg = host.querySelector("svg");
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    svg.style.display = "block";
    document.body.appendChild(host);
    const prims = svgPrims(svg, card, { alpha: alphaOf(el, card) });
    host.remove();
    return prims;
  };

  // A box's background and borders (per-corner radii, per-side widths and colors).
  const boxPrims = (el, card, r) => {
    const cs = getComputedStyle(el);
    const a = alphaOf(el, card);
    const rad = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((c) => parseFloat(cs[`border${c}Radius`]) || 0);
    const bw = ["Top", "Right", "Bottom", "Left"].map((s) => (cs[`border${s}Style`] !== "none" ? parseFloat(cs[`border${s}Width`]) || 0 : 0));
    const bc = ["Top", "Right", "Bottom", "Left"].map((s) => color(cs[`border${s}Color`], el));
    const prims = [];
    const bg = color(cs.backgroundColor, el);
    if (bg && bg[3] > 0) prims.push({ kind: "box", box: r, radii: rad, color: [...bg.slice(0, 3), bg[3] * a] });
    if (bw.some((w, i) => w > 0 && bc[i] && bc[i][3] > 0)) prims.push({ kind: "border", box: r, radii: rad, widths: bw, colors: bc.map((c) => (c ? [...c.slice(0, 3), c[3] * a] : null)) });
    return prims;
  };

  // Glyphs: each character where Chrome put it. Text nodes through a Range per character; an <input>'s value
  // through canvas metrics laid out as the input lays it out (padding, text-align, vertical centering).
  const fontKey = (cs) => ({ family: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(), stack: cs.fontFamily, weight: Number(cs.fontWeight), italic: cs.fontStyle !== "normal", size: parseFloat(cs.fontSize), features: cs.fontFeatureSettings, numeric: cs.fontVariantNumeric, ligatures: cs.fontVariantLigatures });
  const metrics = (cs) => { ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const m = ctx2d.measureText("Hg"); return { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent }; };
  const caseOf = (s, tt) => (tt === "uppercase" ? s.toUpperCase() : tt === "lowercase" ? s.toLowerCase() : s);
  const textPrims = (el, card) => {
    const prims = [];
    const cs = getComputedStyle(el);
    const a = alphaOf(el, card);
    const ink = color(cs.color, el);
    if (el.tagName === "INPUT" || el.tagName === "SELECT") {
      if (el.tagName === "INPUT" && (["range", "checkbox", "radio", "color"].includes(el.type) || !el.value)) return prims;
      const s = caseOf(el.tagName === "SELECT" ? el.options[el.selectedIndex]?.text ?? "" : el.value, cs.textTransform);
      if (!s) return prims;
      ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      ctx2d.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
      const r = el.getBoundingClientRect();
      const l = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
      const rr = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      const t = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
      const b = r.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom);
      const width = ctx2d.measureText(s).width;
      const x0 = cs.textAlign === "right" || cs.textAlign === "end" ? rr - width : cs.textAlign === "center" ? (l + rr - width) / 2 : l;
      const { asc, desc } = metrics(cs);
      const base = t + (b - t - (asc + desc)) / 2 + asc;
      const chars = [...s].map((ch, i) => ({ ch, x: fx(x0 + ctx2d.measureText(s.slice(0, i)).width) }));
      ctx2d.letterSpacing = "0px";
      prims.push({ kind: "text", text: s, chars, baseline: fy(base), font: fontKey(cs), color: [...ink.slice(0, 3), ink[3] * a] });
      return prims;
    }
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      const { asc } = metrics(cs);
      const range = document.createRange();
      const chars = [];
      const raw = node.textContent;
      let i = 0;
      for (const ch of raw) {
        const len = ch.length;
        range.setStart(node, i); range.setEnd(node, i + len);
        i += len;
        if (!ch.trim()) continue;
        const rr = range.getBoundingClientRect();
        if (!rr.width && !rr.height) continue;
        chars.push({ ch: caseOf(ch, cs.textTransform), x: fx(rr.left), y: fy(rr.top + asc) });
      }
      if (chars.length) prims.push({ kind: "text", text: caseOf(raw, cs.textTransform), chars, baseline: chars[0].y, font: fontKey(cs), color: [...ink.slice(0, 3), ink[3] * a] });
    }
    return prims;
  };

  // A range input: the track is its box; the thumb is its ::-webkit-slider-thumb rule, placed by value.
  const thumbRule = (el) => {
    for (const ss of document.styleSheets) {
      let rules; try { rules = ss.cssRules; } catch { continue; }
      for (const r of rules) {
        if (!r.selectorText || !/::-webkit-slider-thumb/.test(r.selectorText) || /:active|:hover|:focus/.test(r.selectorText)) continue;
        try { if (el.matches(r.selectorText.replace(/::-webkit-slider-thumb/g, ""))) return r.style; } catch {}
      }
    }
    return null;
  };
  const rangePrims = (el, card) => {
    const st = thumbRule(el);
    if (!st) return [];
    const r = rect(el.getBoundingClientRect());
    const tw = parseFloat(st.width), th = parseFloat(st.height);
    const min = Number(el.min || 0), max = Number(el.max || 100), val = Number(el.value);
    const frac = (val - min) / (max - min || 1);
    const cx = r.x + tw / 2 + (r.w - tw) * frac, cy = r.y + r.h / 2;
    const fill = color(st.getPropertyValue("background") || st.getPropertyValue("background-color"), el);
    return [{ kind: "box", box: { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th }, radii: [tw / 2, tw / 2, tw / 2, tw / 2], color: [...fill.slice(0, 3), fill[3] * alphaOf(el, card)], part: "thumb", value: val, frac, track: r }];
  };

  const cards = [...document.querySelectorAll(".react-flow__node")].map((node) => {
    const card = node;
    const title = node.querySelector(".solenoid-node__label-display")?.textContent.trim() ?? node.dataset.id;
    const elements = [];
    const prims = [];
    // Elements first, in tree order, so a piece can name its element and ancestors.
    const index = new Map();
    const walk = (el, parent) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return;
      const idx = elements.length;
      index.set(el, idx);
      const handle = el.classList?.contains("react-flow__handle");
      elements.push({ parent, tag: el.tagName.toLowerCase(), cls: [...(el.classList?.length ? el.classList : el.className?.baseVal?.split(" ").filter(Boolean) ?? [])], box: rect(el.getBoundingClientRect()), ...(handle ? { handle: { id: el.dataset.handleid, kind: el.classList.contains("source") ? "out" : "in" } } : {}) });
      if (!(el instanceof SVGElement)) for (const c of el.children) walk(c, idx);
    };
    walk(node, -1);
    // Then paint, in CSS painting order (CSS 2.1 Appendix E, simplified): an element's own background and
    // border, then its in-flow descendants in tree order, then its positioned (or transformed, or
    // translucent) descendants in z-index order, each painted whole.
    const own = (el) => {
      const idx = index.get(el);
      const add = (list) => { for (const p of list) prims.push({ ...p, el: idx }); };
      if (el instanceof SVGElement) { add(svgPrims(el, card)); return; }
      add(boxPrims(el, card, rect(el.getBoundingClientRect())));
      add(bgImagePrims(el, card));
      add(maskPrims(el, card));
      if (el.tagName === "INPUT" && el.type === "range") add(rangePrims(el, card));
      else add(textPrims(el, card));
    };
    // A positioned element joins its context's layer list; only z-index ≠ auto, a transform or opacity < 1
    // make it a context of its own, painted whole. An auto one paints its flow content at its slot and its
    // own positioned descendants join the same list.
    const positioned = (el) => { const cs = getComputedStyle(el); return cs.position !== "static" || cs.transform !== "none" || Number(cs.opacity) < 1; };
    const ownContext = (el) => { const cs = getComputedStyle(el); return (cs.position !== "static" && cs.zIndex !== "auto") || cs.transform !== "none" || Number(cs.opacity) < 1; };
    const zOf = (el) => parseInt(getComputedStyle(el).zIndex) || 0;
    const paint = (el) => {
      own(el);
      const layers = [];
      const flow = (parent) => {
        if (parent instanceof SVGElement) return;
        for (const c of parent.children) {
          if (!index.has(c)) continue;
          if (!positioned(c)) { own(c); flow(c); continue; }
          layers.push({ el: c, z: zOf(c), order: layers.length });
          if (!ownContext(c)) collect(c);
        }
      };
      // an auto-z positioned element's positioned descendants, into the same list after it
      const collect = (parent) => {
        if (parent instanceof SVGElement) return;
        for (const c of parent.children) {
          if (!index.has(c)) continue;
          if (positioned(c)) { layers.push({ el: c, z: zOf(c), order: layers.length }); if (!ownContext(c)) collect(c); }
          else collect(c);
        }
      };
      flow(el);
      layers.sort((a, b) => a.z - b.z || a.order - b.order);
      for (const { el: c } of layers) {
        if (ownContext(c)) paint(c);
        else { own(c); flowOnly(c); }
      }
    };
    // an auto-z positioned element's in-flow content (its positioned descendants are painted from the list)
    const flowOnly = (parent) => {
      if (parent instanceof SVGElement) return;
      for (const c of parent.children) if (index.has(c) && !positioned(c)) { own(c); flowOnly(c); }
    };
    paint(node);
    const hero = node.querySelector(".solenoid-node__io-row--hero") ?? [...node.querySelectorAll(".solenoid-node__display-value")].pop();
    return { id: node.dataset.id, title, box: rect(node.getBoundingClientRect()), hero: hero ? rect(hero.getBoundingClientRect()) : null, elements, prims, text: node.innerText.replace(/\s*\n\s*/g, " | ") };
  });

  // A cable is every stroked path its <g> paints (hit paths are transparent and skipped).
  const cables = [...document.querySelectorAll(".react-flow__edge")].map((g) => ({
    id: g.dataset.id ?? g.getAttribute("data-testid"),
    layers: [...g.querySelectorAll("path")].filter((q) => {
      const cs = getComputedStyle(q);
      const c = color(cs.stroke, q);
      return c && c[3] > 0 && Number(cs.strokeOpacity) > 0 && Number(cs.opacity) > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    }).map((p) => {
      const cs = getComputedStyle(p);
      const c = color(cs.stroke, p);
      const len = p.getTotalLength(), n = Math.max(2, Math.ceil(len / 2));
      return { d: p.getAttribute("d"), length: len, points: Array.from({ length: n + 1 }, (_, i) => { const q = p.getPointAtLength((len * i) / n); return [q.x, q.y]; }), color: [...c.slice(0, 3), c[3] * Number(cs.opacity) * Number(cs.strokeOpacity)], width: parseFloat(cs.strokeWidth), cap: cs.strokeLinecap, join: cs.strokeLinejoin };
    }),
  }));

  // CanvasBacking.tsx: a pattern DOT_SPACING·k wide around a dot of radius k, so width / r is the spacing in flow px.
  const backing = document.querySelector(".sol-canvas-backing");
  const pat = backing.querySelector("pattern"), dot = backing.querySelector("circle");
  const background = { color: color(getComputedStyle(document.querySelector(".react-flow")).backgroundColor), dot: color(getComputedStyle(dot).fill), gap: Number(pat.getAttribute("width")) / Number(dot.getAttribute("r")), radius: 1 };
  probe.remove();
  return { cards, cables, background, viewport: { x: tx, y: ty, k, left: r0.left, top: r0.top } };
});

const sweep = (sw) => {
  const values = sw.values ?? Array.from({ length: Math.round((sw.to - sw.from) / sw.step) + 1 }, (_, i) => +(sw.from + i * sw.step).toFixed(10));
  return values.map((value, i) => ({ name: `s${i}`, value, set: { [sw.node]: { init: { [sw.init]: value } } } }));
};
const states = scene.sweep ? sweep(scene.sweep) : scene.states?.length ? scene.states : [{ name: "base" }];
const result = { states: {} };
for (const [si, state] of states.entries()) {
  await load(withState(state));
  const m = await read();
  {
    const pad = 28;
    const x0 = Math.floor(Math.min(...m.cards.map((c) => c.box.x)) - pad), y0 = Math.floor(Math.min(...m.cards.map((c) => c.box.y)) - pad);
    const x1 = Math.ceil(Math.max(...m.cards.map((c) => c.box.x + c.box.w)) + pad), y1 = Math.ceil(Math.max(...m.cards.map((c) => c.box.y + c.box.h)) + pad);
    const vp = m.viewport;
    const file = `reference-${state.name}.png`;
    await page.screenshot({ path: join(out, file), clip: { x: vp.left + vp.x + x0, y: vp.top + vp.y + y0, width: x1 - x0, height: y1 - y0 } });
    if (si === 0) {
      result.reference = { file, x: x0, y: y0, w: x1 - x0, h: y1 - y0, scale: REF_SCALE, state: state.name };
      result.background = m.background;
    }
    result.states[state.name] = { value: state.value, reference: file, referenceBox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, cards: m.cards, cables: m.cables };
  }
  console.log(`${state.name}: ${m.cards.map((c) => `${c.title} (${c.prims.length} prims) [${c.text.slice(-20)}]`).join(" ; ")}`);
}
writeFileSync(join(out, "scene.json"), JSON.stringify(result));
await browser.close();
console.log(`scene → ${join(out, "scene.json")}`);
