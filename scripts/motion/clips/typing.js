// [[C121]]
// Typing, 6.5 s, straight on: an empty Expression card, then SQRT(3^2 + 4^2) typed into it a key at a time.
// Each keystroke lands in the formula first and the rest of the card answers a beat later, in the app's own
// layout of that prefix: the stray S becomes a socket and a 0, an open bracket reads "Missing 1 closing
// parenthesis", the closing one lands on 5. Capture: scenes/typing.json.
import { assemble, enter, front, restError, rig, showState, stepper } from "./kit.js";

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
    [0.0, ...front(THREE, tall, { tilt: 6, margin: 1.5 })],
    [1.0, ...front(THREE, tall, { tilt: 5, margin: 1.3 })],
    [last + 0.4, ...front(THREE, tall, { tilt: 3, margin: 1.22 })],
    [last + 1.4, ...front(THREE, end, { margin: 1.15 })],
    [duration, ...front(THREE, end, { margin: 1.15 })],
  ]);

  function pose(t) {
    for (const m of pieces) if (!m.userData.state) { m.visible = true; enter(m, t); }
    showState(pieces, pick(t), t);
    return shotAt(t);
  }

  return { pose, restError: (t) => restError(pieces, pose, t, stepAt(t).name) };
}
