// [[C121]]
// Peek: one state of a capture at rest, straight on, every card in frame; for looking at a capture before
// a clip is written. The state is the URL's ?state= (the last one by default).
import { front, restError, rig, showState } from "./kit.js";

export const fps = 30;
export const duration = 1;

export function setup({ THREE, data, cards, pieces, cables }) {
  const want = new URLSearchParams(location.search).get("state");
  const name = want ?? data.states[data.states.length - 1].name;
  const sheetName = data.sheetStates?.length ? data.sheetStates[data.sheetStates.length - 1] : null;
  const boxes = Object.values(cards).filter((g) => g.userData.pieces.some((m) => m.userData.in.includes(name) || m.userData.in.includes(sheetName))).map((g) => g.userData.box);
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const all = { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  const shotAt = rig(THREE, [[0, ...front(THREE, all, { margin: 1.06 })], [1, ...front(THREE, all, { margin: 1.06 })]]);
  const pose = () => {
    showState(pieces, (m) => ({ name: m.userData.card === "Spreadsheet" ? sheetName : name, since: 1 }), 0);
    for (const c of cables) { c.visible = c.userData.in.includes(name); c.material.uniforms.reveal.value = 1; }
    return shotAt(0);
  };
  return { pose, restError: (t) => restError(pieces, pose, t, name) };
}
