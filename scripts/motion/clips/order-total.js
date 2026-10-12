// [[C121]]
// Order total, 9.6 s at 60 fps: the four cards assemble from an exploded stack of their own layers, the cables
// draw on with hot heads, the Discount slider sweeps 0.15 → 0.40 through the app's own states (thumb, value and
// the hero total as the app laid each out), and the camera settles straight on with a long lens, every piece
// back on its rest place. A pure function of time: pose(t) sets the scene and returns the camera shot.
export const fps = 60;
export const duration = 9.6;

const expoOut = (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
const backOut = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const inOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const lerp = (a, b, u) => a + (b - a) * u;
// piecewise-linear through [t, v] keys
const keys = (ks, t) => {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) return lerp(ks[i - 1][1], ks[i][1], (t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0]));
  return ks[ks.length - 1][1];
};

export function setup({ THREE, data, cards, pieces, cables }) {
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  const at = (b, fx = 0.5, fy = 0.5) => V(b.x + b.w * fx, -(b.y + b.h * fy));
  const CARD_START = { "Unit price": 0.12, Quantity: 0.62, Discount: 0.94, "Order total": 1.4 };
  const WAVE = 0.95, PIECE = 0.55;
  const CABLE_START = 3.05, CABLE_STAGGER = 0.16, CABLE_DRAW = 0.75;
  const SWEEP = [4.55, 7.15];
  const states = data.states.map((s) => s.name);

  // ---- each piece's entrance: when, from where, how it eases ----
  for (const grp of Object.values(cards)) {
    const { box: b, title } = grp.userData;
    const n = Math.max(...grp.userData.pieces.map((m) => m.userData.order)) + 1;
    for (const m of grp.userData.pieces) {
      const p = m.userData;
      const [cx, cy] = p.center, [w, h] = p.size;
      const u = (cy - b.y) / b.h, v = (cx - b.x) / b.w;
      const big = w * h > 0.35 * b.w * b.h || (w > 0.9 * b.w && (p.kind === "border" || p.kind === "stroke") && h > 0.5 * b.h);
      if (big) { // the card body and its frame unfold from the header line down
        p.anim = { t0: CARD_START[title], dur: 0.42, ease: expoOut, unfold: (b.h / 2 - (cy - b.y)) };
      } else {
        const lift = (0.35 + 1.9 * p.order / n) * 100;
        p.anim = {
          t0: CARD_START[title] + 0.12 + WAVE * u + (p.glyph ? 0.3 : 0.1) * v,
          dur: p.glyph ? 0.32 : PIECE,
          ease: p.part === "socket" ? backOut : expoOut,
          from: V((cx - (b.x + b.w / 2)) * 0.35, -(cy - (b.y + b.h / 2)) * 0.35, lift),
          spin: (p.glyph ? 0.35 : 0.12) * (p.order % 2 ? 1 : -1),
        };
      }
    }
  }

  // ---- the sweep: which state is on screen at t ----
  const stateAt = (t) => (t < SWEEP[0] ? states[0] : states[Math.min(states.length - 1, Math.round(inOut(clamp01((t - SWEEP[0]) / (SWEEP[1] - SWEEP[0]))) * (states.length - 1)))]);
  const db = cards.Discount.userData.box;
  const discCables = cables.filter((c) => { const [x, y] = c.userData.ends[0]; return x >= db.x && x <= db.x + db.w + 20 && y >= db.y && y <= db.y + db.h; });

  // ---- camera: low and close across the cards, rising while the cables draw, holding the slider and the total
  // through the sweep, then straight on with the lens lengthening as it backs off ----
  const ref = data.reference;
  const center = at(ref);
  const hero = cards["Order total"].userData.hero ?? cards["Order total"].userData.box;
  const heroC = at(hero), discC = at(db, 0.5, 0.72), mid = discC.clone().add(heroC).multiplyScalar(0.5);
  const first = cards["Unit price"].userData.box;
  const firstC = at(first), pq = V(first.x + 150, -(first.y + 170));
  const sensH = 36 * 9 / 16, finalLens = 180;
  const final = center.clone().add(V(0, 0, (finalLens * ref.h * 1.06) / sensH));
  const C = (v, x, y, z) => v.clone().add(V(x * 100, y * 100, z * 100));
  const SHOTS = [
    [0.0, C(firstC, -0.9, -1.9, 2.3), C(firstC, 0.2, 0.3, 0), 28, 1.0],
    [1.5, C(pq, -1.7, -3.2, 3.7), C(pq, 0.6, 0.2, 0), 30, 1.1],
    [2.7, C(center, -1.4, -4.4, 5.0), C(center, 0.2, 0.3, 0), 34, 1.3],
    [3.9, C(center, 0.4, -4.0, 6.2), C(center, 0.4, 0.1, 0), 40, 1.6],
    [4.7, C(mid, 1.0, -4.2, 8.2), C(mid, 0.45, 0.5, 0), 40, 1.6],
    [7.0, C(mid, 0.5, -3.5, 7.8), C(mid, 0.5, 0.55, 0), 42, 1.9],
    [8.4, final, center, finalLens, 16],
    [duration, final, center, finalLens, 16],
  ];
  // Each shot as look point, view direction, framed height and lens: the eye sits at the distance that frames
  // that height through that lens, so a lens change mid-move is a smooth dolly-zoom, never a size wobble.
  const KEYS = SHOTS.map(([t, eye, lookAt, lens, fstop]) => {
    const off = eye.clone().sub(lookAt), dist = off.length();
    return { t, look: lookAt, dir: off.normalize(), logH: Math.log((dist * sensH) / lens), logLens: Math.log(lens), logF: Math.log(fstop) };
  });
  // Catmull-Rom through the keys
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
  const shotAt = (t) => {
    const look = spline((k) => k.look, t), dir = spline((k) => k.dir, t).normalize();
    const lens = Math.exp(spline((k) => k.logLens, t));
    const eye = look.clone().addScaledVector(dir, (lens * Math.exp(spline((k) => k.logH, t))) / sensH);
    return { eye, look, lens, fstop: Math.exp(spline((k) => k.logF, t)) };
  };

  function pose(t) {
    // pieces
    const cur = stateAt(t);
    for (const m of pieces) {
      const p = m.userData, a = p.anim;
      m.visible = p.state ? p.state === cur : !p.replacedIn.includes(cur);
      if (p.state) { m.position.copy(p.rest); m.scale.set(1, 1, 1); m.rotation.set(0, 0, 0); continue; }
      const u = a.ease(clamp01((t - a.t0) / a.dur));
      if (a.unfold !== undefined) {
        m.position.set(p.rest.x, p.rest.y + a.unfold * (1 - u), 0);
        m.scale.set(1, Math.max(1e-3, u), 1);
      } else {
        m.position.copy(p.rest).addScaledVector(a.from, 1 - u);
        const s = Math.max(1e-3, u);
        m.scale.set(s, s, s);
        m.rotation.set(0, 0, a.spin * (1 - u));
      }
    }
    // cables: draw on, a hot head riding the tip; during the sweep a pulse runs down the Discount cable per beat
    cables.forEach((c, i) => {
      const t0 = CABLE_START + i * CABLE_STAGGER;
      const un = c.material.uniforms;
      un.reveal.value = keys([[t0, 0], [t0 + CABLE_DRAW, 1]], t);
      un.pulse.value = keys([[t0, -0.2], [t0 + CABLE_DRAW, 1.0], [t0 + CABLE_DRAW + 0.35, 1.4]], t);
      if (discCables.includes(c) && t > SWEEP[0] - 0.05 && t < SWEEP[1] + 0.5) {
        const k = (t - (SWEEP[0] - 0.05)) % 0.3;
        if (t - k < SWEEP[1] + 0.2) un.pulse.value = lerp(-0.15, 1.15, k / 0.3);
      }
    });
    return shotAt(t);
  }

  /** How far any piece sits from its rest place at t (the rest check: 0 at the last frame). */
  function restError(t) {
    pose(t);
    let worst = 0;
    for (const m of pieces) if (m.visible) worst = Math.max(worst, m.position.distanceTo(m.userData.rest), Math.abs(1 - m.scale.x), Math.abs(1 - m.scale.y), Math.abs(m.rotation.z));
    return { worst, state: stateAt(t) };
  }

  return { pose, restError, stateAt };
}
