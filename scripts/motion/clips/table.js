// [[C121]]
// Table, 9 s: an Orders frame assembles row by row, Line totals and Grand total build beside it, the cables
// draw, then the Chair quantity climbs 4 → 10 one order at a time, each step a pulse down both cables and the
// app's own new total (1420 → 1930) popping in. The camera runs low along the table, follows the chain, holds
// the edited cell and the total together, and settles straight on. Capture: scenes/table.json.
import { assemble, drawCable, enter, helpers, restError, rig, showState, stepper } from "./kit.js";

export const fps = 60;
export const duration = 9;

export function setup({ THREE, data, cards, pieces, cables }) {
  const { V, at, off, final } = helpers(THREE);
  const orders = cards.Orders, cols = cards["Line totals"], total = cards["Grand total"];
  assemble(THREE, orders, 0.1, { wave: 1.3 });
  assemble(THREE, cols, 1.25, { wave: 0.6 });
  assemble(THREE, total, 1.7, { wave: 0.6 });
  const names = data.states.map((s) => s.name);
  const STEP0 = 4.3, STEP = 0.36;
  const times = names.slice(1).map((_, i) => STEP0 + i * STEP);
  const stateAt = stepper(names, { times });
  // cables in flow order: frame → column first
  const ordered = [...cables].sort((a, b) => a.userData.ends[0][0] - b.userData.ends[0][0]);

  const ob = orders.userData.box, tb = total.userData.box;
  const chair = (() => { // the edited cell: the state pieces that change inside the Orders card
    const ps = pieces.filter((m) => m.userData.state && m.userData.card === "Orders");
    const c = ps.reduce((a, m) => a.add(V(m.userData.center[0], -m.userData.center[1])), V(0, 0)).multiplyScalar(1 / Math.max(1, ps.length));
    return ps.length ? c : at(ob);
  })();
  const totalC = at(total.userData.hero ?? tb);
  const both = chair.clone().add(totalC).multiplyScalar(0.5);
  const shotAt = rig(THREE, [
    [0.0, off(at(ob, 0.1, 0.6), -1.1, -2.1, 2.7), at(ob, 0.45, 0.55), 30, 1.2],
    [1.6, off(at(ob, 0.6, 0.5), -0.6, -2.8, 3.2), at(ob, 0.9, 0.45), 32, 1.3],
    [3.0, off(at(data.reference), 0.4, -5.0, 6.4), at(data.reference, 0.55, 0.4), 34, 1.6],
    [4.2, off(both, 0.3, -5.0, 8.6), both, 36, 1.7],
    [6.6, off(both, -0.2, -4.6, 8.2), both.clone().add(V(20, 0)), 38, 1.9],
    [7.8, ...final(data.states[data.states.length - 1].box)],
    [duration, ...final(data.states[data.states.length - 1].box)],
  ]);

  function pose(t) {
    const cur = stateAt(t);
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, cur, t);
    ordered.forEach((c, i) => {
      drawCable(c, t, 2.9 + i * 0.25, 0.6);
      // each edit runs down the chain: frame → column, then column → total
      for (const tk of times) {
        const t0 = tk - 0.05 + i * 0.16;
        if (t >= t0 && t < t0 + 0.32) c.material.uniforms.pulse.value = -0.15 + 1.3 * ((t - t0) / 0.32);
      }
    });
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stateAt(t).name) };
}
