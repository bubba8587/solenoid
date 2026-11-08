// [[B19]] spreadsheetHabits, [[engineering#Performance]]. The selection mirror (react-flow-surface-contract § Selection).

type Selectable = { selected?: boolean };
export type SelectionState = {
  nodes: readonly unknown[];
  edges: readonly unknown[];
  nodeLookup: ReadonlyMap<string, Selectable>;
  edgeLookup: ReadonlyMap<string, Selectable>;
};
type SelectionStore = {
  getState(): SelectionState;
  subscribe(listener: (state: SelectionState) => void): () => void;
};

type Readable<T> = { getState(): T; subscribe(listener: () => void): () => void };

/** RF keeps nodes and edges in two stores; the mirror reads them as one. */
export function rfSelectionSource(
  nodes: Readable<Pick<SelectionState, "nodes" | "nodeLookup">>,
  edges: Readable<Pick<SelectionState, "edges" | "edgeLookup">>,
): SelectionStore {
  const getState = (): SelectionState => {
    const { nodes: n, nodeLookup } = nodes.getState();
    const { edges: e, edgeLookup } = edges.getState();
    return { nodes: n, edges: e, nodeLookup, edgeLookup };
  };
  return {
    getState,
    subscribe(listener) {
      const offNodes = nodes.subscribe(() => listener(getState()));
      const offEdges = edges.subscribe(() => listener(getState()));
      return () => { offNodes(); offEdges(); };
    },
  };
}

function selectedIds(lookup: ReadonlyMap<string, Selectable>): string[] {
  const ids: string[] = [];
  for (const [id, item] of lookup) if (item.selected) ids.push(id);
  return ids;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Calls `onChange` now and whenever the selected node or edge ids change. The scan runs only on an update that hands RF new
 *  `nodes` or `edges` arrays, which every selection change does on a controlled flow; a camera update skips it. */
export function mirrorSelection(store: SelectionStore, onChange: (nodeIds: string[], edgeIds: string[]) => void): () => void {
  let nodes: unknown = null;
  let edges: unknown = null;
  let last: { n: string[]; e: string[] } | null = null;
  const check = (s: SelectionState) => {
    if (s.nodes === nodes && s.edges === edges) return;
    nodes = s.nodes;
    edges = s.edges;
    const n = selectedIds(s.nodeLookup);
    const e = selectedIds(s.edgeLookup);
    if (last && sameIds(n, last.n) && sameIds(e, last.e)) return;
    last = { n, e };
    onChange(n, e);
  };
  check(store.getState());
  return store.subscribe(check);
}
