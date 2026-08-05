import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type CSSProperties, type RefObject } from "react";
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

// The whole node header is a drag surface; a pointer moving less than this many
// px counts as a TAP, not a drag. Shared with nodeKit's title label.
export const HEADER_TAP_SLOP = 4;

/** The card's entire painted frame — body border, header accent cap, and the
 *  header/body divider — drawn as SVG strokes instead of CSS borders. Borders
 *  are width-snapped per element under the canvas zoom transform, so the three
 *  strokes cracked apart at their shared edges; SVG shapes rasterize at exact
 *  fractional geometry, so coincident edges stay coincident. Two sibling
 *  viewports (not one nested svg: absolutely-positioned svg keeps its intrinsic
 *  300×150 unless explicitly sized, and geometry properties on a nested svg
 *  proved unreliable): the full-card one strokes the body border; the second is
 *  CSS-sized to --header-h and clips the cap + divider to the header region.
 *  Geometry and colors live entirely in nodeCard.css. */
export function CardFrame() {
  return (
    <>
      <svg className="solenoid-node__frame" aria-hidden="true">
        <rect className="solenoid-node__frame-body" />
      </svg>
      <svg className="solenoid-node__frame solenoid-node__frame-head" aria-hidden="true">
        <rect className="solenoid-node__frame-cap" />
        <rect className="solenoid-node__frame-divider" />
      </svg>
    </>
  );
}

/** Publish the header's border-box height on the card as `--header-h`.
 *  Fractional when the layout height is — the frame divider must sit exactly on
 *  the seam, and offsetHeight's rounding would put it up to half a px off.
 *  Consumers: the frame SVG's header viewport, the corner badge's `top`. */
export function useHeaderHeightVar(headerRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const header = headerRef.current;
    const card = header?.parentElement;
    if (!header || !card) return;
    const apply = (h: number) => card.style.setProperty("--header-h", `${h}px`);
    apply(header.offsetHeight);
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      apply(box ? box.blockSize : header.offsetHeight);
    });
    ro.observe(header);
    return () => ro.disconnect();
  }, [headerRef]);
}

type Props = {
  selected?: boolean;
  // The live node instance: the card reports its measured DOM size back here so
  // minimap silhouettes match the real cards, and derives the accent via nodeKindOf.
  node?: { id: string; width: number; height: number };
  className?: string;
  /** Override the accent color derived from nodeKindOf. */
  accentOverride?: string;
  /** When false, the node can't collapse and no chevron is shown. */
  collapsible?: boolean;
  /** Collapse to a headerless SQUARE (Sparkline), expandable by double-click. */
  squareCollapse?: boolean;
  /** Skip the CardFrame overlay — for cards that paint their own single-stroke
   *  frame (the FC's accent ring) and so have no multi-stroke seam to unify. */
  frameless?: boolean;
  children: ReactNode;
};

/** Shared wrapper for every standard node body, with a CAPTURE-phase pointer
 *  handler that stops propagation for form-field targets — otherwise rete's
 *  per-node drag listener hijacks text-selection drag inside the input, and its
 *  native bubble listener fires before React's synthetic ones. */
export function NodeCard({ selected, node, className, accentOverride, collapsible = true, squareCollapse = false, frameless = false, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Pointer-down position on the chevron, to tell a tap (→ toggle) from a drag.
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
        // Any button — keep clicks from starting a rete node drag. The header
        // chevron is exempt: the whole header is a drag surface, so its
        // pointerdown must reach rete.
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

  // Publish the result box's vertical center as `--out-socket-top`; offsetTop
  // resolves against .solenoid-node__content, so it is header-INDEPENDENT.
  function syncOutputSocketTop() {
    const el = ref.current;
    if (!el) return;
    // First VISIBLE box: a collapsed node hides its figure (offsetParent null),
    // and centering the output socket at 0 is the alternative.
    const boxes = el.querySelectorAll<HTMLElement>(
      ".solenoid-node__figure, .solenoid-node__display-value, .solenoid-node__value-input",
    );
    let box: HTMLElement | null = null;
    for (const b of boxes) { if (b.offsetParent !== null) { box = b; break; } }
    if (box) el.style.setProperty("--out-socket-top", `${box.offsetTop + box.offsetHeight / 2}px`);
    else el.style.removeProperty("--out-socket-top");
  }
  // Runs after every commit — also covers the collapse toggle's re-layout.
  useLayoutEffect(syncOutputSocketTop);

  // Clear the inline `height` stamped by area.resize on collapse — React's
  // re-render can't clear it, and the card would stay full-height while empty.
  useLayoutEffect(() => {
    if (collapsed) ref.current?.style.removeProperty("height");
  }, [collapsed]);

  // Report rendered size back to the node instance so the minimap silhouette
  // matches reality — the minimap plugin re-renders on each node 'render'.
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
      // Update LIVE during a resize drag so cables re-route; the grip drags off
      // window listeners, so recreating this node's DOM here doesn't drop it.
      // Owning area (not main): this card may live inside an open drill-in.
      void getOwningArea(node.id)?.update("node", node.id);
      // A resize can shift this node's sockets — keep any docked FC aligned.
      repositionDockedNodes(node.id);
      // If THIS node is a docked FC, re-center it on its host now that its real
      // height is known — the pre-layout estimate is short, so it lands low.
      const hostId = (node as { hostNodeId?: string }).hostNodeId;
      if (hostId) repositionDockedNodes(hostId);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [node]);

  // `node` is typed minimally here but is the live instance at runtime, so
  // instanceof inside nodeKindOf works.
  // Re-render on theme change so the accent shift (light vs dark) is live.
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const mode = appThemeStore.getMode();
  const rawAccent = accentOverride ?? (node
    ? NODE_KIND_ACCENTS[nodeKindOf(node as unknown as ClassicPreset.Node)]
    : undefined);
  const accent = rawAccent ? themeAccent(rawAccent, mode) : undefined;
  // The "inside a group" indicator: the color is published as a CSS var and the
  // grouped class applies the treatment (yielding to selection).
  useSyncExternalStore(groupMembershipStore.subscribe, groupMembershipStore.version);
  const groupColor = node ? groupMembershipStore.color(node.id) : undefined;

  // A persisted user size overrides the CSS width/height as an inline style; the
  // drag itself lives in ResizeHandle.
  useSyncExternalStore(
    nodeSizeStore.subscribe,
    () => (node ? nodeSizeStore.get(node.id) : undefined),
  );
  const resizable = !!node && nodeResizable(node as unknown as ClassicPreset.Node);
  // Wider default card for table/frame nodes; a manual size still wins.
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
      // Nudge the OWNING area (drill-in aware) so cable endpoints re-measure.
      void getOwningArea(node.id)?.update("node", node.id);
    }
  }

  return (
    <div
      ref={ref}
      // Tags the card with what its op dropdown selects between, so one CSS rule
      // styles every op selector; absent for a family not declared in nodeOps.ts,
      // which is deliberately NOT the same as "argument".
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
      {!frameless && <CardFrame />}
      {node && collapsible && (
        <button
          type="button"
          className="solenoid-node__chevron"
          title={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand node" : "Collapse node"}
          // Let the pointerdown reach rete so a drag from the chevron moves the
          // node; toggle only on a stationary tap (< HEADER_TAP_SLOP).
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
