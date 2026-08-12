// Isolate-overlay boundary analysis: entry = an outside output feeding a focused
// input (rendered LEFT); exit = a focused output feeding an outside input (RIGHT).

export interface BoundaryCrossing {
  connId: string;
  focusNodeId: string;
  focusSocket: string;   // input socket on an entry, output socket on an exit
  externalNodeId: string;
  externalSocket: string;
}

export interface IsolateBoundary {
  entry: BoundaryCrossing[];
  exit: BoundaryCrossing[];
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
    if (sIn === tIn) continue;
    if (tIn) {
      entry.push({ connId: c.id, focusNodeId: c.target, focusSocket: c.targetInput, externalNodeId: c.source, externalSocket: c.sourceOutput });
    } else {
      exit.push({ connId: c.id, focusNodeId: c.source, focusSocket: c.sourceOutput, externalNodeId: c.target, externalSocket: c.targetInput });
    }
  }
  return { entry, exit };
}
