// [[C121]]
// Order total, 9.6 s: the four cards assemble from an exploded stack of their own layers, the cables draw on
// with hot heads, the Discount slider sweeps 0.15 → 0.40 through the app's own states (thumb, value and the
// hero total as the app laid each out), and the camera settles straight on, every piece back at rest.
import { assemble, drawCable, enter, helpers, pulses, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 9.6;

export function setup({ THREE, data, cards, pieces, cables }) {
  const { V, at, off, final } = helpers(THREE);
  const START = { "Unit price": 0.12, Quantity: 0.62, Discount: 0.94, "Order total": 1.4 };
  for (const [title, t0] of Object.entries(START)) assemble(THREE, cards[title], t0);
  const SWEEP = [4.55, 7.15];
  const stateAt = stepper(data.states.map((s) => s.name), { t0: SWEEP[0], t1: SWEEP[1] });
  const db = cards.Discount.userData.box;
  const fromDiscount = (c) => { const [x, y] = c.userData.ends[0]; return x >= db.x && x <= db.x + db.w + 20 && y >= db.y && y <= db.y + db.h; };

  // low and close across the cards, rising while the cables draw, holding the slider and the total through the
  // sweep, then straight on with the lens lengthening as it backs off
  const ref = data.reference;
  const center = at(ref), heroC = at(cards["Order total"].userData.hero ?? cards["Order total"].userData.box);
  const mid = at(db, 0.5, 0.72).add(heroC).multiplyScalar(0.5);
  const first = cards["Unit price"].userData.box, firstC = at(first), pq = V(first.x + 150, -(first.y + 170));
  const shotAt = rig(THREE, [
    [0.0, off(firstC, -0.9, -1.9, 2.3), off(firstC, 0.2, 0.3, 0), 28, 1.0],
    [1.5, off(pq, -1.7, -3.2, 3.7), off(pq, 0.6, 0.2, 0), 30, 1.1],
    [2.7, off(center, -1.4, -4.4, 5.0), off(center, 0.2, 0.3, 0), 34, 1.3],
    [3.9, off(center, 0.4, -4.0, 6.2), off(center, 0.4, 0.1, 0), 40, 1.6],
    [4.7, off(mid, 1.0, -4.2, 8.2), off(mid, 0.45, 0.5, 0), 40, 1.6],
    [7.0, off(mid, 0.5, -3.5, 7.8), off(mid, 0.5, 0.55, 0), 42, 1.9],
    [8.4, ...final(ref)],
    [duration, ...final(ref)],
  ]);

  function pose(t) {
    const cur = stateAt(t);
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, cur, t, { pop: 0 });
    cables.forEach((c, i) => {
      drawCable(c, t, 3.05 + i * 0.16, 0.75);
      if (fromDiscount(c)) pulses(c, t, SWEEP[0] - 0.05, SWEEP[1] + 0.2);
    });
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stateAt(t).name) };
}
