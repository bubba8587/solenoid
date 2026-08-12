import { useSyncExternalStore } from "react";
import { createNotifier } from "./storeKit";

export type CableShape = "spline" | "straight" | "diagonal";

export const CABLE_SHAPES: { value: CableShape; label: string }[] = [
  { value: "diagonal", label: "Diagonal" },
  { value: "spline", label: "Spline" },
  { value: "straight", label: "Straight" },
];

let _shape: CableShape = "diagonal";
const { notify, subscribe } = createNotifier();

const LS_KEY = "solenoid.cableShape";

function isCableShape(v: unknown): v is CableShape {
  return v === "spline" || v === "straight" || v === "diagonal";
}

function persist() {
  try { localStorage.setItem(LS_KEY, _shape); }
  catch { /* private mode / quota — non-fatal */ }
}

export const cableShapeStore = {
  get: (): CableShape => _shape,
  set: (s: CableShape) => {
    _shape = s;
    persist();
    notify();
  },
  subscribe,
};

/** Read the persisted cable shape. Call once at startup. */
export function initCableShape() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (isCableShape(saved)) _shape = saved;
  } catch { /* ignore */ }
}

export function useCableShape(): { shape: CableShape; setShape: (s: CableShape) => void } {
  const shape = useSyncExternalStore(cableShapeStore.subscribe, cableShapeStore.get);
  return {
    shape,
    setShape: (s: CableShape) => cableShapeStore.set(s),
  };
}
