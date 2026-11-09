// [[C121]]
// Typing, 6.5 s, straight on: an empty Expression card, then SQRT(3^2 + 4^2) typed into it a key at a time.
// Each keystroke lands in the formula first and the rest of the card answers a beat later, in the app's own
// layout of that prefix: the stray S becomes a socket and a 0, an open bracket reads "Missing 1 closing
// parenthesis", the closing one lands on 5. Capture: scenes/typing.json.
import { assemble, enter, fit, restError, rig, showState, stepper, titled } from "./kit.js";

export const fps = 60;
export const duration = 6.5;
const ANSWER_LAG = 0.16; // s: the card answers just after the keystroke

export function setup({ THREE, data, cards, pieces }) {
  const card = Object.values(cards)[0];
  assemble(THREE, card, 0.1, { flat: true, wave: 0.5, piece: 0.4 });
  const names = data.states.map((s) => s.name);
  // a typist's rhythm: quick runs, a pause before the brackets and the operator
  const gaps = [0.3, 0.16, 0.11, 0.13, 0.26, 0.12, 0.17, 0.11, 0.3, 0.14, 0.17, 0.11, 0.28];
  const times = [];
  let t = 1.0;
  for (const g of gaps.slice(0, names.length - 1)) times.push((t += g));
  const stepAt = stepper(names, { times });
  const pick = (t) => (m) => stepAt(m.userData.part === "formula" ? t : t - ANSWER_LAG);

  // frame the tallest the card gets (the stray S adds a socket row)
  const b = card.userData.box, end = data.states[data.states.length - 1].box;
  const tall = { ...b, h: Math.max(...data.states.map((s) => s.box.h - 56)) };
  const last = times[times.length - 1];
  const shotAt = rig(THREE, [
    [0.0, ...fit(THREE, tall, { tilt: 4 })],
    [last + 0.6, ...fit(THREE, tall, { tilt: 2, side: 160 })],
    [last + 1.5, ...fit(THREE, end)],
    [duration, ...fit(THREE, end, { side: 160 })],
  ], { eased: true });

  function pose(t) {
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, pick(t), t);
    return shotAt(t);
  }

  const overlay = titled({ headline: "Type a formula", kicker: "The card recalculates with every key, and an error says what is missing.", end: last + 0.8 });
  return { pose, overlay, restError: (t) => restError(pieces, pose, t, stepAt(t).name) };
}
