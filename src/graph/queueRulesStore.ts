// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";
import type { GreedyQueueNode, LocalSearchNode } from "./nodeClasses";

interface QueueRulesState {
  node: GreedyQueueNode | LocalSearchNode;
  title: string;
  accent?: string;
}

/** Greedy Queue's and Local Search's rules popup, open on one card (tree/specs/canvas/config-popups.md). A card listens
 *  to its version too, so an edit there redraws the card's list of rules. */
export const queueRules = createValueStore<QueueRulesState>();
