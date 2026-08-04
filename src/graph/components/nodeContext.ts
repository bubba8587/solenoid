import { createContext, useContext } from "react";

// Null outside a NodeShell — the intended "no Pin button there" behavior. Kept out of
// nodeKit because nodeKit imports the chips, and that cycle would be live at eval.
export const NodeFormatContext = createContext<string | null>(null);

/** The host node id for the subtree, or null outside a NodeShell. */
export const useHostNodeId = (): string | null => useContext(NodeFormatContext);
