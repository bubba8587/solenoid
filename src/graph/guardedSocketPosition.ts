import { DOMSocketPosition } from "rete-render-utils";
import type { BaseSchemes } from "rete";

type Side = "input" | "output";
type Position = { x: number; y: number };
type Offset = (position: Position, nodeId: string, side: Side, key: string) => Position;

type SocketRecord = { element: HTMLElement; side: Side; key: string; nodeId: string; position: Position };
type Storage = {
  elements: Map<HTMLElement, SocketRecord[]>;
  add(data: SocketRecord): void;
  remove(element: HTMLElement): void;
};

/**
 * rete's DOM socket-position watcher stores one record per DOM element keyed by
 * that element, and `add` only de-dupes records *within the same element*. It
 * relies on an `unmount` event to drop an element's records. But a socket can be
 * re-rendered into a NEW DOM node without an `unmount` reaching the watcher for
 * the OLD node (React reusing the component instance while swapping the span,
 * which our measured/cull-wrapped rows provoke). Both elements then carry a
 * record for the same (node, key, side), and `getPosition` — called for every
 * connection endpoint on each reposition — finds two and logs "Found more than
 * one element for socket with same key and side." It's a bookkeeping leak: the
 * orphan records are never collected and are rescanned on every cable update.
 *
 * Fix: wrap the storage's `add` so that adding an element for a socket first
 * evicts every OTHER element previously recorded for that same (node, key,
 * side). The most recently rendered element wins, so the store holds exactly one
 * element per socket and the warning can never fire. (Done by patching the
 * instance's storage rather than overriding calculatePosition, because the
 * orphan element is sometimes still attached to the DOM — so an isConnected
 * check wouldn't catch it.)
 */
class GuardedSocketPosition<Schemes extends BaseSchemes, K> extends DOMSocketPosition<Schemes, K> {
  constructor(props?: { offset?: Offset }) {
    super(props);
    const storage = this.sockets as unknown as Storage;
    const add = storage.add.bind(storage);
    storage.add = (data: SocketRecord) => {
      for (const [el, records] of storage.elements) {
        if (el === data.element) continue;
        if (records.some((r) => r.nodeId === data.nodeId && r.key === data.key && r.side === data.side)) {
          storage.remove(el);
        }
      }
      add(data);
    };
  }
}

/**
 * Drop-in replacement for `getDOMSocketPosition` that keeps exactly one element
 * per socket — see GuardedSocketPosition. Same `offset` prop.
 */
export function getGuardedSocketPosition<Schemes extends BaseSchemes, K>(
  props?: { offset?: Offset },
): DOMSocketPosition<Schemes, K> {
  return new GuardedSocketPosition<Schemes, K>(props);
}
