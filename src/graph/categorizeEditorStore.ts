// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";
import type { CategorizeNode } from "./nodeClasses";

interface CategorizeEditorState {
  node: CategorizeNode;
  title: string;
  accent?: string;
}

/** The open Categorize sorter, if any. */
export const categorizeEditor = createValueStore<CategorizeEditorState>();
