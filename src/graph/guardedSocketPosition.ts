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
 * rete's socket-position watcher de-dupes records only WITHIN an element and
 * relies on an `unmount` that never arrives when React swaps a socket's span, so
 * two elements end up recorded for one (node, key, side). `add` is wrapped to
 * evict the older element — patching the storage rather than calculatePosition,
 * because the orphan is sometimes still DOM-connected.
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

/** Drop-in replacement for `getDOMSocketPosition` that keeps exactly one element
 *  per socket; same `offset` prop. */
export function getGuardedSocketPosition<Schemes extends BaseSchemes, K>(
  props?: { offset?: Offset },
): DOMSocketPosition<Schemes, K> {
  return new GuardedSocketPosition<Schemes, K>(props);
}
