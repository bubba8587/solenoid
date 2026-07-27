import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type CSSProperties } from "react";
import type { ClassicPreset } from "rete";
import { repositionDockedNodes } from "../process";
import { getOwningArea } from "../activeGraph";
import { nodeKindOf, nodeResizable, nodeWide, NODE_KIND_ACCENTS } from "../rete-nodes";
import { nodeSizeStore } from "../nodeSizeStore";
import { collapseStore } from "../collapseStore";
import { groupMembershipStore } from "../groupMembership";
import { appThemeStore } from "../appTheme";
import { themeAccent, darkenAccent } from "../palette";
import { opKindForNode } from "../nodeOps";

// The whole node header is a drag surface; a pointer that moves less than this
// many px between down and up counts as a TAP (opens the title editor / toggles
// the chevron) rather than a drag. Shared with nodeKit's title label.
export const HEADER_TAP_SLOP = 4;

type Props = {
  selected?: boolean;
  // When supplied, the card reports its measured DOM size back to the
  // node instance + triggers a minimap re-render so the minimap
  // silhouettes match the real cards (rather than the hardcoded
  // defaults on each node class). Also drives the header accent color
  // via nodeKindOf — components pass the live node instance here.
  node?: { id: string; width: number; height: number };
  className?: string;
  /** Override the accent color derived from nodeKindOf. */
  accentOverride?: string;
  /** When false, the node can't collapse and no chevron is shown (e.g. Number
   *  input, Display, Angle Dial — there's no meaningful collapsed form). */
  collapsible?: boolean;
  /** Collapse to a headerless SQUARE (no header, no chevron — just the mini
   *  figure), expandable by double-click. For pure inline-viz nodes (Sparkline)
   *  where a labeled collapsed card reads as clutter. */
  squareCollapse?: boolean;
  children: ReactNode;
};

/**
 * Shared wrapper for every standard Solenoid node body. Provides:
 *
 *  1. The .solenoid-node card chrome (with selection modifier).
 *  2. A capture-phase pointer / mouse handler that stops native
 *     propagation for events targeting form fields (INPUT, TEXTAREA,
 *     SELECT, [contenteditable]). Without this, rete-area-plugin's
 *     per-node drag listener — which sits on the node element in
 *     bubble phase — sees the pointerdown, sets pointerStart, and
 *     then calls preventDefault on every subsequent pointermove,
 *     hijacking text-selection drag inside the input.
 *
 *     Capture is required (not bubble) because rete's native bubble
 *     listener fires BEFORE React's bubble-phase synthetic handlers
 *     reach the root. A native capture-phase listener on the card
 *     fires during the capture descent from root → target, before
 *     anything in bubble.
 */
export function NodeCard({ selected, node, className, accentOverride, collapsible = true, squareCollapse = false, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Pointer-down position on the chevron, to tell a tap (→ toggle) from a drag
  // (→ move the node) — the whole header, chevron included, is a drag handle.
  const chevronDownPos = useRef<{ x: number; y: number } | null>(null);
  const collapsed = useSyncExternalStore(
    collapseStore.subscribe,
    () => (node ? collapseStore.get(node.id) : false),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function isFormTarget(t: EventTarget | null): boolean {
      const target = t as HTMLElement | null;
      if (!target) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable ||
        // Any button (recalc, +/× input controls) — keep clicks from starting
        // a rete node drag (same reason as form fields). closest() so clicks on
        // a button's inner svg/text count too. The header chevron is exempt: the
        // whole header is a drag surface, so its pointerdown must reach rete; it
        // distinguishes a tap (toggle) from a drag itself (see the chevron below).
        !!target.closest("button:not(.solenoid-node__chevron)")
      );
    }
    function stop(e: Event) {
      if (isFormTarget(e.target)) e.stopPropagation();
    }
    el.addEventListener("pointerdown", stop, true);
    el.addEventListener("mousedown", stop, true);
    return () => {
      el.removeEventListener("pointerdown", stop, true);
      el.removeEventListener("mousedown", stop, true);
    };
  }, []);

  // Align output sockets with the node's result/display box: publish the box's
  // vertical center as `--out-socket-top`. box.offsetTop resolves against the
  // box's offsetParent — the .solenoid-node__content wrapper — so the value is
  // header-INDEPENDENT (the same origin the sockets anchor to). Output sockets
  // read this var (see NodeSocket); MeasuredSocketRow inputs pass explicit
  // (also content-relative) tops. Falls back to 50% of content when there's no box.
  function syncOutputSocketTop() {
    const el = ref.current;
    if (!el) return;
    // First VISIBLE box in document order: a collapsed node hides its figure
    // (display:none → offsetParent null), so skip it and land on the visible
    // collapsed hero box / chip instead of centering the output socket at 0.
    const boxes = el.querySelectorAll<HTMLElement>(
      ".solenoid-node__figure, .solenoid-node__display-value, .solenoid-node__value-input",
    );
    let box: HTMLElement | null = null;
    for (const b of boxes) { if (b.offsetParent !== null) { box = b; break; } }
    if (box) el.style.setProperty("--out-socket-top", `${box.offsetTop + box.offsetHeight / 2}px`);
    else el.style.removeProperty("--out-socket-top");
  }
  // Runs after every commit (cheap: one querySelector). Also covers the
  // collapse toggle, which re-lays-out the body.
  useLayoutEffect(syncOutputSocketTop);

  // Defensive: tidy now drops the height pin at the source (Canvas arrangeFn),
  // but clear it on collapse too in case a fixed inline `height` ever lingers on
  // the card (stamped via area.resize) — a direct DOM style React's collapse
  // re-render can't clear, which would keep the card full-height (inner content
  // hides but the body doesn't shrink). Clearing it lets the card reflow to its
  // value box.
  useLayoutEffect(() => {
    if (collapsed) ref.current?.style.removeProperty("height");
  }, [collapsed]);

  // Report rendered size back to the node instance so the minimap
  // silhouette matches reality. We update node.width/height directly
  // and ping `area.update("node", id)` — the minimap plugin listens
  // for 'render' on nodes and re-renders on each one.
  useEffect(() => {
    const el = ref.current;
    if (!el || !node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      syncOutputSocketTop();
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (w === node.width && h === node.height) return;
      node.width = w;
      node.height = h;
      // Update LIVE during a resize drag so cables re-route as the box grows —
      // the grip drags off window listeners + module state (not the element's
      // pointer capture), so recreating this node's DOM here doesn't drop it.
      // Owning area (not main): this card may live inside an open drill-in.
      void getOwningArea(node.id)?.update("node", node.id);
      // A resize can shift this node's sockets (e.g. a list display box grew a
      // row, moving the output socket down). Keep any docked FC aligned.
      repositionDockedNodes(node.id);
      // If THIS node is itself a docked FC, re-center it on its host now that
      // its real height is known. The dock math centers on height, and the
      // initial estimate (e.g. before a Decimal chip's extra row lays out) is
      // short — without this the chip lands ~15px low until something nudges it.
      const hostId = (node as { hostNodeId?: string }).hostNodeId;
      if (hostId) repositionDockedNodes(hostId);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [node]);

  // Header accent: resolve the node's kind → color. `node` is typed
  // minimally here but is the live instance at runtime, so instanceof
  // inside nodeKindOf works.
  // Re-render on theme change so the accent shift (light vs dark) is live.
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const mode = appThemeStore.getMode();
  const rawAccent = accentOverride ?? (node
    ? NODE_KIND_ACCENTS[nodeKindOf(node as unknown as ClassicPreset.Node)]
    : undefined);
  const accent = rawAccent ? themeAccent(rawAccent, mode) : undefined;
  // Subtle "inside a group" indicator: drop the drop-shadow and ring the node in
  // the group's color (low opacity). The color is published as a CSS var; the
  // grouped class applies the treatment (and yields to selection).
  useSyncExternalStore(groupMembershipStore.subscribe, groupMembershipStore.version);
  const groupColor = node ? groupMembershipStore.color(node.id) : undefined;

  // ─── Manual resize (resizable nodes only) ──────────────────────────────────
  // A persisted user size (set by the ResizeHandle inside the value box)
  // overrides the CSS fixed width / content height. We apply it as an inline
  // style; the ResizeObserver above then reports the new box back to the node
  // instance, keeping sockets + minimap in sync. The drag itself lives in
  // ResizeHandle — here we only read the size and tag the card.
  useSyncExternalStore(
    nodeSizeStore.subscribe,
    () => (node ? nodeSizeStore.get(node.id) : undefined),
  );
  const resizable = !!node && nodeResizable(node as unknown as ClassicPreset.Node);
  // Wider default card for table/frame nodes (skipped while collapsed — collapse
  // owns the layout then). A manual size still wins (inline width below).
  const wide = !collapsed && !!node && nodeWide(node as unknown as ClassicPreset.Node);
  // Manual size is ignored while collapsed (collapse owns the layout then).
  const size = collapsed || !node ? undefined : nodeSizeStore.get(node.id);

  const style: CSSProperties = {};
  if (accent) (style as Record<string, string>)["--node-accent"] = accent;
  // Darker shade for the light-mode outside border (matches the group framing).
  if (rawAccent) (style as Record<string, string>)["--node-accent-dark"] = darkenAccent(rawAccent);
  if (groupColor) (style as Record<string, string>)["--group-color"] = themeAccent(groupColor, mode);
  if (groupColor) (style as Record<string, string>)["--group-color-dark"] = darkenAccent(groupColor);
  // Width sizes the card; height is published as a var the value box consumes —
  // the card height stays content-driven so the header / rows are never hidden.
  if (size) {
    style.width = Math.round(size.w);
    (style as Record<string, string>)["--box-h"] = `${Math.round(size.h)}px`;
  }
  const styleProp = accent || groupColor || size ? style : undefined;

  function toggleCollapse(e: React.MouseEvent) {
    e.stopPropagation();
    if (node) {
      collapseStore.toggle(node.id);
      // Nudge the OWNING area (drill-in aware) so cable endpoints re-measure
      // against the moved socket dots after the body collapses / expands.
      void getOwningArea(node.id)?.update("node", node.id);
    }
  }

  return (
    <div
      ref={ref}
      // Tags the card with what its op dropdown SELECTS BETWEEN, so one CSS rule can
      // style every op selector rather than sixty components passing a prop. Absent
      // on a family that hasn't been declared in nodeOps.ts yet — deliberately not
      // the same as "argument", so an undeclared node reads as unstyled rather than
      // asserting something false about itself.
      data-op-kind={opKindForNode(node)}
      className={
        `solenoid-node${selected ? " solenoid-node--selected" : ""}` +
        `${collapsed ? " solenoid-node--collapsed" : ""}${groupColor ? " solenoid-node--grouped" : ""}` +
        `${resizable ? " solenoid-node--resizable" : ""}${size ? " solenoid-node--sized" : ""}` +
        `${wide ? " solenoid-node--wide" : ""}${squareCollapse ? " solenoid-node--square-collapse" : ""}` +
        `${!collapsible ? " solenoid-node--no-chevron" : ""}${className ? " " + className : ""}`
      }
      style={styleProp}
      // Square-collapsed nodes hide the chevron, so double-click expands them.
      onDoubleClick={squareCollapse && collapsed ? toggleCollapse : undefined}
    >
      {node && collapsible && (
        <button
          type="button"
          className="solenoid-node__chevron"
          title={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand node" : "Collapse node"}
          // Let the pointerdown reach rete so a drag from the chevron moves the
          // node like the rest of the header. Toggle only on a stationary tap
          // (pointer moved < HEADER_TAP_SLOP); a drag never collapses.
          onPointerDown={(e) => { chevronDownPos.current = { x: e.clientX, y: e.clientY }; }}
          onClick={(e) => {
            const d = chevronDownPos.current;
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > HEADER_TAP_SLOP) return;
            toggleCollapse(e);
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {children}
    </div>
  );
}
