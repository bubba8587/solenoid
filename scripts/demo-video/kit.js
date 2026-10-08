// Page-side kit for the demo recorder: camera flights over the live editor, node and socket lookup,
// and the painted pointer, click ring and keycaps (headless Chromium paints no cursor).
(() => {
  if (window.__demo) return;
  let P;
  const mods = async () => (P ??= await import("/src/graph/process.ts"));

  // d3.interpolateZoom (van Wijk & Nuij), p = [centerX, centerY, viewWidthInFlowUnits]
  const cosh = (x) => ((x = Math.exp(x)) + 1 / x) / 2;
  const sinh = (x) => ((x = Math.exp(x)) - 1 / x) / 2;
  const tanh = (x) => ((x = Math.exp(2 * x)) - 1) / (x + 1);
  function interpolateZoom([ux0, uy0, w0], [ux1, uy1, w1]) {
    const rho = Math.SQRT2;
    const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
    if (d2 < 1e-12) {
      const S = Math.log(w1 / w0) / rho;
      return (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
    }
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    const S = (r1 - r0) / rho;
    return (t) => {
      const s = t * S, c0 = cosh(r0);
      const u = (w0 / (2 * d1)) * (c0 * tanh(rho * s + r0) - sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / cosh(rho * s + r0)];
    };
  }
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  async function view() { return (await mods()).getView(); }
  async function editor() { return (await mods()).getEditor(); }

  async function nodes() {
    const ed = await editor(), v = await view();
    return ed.getNodes().map((n) => {
      const el = v.nodeElement(n.id);
      const pos = v.position(n.id);
      return {
        id: n.id, ctor: n.constructor.name, label: n.label,
        x: Math.round(pos?.x ?? 0), y: Math.round(pos?.y ?? 0), w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0,
        members: n.members ? [...n.members] : undefined,
      };
    });
  }
  // A card by its label, or by the title its header shows when it has no label of its own.
  async function byLabel(label) {
    const all = await nodes();
    const v = await view();
    const shown = (n) => v.nodeElement(n.id)?.querySelector(".solenoid-node__label-display")?.textContent.trim();
    const n = all.find((x) => x.label === label) ?? all.find((x) => shown(x)?.toLowerCase() === label.toLowerCase());
    if (!n) throw new Error(`no node labeled "${label}"`);
    return n;
  }
  async function bounds(labels) {
    const all = await nodes();
    const sel = [];
    for (const l of labels) sel.push(all.find((n) => n.id === l) ?? (await byLabel(l)));
    if (!sel.length) throw new Error(`no nodes for ${labels}`);
    const x0 = Math.min(...sel.map((n) => n.x)), y0 = Math.min(...sel.map((n) => n.y));
    const x1 = Math.max(...sel.map((n) => n.x + n.w)), y1 = Math.max(...sel.map((n) => n.y + n.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  async function camera() { const v = await view(); return { x: v.transform.x, y: v.transform.y, k: v.transform.k }; }
  async function setCamera(c) { const v = await view(); v.transform.k = c.k; await v.pan(c.x, c.y); }
  // The camera framing flow-space bounds b; dx/dy nudge the framing in screen px.
  async function cameraFor(b, { k, pad = 0.08, maxK = 1.4, minK = 0.1, dx = 0, dy = 0 } = {}) {
    const v = await view();
    const W = v.container.clientWidth, H = v.container.clientHeight;
    const fit = Math.min(W / (b.w * (1 + 2 * pad)), H / (b.h * (1 + 2 * pad)));
    const kk = k ?? Math.max(minK, Math.min(maxK, fit));
    return { k: kk, x: W / 2 - (b.x + b.w / 2) * kk + dx, y: H / 2 - (b.y + b.h / 2) * kk + dy };
  }
  async function fly(to, ms = 1400) {
    const v = await view();
    const W = v.container.clientWidth, H = v.container.clientHeight;
    const f = { x: v.transform.x, y: v.transform.y, k: v.transform.k };
    const interp = interpolateZoom(
      [(W / 2 - f.x) / f.k, (H / 2 - f.y) / f.k, W / f.k],
      [(W / 2 - to.x) / to.k, (H / 2 - to.y) / to.k, W / to.k],
    );
    const t0 = performance.now();
    await new Promise((res) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const [cx, cy, w] = interp(easeInOut(t));
        const k = W / w;
        v.transform.k = k;
        v.pan(W / 2 - cx * k, H / 2 - cy * k);
        if (t < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }
  // A slow push-in or pan over ms, so a hold doesn't sit dead still.
  async function drift({ dx = 0, dy = 0, zoom = 1 }, ms) {
    const v = await view();
    const W = v.container.clientWidth, H = v.container.clientHeight;
    const f = { x: v.transform.x, y: v.transform.y, k: v.transform.k };
    const c0 = [(W / 2 - f.x) / f.k, (H / 2 - f.y) / f.k];
    const t0 = performance.now();
    await new Promise((res) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms), e = -(Math.cos(Math.PI * t) - 1) / 2;
        const k = f.k * Math.pow(zoom, e);
        const cx = c0[0] + (dx / f.k) * e, cy = c0[1] + (dy / f.k) * e;
        v.transform.k = k;
        v.pan(W / 2 - cx * k, H / 2 - cy * k);
        if (t < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }

  // Flow-space point → viewport px.
  async function toScreen(fx, fy) {
    const v = await view();
    const r = v.container.getBoundingClientRect();
    return { x: r.left + v.transform.x + fx * v.transform.k, y: r.top + v.transform.y + fy * v.transform.k };
  }
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }
  async function nodeRect(label) {
    const n = await byLabel(label);
    const el = (await view()).nodeElement(n.id);
    return rectOf(el);
  }
  async function handle(label, key, side) {
    const n = await byLabel(label);
    const hs = [...document.querySelectorAll(`.react-flow__handle[data-nodeid="${CSS.escape(n.id)}"]`)]
      .filter((h) => !key || h.dataset.handleid === key)
      .filter((h) => !side || h.classList.contains(side === "out" ? "source" : "target"));
    if (!hs.length) throw new Error(`no ${side ?? ""} socket ${key ?? ""} on "${label}"`);
    return rectOf(hs[0]);
  }
  // Lays cards out left to right with even gaps by their measured widths, tops aligned with the first.
  async function row(labels, gap = 70) {
    const v = await view();
    const ns = [];
    for (const l of labels) ns.push(await byLabel(l));
    let x = ns[0].x;
    for (const n of ns) { await v.moveNode(n.id, { x, y: ns[0].y }); x += n.w + gap; }
  }
  // The first frame or table chip shown on a card ("[26×5 Frame]").
  async function chip(label) {
    const n = await byLabel(label);
    const el = [...(await view()).nodeElement(n.id).querySelectorAll("*")].find((e) => !e.children.length && /^\[\d+×\d+ (Frame|Table)\]$/.test(e.textContent.trim()));
    if (!el) throw new Error(`no frame chip on "${label}"`);
    return rectOf(el);
  }
  // A card's row at a socket, as wide as the card.
  async function socketRow(label, key, side = "in") {
    const n = await nodeRect(label), h = await handle(label, key, side);
    return { x: n.x + 4, y: h.cy - 14, w: n.w - 8, h: 28, cx: n.cx, cy: h.cy };
  }
  // A point on the cable between two sockets, nearer its source, where a click selects it.
  async function cableMid(fromLabel, fromKey, toLabel, toKey) {
    const a = await handle(fromLabel, fromKey, "out"), b = await handle(toLabel, toKey, "in");
    const at = (path, len) => { const p = path.getPointAtLength(len), m = path.getScreenCTM(); return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f }; };
    const near = (p, q) => Math.hypot(p.x - q.cx, p.y - q.cy) < 18;
    for (const path of document.querySelectorAll(".react-flow__edge path")) {
      const L = path.getTotalLength?.();
      if (!L) continue;
      const s = at(path, 0), e = at(path, L);
      if (near(s, a) && near(e, b)) { const m = at(path, L * 0.3); return { x: m.x, y: m.y, cx: m.x, cy: m.y }; }
      if (near(s, b) && near(e, a)) { const m = at(path, L * 0.7); return { x: m.x, y: m.y, cx: m.x, cy: m.y }; }
    }
    throw new Error(`no cable ${fromLabel}.${fromKey} → ${toLabel}.${toKey}`);
  }
  // Center of the first element under root matching sel whose text includes text.
  function find(sel, text, root = document) {
    const el = [...root.querySelectorAll(sel)].find((e) => !text || e.textContent.includes(text));
    return el ? rectOf(el) : null;
  }
  async function within(label, sel, text) {
    const n = await byLabel(label);
    const root = (await view()).nodeElement(n.id);
    return find(sel, text, root);
  }

  const svgArrow = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><path d="M3.5 2.2 L3.5 19.6 L7.9 15.5 L10.7 21.9 L13.9 20.5 L11.1 14.2 L17.2 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const svgHand = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><path d="M9.2 3.2c.9 0 1.6.7 1.6 1.6v5.4l.3-.1V8.6c0-.9.7-1.5 1.5-1.5s1.5.7 1.5 1.5v1.7l.2-.1c.1-.8.7-1.3 1.5-1.3.8 0 1.5.7 1.5 1.5v1.3c.2-.7.8-1.1 1.4-1.1.8 0 1.5.7 1.5 1.5v4.5c0 3.3-2.4 5.9-5.8 5.9h-1.7c-2 0-3.3-.8-4.5-2.3l-3.4-4.3c-.5-.7-.4-1.6.3-2.1.6-.5 1.5-.4 2 .2l1.1 1.3V4.8c0-.9.7-1.6 1.6-1.6z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  const svgBeam = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round"><path d="M8.5 3.5h2.2c.6 0 1 .3 1.3.7.3-.4.7-.7 1.3-.7h2.2M12 4.5v15M8.5 20.5h2.2c.6 0 1-.3 1.3-.7.3.4.7.7 1.3.7h2.2" stroke="#111" stroke-width="3.2"/><path d="M8.5 3.5h2.2c.6 0 1 .3 1.3.7.3-.4.7-.7 1.3-.7h2.2M12 4.5v15M8.5 20.5h2.2c.6 0 1-.3 1.3-.7.3.4.7.7 1.3.7h2.2" stroke="#fff" stroke-width="1.4"/></g></svg>`;
  const SHAPES = { arrow: [svgArrow, 3.8, 2.4], hand: [svgHand, 10.3, 3.8], beam: [svgBeam, 13, 13] };
  let cursorEl, ringLayer, keyEl, shape = "", cx = -100, cy = -100, shown = false, ptScale = 1;
  function ensureOverlay() {
    if (cursorEl?.isConnected) return;
    const st = document.createElement("style");
    st.textContent = `
      #__demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform-origin:0 0;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));transition:opacity .3s}
      #__demo-rings{position:fixed;inset:0;z-index:2147483646;pointer-events:none}
      .__demo-ring{position:fixed;width:calc(34px * var(--demo-scale, 1));height:calc(34px * var(--demo-scale, 1));margin:calc(-17px * var(--demo-scale, 1)) 0 0 calc(-17px * var(--demo-scale, 1));border-radius:50%;border:2px solid rgba(255,255,255,.85);animation:__demoRing .5s ease-out forwards}
      @keyframes __demoRing{from{transform:scale(.3);opacity:.9}to{transform:scale(1.15);opacity:0}}
      #__demo-keys{position:fixed;left:62%;bottom:72px;transform:translateX(-50%);zoom:var(--demo-scale, 1);z-index:2147483645;pointer-events:none;display:flex;gap:8px;opacity:0;transition:opacity .2s}
      #__demo-keys.on{opacity:1}
      .__demo-box{position:fixed;z-index:2147483644;pointer-events:none;border:2.5px solid #f5b914;border-radius:9px;box-shadow:0 0 0 4px rgba(245,185,20,.16),0 0 20px rgba(245,185,20,.38);animation:__demoBoxIn .38s cubic-bezier(.2,.8,.2,1) forwards;transition:opacity .3s}
      @keyframes __demoBoxIn{from{opacity:0;transform:scale(1.12)}to{opacity:1;transform:scale(1)}}
      .__demo-key{min-width:44px;height:44px;padding:0 14px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#1e1e1e;border:1px solid #3a3a3a;border-bottom-width:3px;color:#f3f4f5;font:600 19px "Atkinson Hyperlegible Next Variable","Atkinson Hyperlegible Next",system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35)}
    `;
    document.head.appendChild(st);
    cursorEl = Object.assign(document.createElement("div"), { id: "__demo-cursor" });
    ringLayer = Object.assign(document.createElement("div"), { id: "__demo-rings" });
    keyEl = Object.assign(document.createElement("div"), { id: "__demo-keys" });
    document.documentElement.append(ringLayer, cursorEl, keyEl);
    setShape("arrow");
  }
  function setShape(s) {
    if (s === shape) return;
    shape = s;
    cursorEl.innerHTML = SHAPES[s][0];
    place();
  }
  function place() {
    const [, hx, hy] = SHAPES[shape] ?? SHAPES.arrow;
    cursorEl.style.transform = `translate(${cx - hx * ptScale}px, ${cy - hy * ptScale}px) scale(${ptScale})`;
    cursorEl.style.opacity = shown ? "1" : "0";
  }
  let dragging = false;
  function shapeFor(el) {
    if (dragging || !(el instanceof Element)) return "arrow";
    const c = getComputedStyle(el).cursor;
    if (c === "pointer") return "hand";
    if (c === "text") return "beam";
    return "arrow";
  }
  const onMove = (e) => {
    cx = e.clientX; cy = e.clientY;
    ensureOverlay();
    setShape(shapeFor(document.elementFromPoint(cx, cy)));
    place();
  };
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("mousedown", (e) => {
    ensureOverlay();
    dragging = true;
    const r = document.createElement("div");
    r.className = "__demo-ring";
    r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`;
    ringLayer.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }, true);
  window.addEventListener("mouseup", () => { dragging = false; }, true);
  let keyTimer;
  function showKeys(keys, ms = 1200) {
    ensureOverlay();
    keyEl.innerHTML = keys.map((k) => `<div class="__demo-key">${k}</div>`).join("");
    keyEl.classList.add("on");
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => keyEl.classList.remove("on"), ms);
  }
  function cursor(on) { shown = on; ensureOverlay(); place(); }
  // A window filmed at a smaller device scale than its neighbour draws its pointer and keycaps larger to match.
  function overlayScale(s) { ptScale = s; ensureOverlay(); document.documentElement.style.setProperty("--demo-scale", String(s)); place(); }
  // Callout boxes around a viewport rect; they hold until cleared, so the camera stays put while one shows.
  function box(r, pad = 6) {
    ensureOverlay();
    const el = document.createElement("div");
    el.className = "__demo-box";
    Object.assign(el.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.w + 2 * pad}px`, height: `${r.h + 2 * pad}px` });
    ringLayer.appendChild(el);
  }
  function clearBoxes() {
    for (const el of document.querySelectorAll(".__demo-box")) { el.style.opacity = "0"; setTimeout(() => el.remove(), 320); }
  }

  window.__demo = { mods, view, editor, nodes, byLabel, bounds, camera, setCamera, cameraFor, fly, drift, toScreen, nodeRect, handle, find, within, showKeys, cursor, overlayScale, box, clearBoxes, socketRow, cableMid, row, chip };
})();
