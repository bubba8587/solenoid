// [[C77]] compositeIsSubgraph
import { createContext, useContext } from "react";

// Null outside a NodeShell (no Pin button there); kept out of nodeKit, which imports the chips, or the cycle is live at eval.
export const NodeFormatContext = createContext<string | null>(null);

export const useHostNodeId = (): string | null => useContext(NodeFormatContext);
