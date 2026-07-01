import { useEffect, useState } from "react";
import { createNotifier } from "./storeKit";

export type CableShape = "spline" | "straight" | "diagonal";

export const CABLE_SHAPES: { value: CableShape; label: string }[] = [
  { value: "diagonal", label: "Diagonal" },
  { value: "spline", label: "Spline" },
  { value: "straight", label: "Straight" },
];

// Module-level store so ConnectionComponent (rendered in Rete's own
// React root) can read the shape without access to the main React tree.
let _shape: CableShape = "diagonal";
const { notify, subscribe } = createNotifier();

export const cableShapeStore = {
  get: (): CableShape => _shape,
  set: (s: CableShape) => {
    _shape = s;
    notify();
  },
  subscribe,
};

export function useCableShape(): { shape: CableShape; setShape: (s: CableShape) => void } {
  const [shape, setShapeState] = useState<CableShape>(_shape);
  useEffect(() => cableShapeStore.subscribe(() => setShapeState(cableShapeStore.get())), []);
  return {
    shape,
    setShape: (s: CableShape) => cableShapeStore.set(s),
  };
}
