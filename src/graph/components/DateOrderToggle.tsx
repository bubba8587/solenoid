// [[B19]] spreadsheetHabits, [[frame-verbs#Type inference]]
import { SegToggle } from "./SegToggle";
import { useNodeField } from "./nodeKit";
import { DATE_ORDER_OPTIONS, type DateOrder } from "../dateOrder";

/** The order a card reads dates written in numbers alone by: Auto, MDY, DMY or YMD. */
export function DateOrderToggle<N extends { id: string; edited(): void; dateOrder: DateOrder }>({ node }: { node: N }) {
  const [order, setOrder] = useNodeField(node, "dateOrder");
  return <SegToggle value={order as DateOrder} options={DATE_ORDER_OPTIONS} onChange={(next) => setOrder(next as N["dateOrder"])} />;
}
