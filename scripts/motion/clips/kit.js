// [[C121]]
// What the clips share: easing, keyed values, the assemble choreography (a card unfolds and its layers drop in
// by paint order), state sweeps (the app's own layouts swapped in, a changed glyph popping as it lands), the
// camera rig and the rest check. A clip is a pure function of time built from these.

export const expoOut = (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
export const backOut = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
export const inOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
export const clamp01 = (u) => Math.min(1, Math.max(0, u));
export const lerp = (a, b, u) => a + (b - a) * u;
/** Piecewise-linear through [t, v] keys. */
export const keys = (ks, t) => {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) return lerp(ks[i - 1][1], ks[i][1], (t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0]));
  return ks[ks.length - 1][1];
};

export const SENS_H = 36 * 9 / 16; // mm: a 36 mm-wide sensor at 16:9

/** Give every first-state piece of a card its entrance: the body and frame unfold from the header line down;
 *  everything else drops from a height set by its paint order, top to bottom, glyphs typing across.
 *  opts: { wave = 0.95, piece = 0.55, glyphSweep = 0.3, lift = 1, spread = 0.35, spin = 1 }; `flat: true` is the
 *  quiet version for straight-on shots (barely lifted, no spread, no spin). */
export function assemble(THREE, grp, t0, opts = {}) {
  const { wave = 0.95, piece = 0.55, glyphSweep = 0.3, lift = opts.flat ? 0.12 : 1, spread = opts.flat ? 0 : 0.35, spin = opts.flat ? 0 : 1 } = opts;
  const b = grp.userData.box;
  const n = Math.max(...grp.userData.pieces.map((m) => m.userData.order)) + 1;
  for (const m of grp.userData.pieces) {
    const p = m.userData;
    if (p.state) continue;
    const [cx, cy] = p.center, [w, h] = p.size;
    const u = (cy - b.y) / b.h, v = (cx - b.x) / b.w;
    const big = w * h > 0.35 * b.w * b.h || (w > 0.9 * b.w && (p.kind === "border" || p.kind === "stroke") && h > 0.5 * b.h);
    if (big) { p.anim = { t0, dur: 0.42, ease: expoOut, unfold: b.h / 2 - (cy - b.y) }; continue; }
    p.anim = {
      t0: t0 + 0.12 + wave * u + (p.glyph ? glyphSweep : 0.1) * v,
      dur: p.glyph ? 0.32 : piece,
      ease: p.part === "socket" ? backOut : expoOut,
      from: new THREE.Vector3((cx - (b.x + b.w / 2)) * spread, -(cy - (b.y + b.h / 2)) * spread, (0.35 + 1.9 * p.order / n) * 100 * lift),
      spin: (p.glyph ? 0.35 : 0.12) * (p.order % 2 ? 1 : -1) * spin,
    };
  }
}

/** Place a first-state piece for time t along its entrance (at rest once it has landed). */
export function enter(m, t) {
  const p = m.userData, a = p.anim;
  if (!a) { m.position.copy(p.rest); m.scale.set(1, 1, 1); m.rotation.set(0, 0, 0); return; }
  const u = a.ease(clamp01((t - a.t0) / a.dur));
  if (a.unfold !== undefined) {
    m.position.set(p.rest.x, p.rest.y + a.unfold * (1 - u), 0);
    m.scale.set(1, Math.max(1e-3, u), 1);
    m.rotation.set(0, 0, 0);
    return;
  }
  m.position.copy(p.rest).addScaledVector(a.from, 1 - u);
  const s = Math.max(1e-3, u);
  m.scale.set(s, s, s);
  m.rotation.set(0, 0, a.spin * (1 - u));
}

/** Which state is on screen: the first before `t0`, then stepping through all of them by `times` (one start
 *  time per state after the first) or evenly over [t0, t1] eased. */
export function stepper(states, { t0, t1, times, ease = inOut }) {
  const starts = times ?? states.slice(1).map((_, i) => t0 + ((t1 - t0) * invEase(ease, (i + 0.5) / (states.length - 1))));
  const at = (t) => { let k = 0; while (k < starts.length && t >= starts[k]) k++; return { name: states[k], prev: k ? states[k - 1] : null, since: k ? t - starts[k - 1] : t, index: k }; };
  at.starts = starts;
  at.names = states;
  return at;
}
function invEase(f, y) { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) < y) lo = mid; else hi = mid; } return (lo + hi) / 2; }

/** Show the pieces of the state on screen, each at its paint position in that state; with `pop` (s), a glyph that wasn't in the
 *  state before pops in (scale 1.35 → 1) as it lands. First-state pieces keep the transform `enter` gave them. */
export function showState(pieces, cur, t, { pop = 0 } = {}) {
  const pick = typeof cur === "function" ? cur : () => cur;
  for (const m of pieces) {
    const p = m.userData;
    cur = pick(m);
    m.visible = p.in.includes(cur.name);
    if (!m.visible) continue;
    m.renderOrder = m.parent.userData.index * 10000 + p.orderIn[cur.name];
    if (!p.state) continue;
    m.position.copy(p.rest);
    m.rotation.set(0, 0, 0);
    const fresh = pop && p.glyph && !(cur.prev && p.in.includes(cur.prev));
    const s = fresh ? 1 + 0.35 * (1 - backOut(clamp01(cur.since / pop))) : 1;
    m.scale.set(s, s, s);
  }
}

/** The camera rig: shots [t, eye, look, lens mm, f-stop] → shotAt(t). Interpolates look point, view direction,
 *  framed height and lens (Catmull-Rom), and puts the eye at the distance that frames that height through that
 *  lens, so a lens change mid-move is a smooth dolly-zoom. */
export function rig(THREE, shots, { eased = false } = {}) {
  const KEYS = shots.map(([t, eye, look, lens, fstop]) => {
    const off = eye.clone().sub(look), dist = off.length();
    return { t, look, dir: off.normalize(), logH: Math.log((dist * SENS_H) / lens), logLens: Math.log(lens), logF: Math.log(fstop) };
  });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const spline = (get, t) => {
    const ts = KEYS.map((k) => k.t);
    if (t <= ts[0]) return get(KEYS[0]);
    if (t >= ts[ts.length - 1]) return get(KEYS[KEYS.length - 1]);
    let i = 0;
    while (ts[i + 1] < t) i++;
    const u = (t - ts[i]) / (ts[i + 1] - ts[i]), u2 = u * u, u3 = u2 * u;
    const P = (k) => get(KEYS[Math.max(0, Math.min(KEYS.length - 1, k))]);
    if (eased) { // each segment eased in and out on its own: holds stay still and nothing overshoots
      const e = inOut(u), a = P(i), b = P(i + 1);
      return typeof a === "number" ? lerp(a, b, e) : a.clone().lerp(b, e);
    }
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
    if (typeof p1 === "number") return f(p0, p1, p2, p3);
    return V(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
  };
  return (t) => {
    const look = spline((k) => k.look, t), dir = spline((k) => k.dir, t).normalize();
    const lens = Math.exp(spline((k) => k.logLens, t));
    const eye = look.clone().addScaledVector(dir, (lens * Math.exp(spline((k) => k.logH, t))) / SENS_H);
    return { eye, look, lens, fstop: Math.exp(spline((k) => k.logF, t)) };
  };
}

/** Flow-space helpers: a point in a flow box (fx, fy across it), and a shot offset in hundreds of flow px. */
export const helpers = (THREE) => {
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  return {
    V,
    at: (b, fx = 0.5, fy = 0.5) => V(b.x + b.w * fx, -(b.y + b.h * fy)),
    off: (v, x, y, z) => v.clone().add(V(x * 100, y * 100, z * 100)),
    /** The closing shot: straight down on flow box b with a long lens, framing it with a little margin. */
    final: (b, lens = 180, margin = 1.06) => { const c = V(b.x + b.w / 2, -(b.y + b.h / 2)); return [c.clone().add(V(0, 0, (lens * Math.max(b.h, b.w * 9 / 16) * margin) / SENS_H)), c, lens, 16]; },
  };
};

/** The rest check: how far any visible piece sits from its rest place at t (0 at the last frame). */
export function restError(pieces, pose, t, stateName) {
  pose(t);
  let worst = 0;
  for (const m of pieces) {
    if (!m.visible) continue;
    worst = Math.max(worst, m.position.distanceTo(m.userData.rest), Math.abs(1 - m.scale.x), Math.abs(1 - m.scale.y), Math.abs(m.rotation.x), Math.abs(m.rotation.y), Math.abs(m.rotation.z));
  }
  return { worst, state: stateName };
}

/** Pulse heads: clear every cable's list at the start of a pose, then write them out after (`flushHeads`). A
 *  cable carries several at once, so a fast run of changes never cuts one short. */
export function clearHeads(cables) { for (const c of cables) c.userData.heads = []; }
export function flushHeads(cables) {
  for (const c of cables) {
    const slots = c.material.uniforms.pulses.value;
    const hs = (c.userData.heads ?? []).slice(-slots.length);
    for (let i = 0; i < slots.length; i++) slots[i] = i < hs.length ? hs[i] : -1;
  }
}
const head = (c, u) => (c.userData.heads ??= []).push(u);

/** A cable drawing on from its source over [t0, t0 + dur], its hot head running off the end after. */
export function drawCable(c, t, t0, dur) {
  c.material.uniforms.reveal.value = keys([[t0, 0], [t0 + dur, 1]], t);
  if (t >= t0 && t < t0 + dur + 0.35) head(c, keys([[t0, -0.2], [t0 + dur, 1.0], [t0 + dur + 0.35, 1.4]], t));
}

/** Cables across states (a state may rewire the graph). A cable in the first state draws on at `intro(c)` =
 *  [t0, dur]; one that a later state adds draws on from its source when that state starts; one the next state
 *  drops retracts toward its source just before it goes, so a rewire reads as unplug, plug in. */
export function wire(cables, stepAt, t, { intro = () => [0, 0.5], grow = 0.45, cut = 0.32 } = {}) {
  const cur = stepAt(t), names = stepAt.names, starts = stepAt.starts, k = cur.index;
  cables.forEach((c) => {
    const has = (n) => c.userData.in.includes(n);
    if (!has(cur.name)) { c.visible = false; c.material.uniforms.reveal.value = 0; return; }
    let a = k;
    while (a > 0 && has(names[a - 1])) a--;
    let reveal;
    if (a === 0) { const [t0, dur] = intro(c); drawCable(c, t, t0, dur); reveal = c.material.uniforms.reveal.value; }
    else {
      const ta = starts[a - 1];
      reveal = expoOut(clamp01((t - ta) / grow));
      if (t - ta < grow + 0.3) head(c, keys([[ta, -0.2], [ta + grow, 1.0], [ta + grow + 0.3, 1.4]], t));
    }
    if (k < names.length - 1 && !has(names[k + 1])) reveal *= clamp01((starts[k] - t) / cut);
    c.material.uniforms.reveal.value = reveal;
    c.visible = reveal > 0;
  });
}

/** The card whose box holds flow point [x, y] (a cable end), with a little slack for sockets on the edge. */
export function cardAt(cards, [x, y], slack = 20) {
  for (const [title, g] of Object.entries(cards)) {
    const b = g.userData.box;
    if (x >= b.x - slack && x <= b.x + b.w + slack && y >= b.y - slack && y <= b.y + b.h + slack) return title;
  }
  return null;
}

/** Causality: a change shows on the card it was made on, then travels. Each card shows the state of `lag`
 *  seconds per cable hop ago (its depth: 0 for a card no cable feeds, else 1 + the deepest card feeding it),
 *  and every cable leaving a card that just changed carries a pulse that lands as the next card updates.
 *  Returns { stateFor(m, t), pulse(t) }: use stateFor as showState's pick, call pulse after drawing cables. */
export function causal({ cards, cables, pieces, stepAt, lag = 0.28, view = (card, name) => name }) {
  const links = cables.map((c) => ({ c, from: cardAt(cards, c.userData.ends[0]), to: cardAt(cards, c.userData.ends[1]) }));
  const depth = Object.fromEntries(Object.keys(cards).map((k) => [k, 0]));
  for (let i = 0; i < links.length; i++) for (const l of links) if (l.from && l.to) depth[l.to] = Math.max(depth[l.to], depth[l.from] + 1);
  // which cards each step changes: some piece of the card appears or disappears
  const changed = stepAt.starts.map((_, k) => {
    const out = new Set();
    for (const m of pieces) {
      const p = m.userData, a = p.in.includes(view(p.card, stepAt(stepAt.starts[k] - 1e-6).name)), b = p.in.includes(view(p.card, stepAt(stepAt.starts[k]).name));
      if (a !== b) out.add(p.card);
    }
    return out;
  });
  // `view` lets a card show another state than the graph's: a table popup's edit reaches the cards behind it
  // only on Save, say
  const stateFor = (m, t) => {
    const cur = stepAt(t - depth[m.userData.card] * lag);
    return { ...cur, name: view(m.userData.card, cur.name), prev: cur.prev && view(m.userData.card, cur.prev) };
  };
  const pulse = (t) => {
    for (const { c, from } of links) {
      if (!from) continue;
      if (!c.visible || c.material.uniforms.reveal.value < 1) continue;
      stepAt.starts.forEach((tk, k) => {
        if (!changed[k].has(from)) return;
        const t0 = tk + depth[from] * lag;
        if (t >= t0 && t < t0 + lag) head(c, -0.1 + 1.2 * ((t - t0) / lag));
      });
    }
  };
  return { stateFor, pulse, depth };
}

/** A straight-on shot of flow box b: the long lens from above, tilted `tilt` degrees toward the viewer. */
export function front(THREE, b, { lens = 85, tilt = 0, margin = 1.08, dx = 0, dy = 0 } = {}) {
  const c = new THREE.Vector3(b.x + b.w / 2 + dx, -(b.y + b.h / 2) + dy, 0);
  const d = (lens * Math.max(b.h, (b.w * 9) / 16) * margin) / SENS_H;
  const a = (tilt * Math.PI) / 180;
  return [c.clone().add(new THREE.Vector3(0, -Math.sin(a) * d, Math.cos(a) * d)), c, lens, 16];
}

/** The type layer, laid out at 1920×1080 and scaled to the render: a headline, an eyebrow naming the side on
 *  screen, a step caption, a closing line, two free tags (positioned per frame) and a pointer. Built once. */
export function stage(el, { width }) {
  if (el._stage) return el._stage;
  const root = document.createElement("div");
  root.style.cssText = `position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(${width / 1920});transform-origin:0 0`;
  el.appendChild(root);
  const div = (css) => { const d = document.createElement("div"); d.style.cssText = `position:absolute;opacity:0;${css}`; root.appendChild(d); return d; };
  const eyebrow = "font-weight:700;font-size:24px;letter-spacing:.16em;text-transform:uppercase;white-space:nowrap";
  // scrims under the headline and the caption: whatever the frame lets spill under the type fades to the canvas
  const scrim = (edge) => div(`left:0;right:0;${edge}:0;height:250px;background:linear-gradient(to ${edge === "top" ? "bottom" : "top"},#0b0b0b 0,#0b0b0b 175px,rgba(11,11,11,0) 250px)`);
  const scrimTop = scrim("top"), scrimBottom = scrim("bottom");
  const st = {
    headline: div("left:0;right:0;top:56px;text-align:center;font-weight:800;font-size:88px;line-height:1.05;letter-spacing:-0.01em;color:#f3f4f5;text-wrap-style:balance"),
    eyebrow: div(`left:0;right:0;top:172px;text-align:center;${eyebrow}`),
    step: div("left:200px;right:200px;top:902px;text-align:center;font-weight:600;font-size:38px;line-height:1.2;color:#f3f4f5;text-wrap-style:balance"),
    kicker: div("left:140px;right:140px;top:886px;text-align:center;font-weight:800;font-size:54px;line-height:1.12;color:#f3f4f5;text-wrap-style:balance"),
    tagA: div(`${eyebrow};transform-origin:50% 100%`),
    tagB: div(`${eyebrow};transform-origin:50% 100%`),
    pointer: div("left:0;top:0;width:40px;height:40px"),
  };
  st.pointer.innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#f3f4f5" stroke="#0b0b0b" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  st.scale = 1920 / width;
  /** Set text (only when it changes) and fade it over [a, b]: in over 0.35 s rising a little, out over 0.3 s. */
  st.show = (e, text, t, a, b = null, { rise = 16 } = {}) => {
    if (text != null && e.textContent !== text) e.textContent = text;
    const k = Math.min(clamp01((t - a) / 0.35), b == null ? 1 : clamp01((b - t) / 0.3));
    e.style.opacity = String(k);
    e.style.translate = `0 ${(1 - expoOut(clamp01((t - a) / 0.35))) * rise}px`;
    const op = (...es) => String(Math.max(...es.map((x) => Number(x.style.opacity) || 0)));
    scrimTop.style.opacity = scrimBottom.style.opacity = op(st.headline, st.eyebrow, st.step, st.kicker);
  };
  /** A tag centered over render-px point p. */
  st.tag = (e, text, p, color, t, a, b) => {
    st.show(e, text, t, a, b);
    e.style.color = color;
    const w = e.offsetWidth;
    e.style.left = `${p.x * st.scale - w / 2}px`;
    e.style.top = `${p.y * st.scale - 40}px`;
  };
  /** The pointer at render-px point p; `press` 0..1 dips it as a click. */
  st.point = (p, on, press = 0) => {
    st.pointer.style.opacity = on ? "1" : "0";
    if (p) st.pointer.style.transform = `translate(${p.x * st.scale - 5}px, ${p.y * st.scale - 3}px) scale(${1 - 0.14 * press})`;
  };
  el._stage = st;
  return st;
}

/** A straight-on shot that puts flow box b inside the screen region [side, 1920 − side] × [top, bottom] (1080p
 *  px), as large as fits, centered there; for framing content between a headline and a caption. */
export function fit(THREE, b, { top = 230, bottom = 860, side = 120, lens = 85, tilt = 0 } = {}) {
  const s = Math.min((bottom - top) / b.h, (1920 - 2 * side) / b.w); // screen px per flow px
  const d = (lens * (1080 / s)) / SENS_H;
  const yc = (top + bottom) / 2;
  const look = new THREE.Vector3(b.x + b.w / 2, -(b.y + b.h / 2) + (yc - 540) / s, 0);
  const a = (tilt * Math.PI) / 180;
  return [look.clone().add(new THREE.Vector3(0, -Math.sin(a) * d, Math.cos(a) * d)), look, lens, 16];
}

/** The union of flow boxes. */
export const union = (...bs) => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};

/** A comparison clip: the same task done in a spreadsheet, then in Solenoid. The camera frames the sheet, pans to
 *  the graph, then pulls back to both under a closing line. Each side has its own timeline of steps:
 *    { t, state?, caption?, at?, click? }
 *  `state` switches that side to a captured state at t (the sheet's states are scene.json's sheet.states, the
 *  graph's the capture's); `caption` replaces the step line; `at` moves the pointer there (a sheet cell like "B4",
 *  or a function of the helpers returning a flow point) arriving at t, and `click` presses it.
 *  spec: { headline, kicker, duration, end, sheet: { from, to, steps }, graph: { from, to, steps, box?, intro? } } */
export function compare(player, spec) {
  const { THREE, data, cards, pieces, cables } = player;
  const sheetCard = cards.Spreadsheet;
  const graphCards = Object.values(cards).filter((g) => g !== sheetCard && !g.userData.title.endsWith("(table)"));
  const lastState = data.states[data.states.length - 1].name;
  // a side's stepper: one start time per state after the first, from the steps that name them
  const side = (names, steps) => {
    const at = new Map(steps.filter((s) => s.state).map((s) => [s.state, s.t]));
    for (const n of names.slice(1)) if (!at.has(n)) throw new Error(`no step switches to state ${n}`);
    return stepper(names, { times: names.slice(1).map((n) => at.get(n)) });
  };
  const sheetStep = side(data.sheetStates, spec.sheet.steps);
  const graphStep = side(data.states.map((s) => s.name), spec.graph.steps);
  const flow = causal({ cards, cables, pieces, stepAt: graphStep, view: spec.graph.view });

  // a card's largest extent over every state (a card grows as sockets appear), from its pieces
  const extent = (title) => {
    const ps = cards[title].userData.pieces;
    if (!ps.length) return cards[title].userData.box;
    const xs = ps.flatMap((m) => [m.userData.center[0] - m.userData.size[0] / 2, m.userData.center[0] + m.userData.size[0] / 2]);
    const ys = ps.flatMap((m) => [m.userData.center[1] - m.userData.size[1] / 2, m.userData.center[1] + m.userData.size[1] / 2]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const help = {
    cell: (ref) => { const [x, y, w, h] = sheetCard.userData.cells[ref]; return [x + w * 0.55, y + h * 0.6]; },
    /** the union of some cards' boxes, for a step's `frame` */
    box: (...titles) => union(...titles.map(extent)),
    /** a point in the formula bar, `fx` of the way across */
    bar: (fx = 0.1) => { const [x, y, w, h] = sheetCard.userData.cells.bar; return [x + w * fx, y + h * 0.6]; },
    card: (title, fx = 0.5, fy = 0.5) => { const b = cards[title].userData.box; return [b.x + b.w * fx, b.y + b.h * fy]; },
    /** a cable's end (0 at its source, 1 at its target), by the cards it joins */
    end: (from, to, which) => {
      const c = cables.find((k) => cardAt(cards, k.userData.ends[0]) === from && cardAt(cards, k.userData.ends[1]) === to);
      if (!c) throw new Error(`no cable ${from} → ${to}`);
      return c.userData.ends[which];
    },
    /** a piece's center: the first piece of `card` whose glyph run starts with `text`, in `state` */
    text: (card, text, state = lastState) => {
      const ps = pieces.filter((m) => m.userData.card === card && m.userData.in.includes(state) && m.userData.glyph).sort((a, b) => a.userData.order - b.userData.order);
      for (let i = 0; i + text.length <= ps.length; i++) {
        if ([...text].every((ch, k) => ps[i + k].userData.glyph === ch)) {
          const a = ps[i].userData, z = ps[i + text.length - 1].userData;
          return [(a.center[0] + z.center[0]) / 2, (a.center[1] + z.center[1]) / 2];
        }
      }
      throw new Error(`no "${text}" on ${card} in ${state}`);
    },
  };
  const target = (s) => (typeof s.at === "string" ? help.cell(s.at) : s.at(help));

  const sheetBox = sheetCard.userData.box;
  const graphBox = spec.graph.box ? spec.graph.box(help) : union(...graphCards.map((g) => g.userData.box));
  const both = union(sheetBox, graphBox);
  const { sheet: S, graph: G, end: E, duration: D } = spec;
  // a step with `frame` (a function of the helpers returning a flow box) moves the camera onto that box, arriving
  // at the step's time and holding until the next framing
  // each framing: the camera arrives at its time, holds (drifting in a touch) and leaves 0.6 s before the next
  const framed = (steps, arrive, dflt) => {
    const out = steps.filter((x) => x.frame).map((x) => [x.t, x.frame(help)]);
    if (!out.length || out[0][0] > arrive + 1.2) out.unshift([arrive, dflt]);
    return out;
  };
  const marks = [...framed(S.steps, 0, sheetBox), ...framed(G.steps, G.from + 0.5, graphBox), [E + 0.8, both, true]];
  const shots = [];
  marks.forEach(([t0, b, wide], i) => {
    const t1 = marks[i + 1]?.[0] ?? D;
    const opts = wide ? { top: 250, bottom: 840 } : {};
    shots.push([t0, ...fit(THREE, b, { ...opts, tilt: 3 })]);
    if (t1 - 0.6 > t0 + 0.1) shots.push([t1 - 0.6, ...fit(THREE, b, { ...opts, tilt: 2, side: wide ? 120 : 150 })]);
  });
  const shotAt = rig(THREE, shots, { eased: true });
  if (spec.graph.assemble) graphCards.forEach((g, i) => assemble(THREE, g, spec.graph.assemble + i * 0.12, { flat: true, wave: 0.45, piece: 0.35 }));

  function pose(t) {
    for (const m of pieces) if (!m.userData.state) enter(m, t);
    showState(pieces, (m) => (m.userData.card === "Spreadsheet" ? sheetStep(t) : flow.stateFor(m, t)), t);
    clearHeads(cables);
    wire(cables, graphStep, t, { intro: spec.graph.intro ?? (() => [0, 0]) });
    flow.pulse(t);
    flushHeads(cables);
    return shotAt(t);
  }

  // the pointer's path along one side's steps: it glides to each target and arrives at the step's time
  const pointerAt = (steps, t, from, to) => {
    const pts = steps.filter((s) => s.at);
    if (!pts.length || t < from || t > to) return null;
    let i = pts.findIndex((s) => s.t >= t);
    if (i === -1) i = pts.length - 1;
    const b = pts[i], a = pts[Math.max(0, i - 1)];
    const pb = target(b), pa = i === 0 ? pb : target(a);
    const u = inOut(clamp01((t - (b.t - 0.45)) / 0.4));
    const press = pts.reduce((m, s) => (s.click && Math.abs(t - s.t) < 0.12 ? Math.max(m, 1 - Math.abs(t - s.t) / 0.12) : m), 0);
    return { p: [lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u)], press, on: t > pts[0].t - 0.6 };
  };
  const captionAt = (steps, t, from, to) => {
    const cs = steps.filter((s) => s.caption);
    let cur = null, next = to;
    for (let i = 0; i < cs.length; i++) if (cs[i].t <= t) { cur = cs[i]; next = cs[i + 1]?.t ?? to; }
    return cur && t < to ? { text: cur.caption, a: cur.t, b: Math.min(next, to) } : null;
  };

  function overlay(t, { el, project, width }) {
    const st = stage(el, { width });
    st.show(st.headline, spec.headline, t, 0.1);
    const onSheet = t < G.from;
    if (t < E) st.show(st.eyebrow, onSheet ? "Spreadsheet" : "Solenoid", t, onSheet ? S.from : G.from, onSheet ? S.to : G.to);
    else st.eyebrow.style.opacity = "0";
    st.eyebrow.style.color = onSheet ? "#9aa0a6" : "#f5b914";
    const steps = onSheet ? S.steps : G.steps;
    const cap = captionAt(steps, t, onSheet ? S.from : G.from, onSheet ? S.to : G.to);
    if (cap) st.show(st.step, cap.text, t, cap.a, cap.b); else st.step.style.opacity = "0";
    if (t >= E) st.show(st.kicker, spec.kicker, t, E + 0.6); else st.kicker.style.opacity = "0";
    const pt = pointerAt(steps, t, onSheet ? S.from : G.from, onSheet ? S.to : G.to);
    st.point(pt && project(pt.p[0], pt.p[1]), !!pt?.on, pt?.press ?? 0);
    const top = (b) => project(b.x + b.w / 2, b.y - 14);
    st.tag(st.tagA, "Spreadsheet", top(sheetBox), "#9aa0a6", t, E + 0.5);
    st.tag(st.tagB, "Solenoid", top(graphBox), "#f5b914", t, E + 0.5);
    if (t < E) { st.tagA.style.opacity = "0"; st.tagB.style.opacity = "0"; }
  }

  return {
    pose, overlay,
    restError: (tt) => restError(pieces.filter((m) => !m.userData.card.endsWith("(table)")), pose, tt, graphStep(tt).name),
  };
}

/** The type layer for a single-subject clip: a headline from `at` and a closing line from `end`. */
export function titled({ headline, kicker, at = 0.1, end }) {
  return (t, { el, width }) => {
    const st = stage(el, { width });
    st.show(st.headline, headline, t, at);
    if (t >= end) st.show(st.kicker, kicker, t, end); else st.kicker.style.opacity = "0";
  };
}
