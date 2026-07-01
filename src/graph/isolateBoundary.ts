// Boundary analysis for the Isolate overlay (and, later, Portal nodes): given a
// focus set, which connections cross its boundary? Entry = an outside output
// feeding a focused input (rendered on the LEFT); exit = a focused output feeding
// an outside input (rendered on the RIGHT). The overlay turns each side into an
// auto-generated endpoint — a Conduit when several lanes cross, a single socket
// when one — and the future Portal node pair will reuse the same endpoints +
// styling (an exit portal publishes a focused output to a named store; an entry
// portal selects one to read). Pure + testable; no editor/DOM.

export interface BoundaryCrossing {
  connId: string;
  focusNodeId: string;   // the focused node at the boundary
  focusSocket: string;   // its input socket (entry) or output socket (exit)
  externalNodeId: string;
  externalSocket: string;
}

export interface IsolateBoundary {
  entry: BoundaryCrossing[]; // inbound: external output → focused input  (left)
  exit: BoundaryCrossing[];  // outbound: focused output → external input (right)
}

type Conn = { id: string; source: string; sourceOutput: string; target: string; targetInput: string };

export function boundaryCrossings(
  focus: ReadonlySet<string>,
  connections: ReadonlyArray<Conn>,
): IsolateBoundary {
  const entry: BoundaryCrossing[] = [];
  const exit: BoundaryCrossing[] = [];
  for (const c of connections) {
    const sIn = focus.has(c.source);
    const tIn = focus.has(c.target);
    if (sIn === tIn) continue; // both inside (internal) or both outside — not a boundary
    if (tIn) {
      entry.push({ connId: c.id, focusNodeId: c.target, focusSocket: c.targetInput, externalNodeId: c.source, externalSocket: c.sourceOutput });
    } else {
      exit.push({ connId: c.id, focusNodeId: c.source, focusSocket: c.sourceOutput, externalNodeId: c.target, externalSocket: c.targetInput });
    }
  }
  return { entry, exit };
}
