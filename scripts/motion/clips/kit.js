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
 *  opts: { wave = 0.95, piece = 0.55, glyphSweep = 0.3, lift = 1 } */
export function assemble(THREE, grp, t0, opts = {}) {
  const { wave = 0.95, piece = 0.55, glyphSweep = 0.3, lift = 1 } = opts;
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
      from: new THREE.Vector3((cx - (b.x + b.w / 2)) * 0.35, -(cy - (b.y + b.h / 2)) * 0.35, (0.35 + 1.9 * p.order / n) * 100 * lift),
      spin: (p.glyph ? 0.35 : 0.12) * (p.order % 2 ? 1 : -1),
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
  return (t) => { let k = 0; while (k < starts.length && t >= starts[k]) k++; return { name: states[k], prev: k ? states[k - 1] : null, since: k ? t - starts[k - 1] : t, index: k }; };
}
function invEase(f, y) { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) < y) lo = mid; else hi = mid; } return (lo + hi) / 2; }

/** Show the pieces of the state on screen, each at its paint position in that state; a glyph that wasn't in the
 *  state before pops in (scale 1.35 → 1) as it lands. First-state pieces keep the transform `enter` gave them. */
export function showState(pieces, cur, t, { pop = 0.22 } = {}) {
  for (const m of pieces) {
    const p = m.userData;
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
export function rig(THREE, shots) {
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

/** A cable drawing on from its source over [t0, t0 + dur], its hot head running off the end after. */
export function drawCable(c, t, t0, dur) {
  const un = c.material.uniforms;
  un.reveal.value = keys([[t0, 0], [t0 + dur, 1]], t);
  un.pulse.value = keys([[t0, -0.2], [t0 + dur, 1.0], [t0 + dur + 0.35, 1.4]], t);
}

/** Pulses down a drawn cable: one every `every` seconds over [t0, t1], each taking `run` seconds. */
export function pulses(c, t, t0, t1, every = 0.3, run = 0.3) {
  if (t < t0 || t > t1 + run) return;
  const k = (t - t0) % every;
  if (t - k <= t1) c.material.uniforms.pulse.value = lerp(-0.15, 1.15, k / run);
}
