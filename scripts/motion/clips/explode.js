// [[C121]]
// Exploded view, 10 s: the Order total card alone comes apart into its layers, one plane per depth of the
// element that painted it (the card body, then its rows, then their boxes, then the text and icons), the camera
// circles the stack, the layers fall back together, and the rest of the graph assembles around it before the
// camera settles straight on with every piece at rest. Capture: scenes/order-total.json.
import { assemble, clamp01, drawCable, enter, expoOut, helpers, inOut, restError, rig, showState } from "./kit.js";

export const fps = 60;
export const duration = 10;

export function setup({ THREE, data, cards, pieces, cables }) {
  const { V, at, final } = helpers(THREE);
  const HERO = cards["Order total"];
  const SPACING = 60; // flow px between layers
  const OPEN = [0.7, 2.3], CLOSE = [5.7, 6.9];
  const heroPieces = HERO.userData.pieces.filter((m) => !m.userData.state);
  const depths = heroPieces.map((m) => m.userData.depth);
  const dMin = Math.min(...depths), dMax = Math.max(...depths);
  // the rest of the graph comes in once the card is whole again
  const OTHERS = { "Unit price": 6.5, Quantity: 6.75, Discount: 7.0 };
  for (const [title, t0] of Object.entries(OTHERS)) assemble(THREE, cards[title], t0, { wave: 0.55, piece: 0.45, glyphSweep: 0.2 });

  const lift = (m, t) => {
    const k = (m.userData.depth - dMin) / Math.max(1, dMax - dMin);
    const open = expoOut(clamp01((t - OPEN[0] - 0.5 * k) / (OPEN[1] - OPEN[0] - 0.5)));
    const close = inOut(clamp01((t - CLOSE[0] - 0.45 * (1 - k)) / (CLOSE[1] - CLOSE[0] - 0.45)));
    return (m.userData.depth - dMin) * SPACING * open * (1 - close);
  };

  // circle the stack: keys every 0.35 s around 130°, rising a little, then out to the whole graph
  const b = HERO.userData.box, c = at(b);
  const stackMid = c.clone().add(V(0, 0, ((dMax - dMin) * SPACING) / 2));
  const orbit = (t, look, deg, elev, dist, lens, f) => {
    const th = (deg * Math.PI) / 180, ph = (elev * Math.PI) / 180;
    return [t, look.clone().add(V(Math.sin(th) * Math.cos(ph) * dist, -Math.cos(th) * Math.cos(ph) * dist, Math.sin(ph) * dist)), look, lens, f];
  };
  const shots = [orbit(0, c, -20, 58, 950, 50, 2.2), orbit(0.7, c, -24, 52, 1000, 50, 2.0)];
  for (let t = 1.4; t <= 5.6; t += 0.35) {
    const u = inOut((t - 1.4) / 4.2);
    shots.push(orbit(t, stackMid, -30 + 140 * u, 30 + 14 * Math.sin(Math.PI * u), 1250, 50, 2.4));
  }
  shots.push(orbit(6.6, c, 95, 55, 1150, 50, 2.0));
  shots.push([8.3, ...final(data.reference)], [duration, ...final(data.reference)]);
  const shotAt = rig(THREE, shots);

  function pose(t) {
    for (const m of pieces) {
      const p = m.userData;
      if (p.state) { m.visible = false; continue; }
      m.visible = true;
      if (p.card === "Order total") { m.position.copy(p.rest); m.position.z = lift(m, t); m.scale.set(1, 1, 1); m.rotation.set(0, 0, 0); }
      else enter(m, t);
    }
    showState(pieces, { name: data.states[0].name, since: 1 }, t);
    cables.forEach((cb, i) => drawCable(cb, t, 7.7 + i * 0.14, 0.6));
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, data.states[0].name) };
}
