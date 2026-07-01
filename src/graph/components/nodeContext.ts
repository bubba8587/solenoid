import { createContext, useContext } from "react";

// The id of the node currently rendering its body. NodeShell provides it; deep
// children read it without prop-threading. Two consumers today: a value box looks
// up a docked Format Controller's annotation (local-display formatting), and the
// value chips / formula expand button tag the popup they open with their host node
// so the popup can offer the Pin action. Null when a child renders outside a
// NodeShell (a HUD pin chip, a collapsed-group readout) — then there's no host to
// format-for or pin, which is the intended "no Pin button there" behavior.
//
// Lives in its own module (not nodeKit) so the chips can read it without importing
// nodeKit, which imports the chips — that cycle would otherwise be live at module
// eval.
export const NodeFormatContext = createContext<string | null>(null);

/** The host node id for the subtree, or null outside a NodeShell. */
export const useHostNodeId = (): string | null => useContext(NodeFormatContext);
