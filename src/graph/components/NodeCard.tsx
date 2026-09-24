import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type CSSProperties } from "react";
import type { ClassicPreset } from "rete";
import { repositionDockedNodes } from "../canvasCommands";
import { getOwningView } from "../activeGraph";
import { nodeAccent, nodeResizable, nodeWide, nodeMedium } from "../rete-nodes";
import { nodeSizeStore } from "../nodeSizeStore";
import { collapseStore } from "../collapseStore";
import { groupMembershipStore } from "../groupMembership";
import { appThemeStore } from "../appTheme";
import { themeAccent, darkenAccent } from "../palette";

// Under this many px a header pointer is a tap, not a drag; shared with the title label.
export const HEADER_TAP_SLOP = 4;

/** SVG strokes, not CSS borders, so the frame can't subpixel-crack under zoom (DESIGN.md § Cards); two sibling viewports, since an absolutely positioned svg keeps its intrinsic 300×150 unless sized and geometry on a nested svg proved unreliable. */
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

type Props = {
  selected?: boolean;
  node?: { id: string; width: number; height: number };
  className?: string;
  accentOverride?: string;
  collapsible?: boolean;
  squareCollapse?: boolean;
  /** For cards that paint their own single-stroke frame (the FC's ring), so have no seam to unify. */
  frameless?: boolean;
  children: ReactNode;
};

/** Capture phase: the node drag listener is native and fires before React's synthetic handlers, so a form field must stop it here. */
export function NodeCard({ selected, node, className, accentOverride, collapsible = true, squareCollapse = false, frameless = false, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
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
        // Any button, except the chevron: its pointerdown must reach the header drag.
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

  function syncOutputSocketTop() {
    const el = ref.current;
    if (!el) return;
    // First visible box: a collapsed node hides its figure (offsetParent null).
    const boxes = el.querySelectorAll<HTMLElement>(
      ".solenoid-node__figure, .solenoid-node__display-value, .solenoid-node__value-input",
    );
    let box: HTMLElement | null = null;
    for (const b of boxes) { if (b.offsetParent !== null) { box = b; break; } }
    if (!box) { el.style.removeProperty("--out-socket-top"); return; }
    // Sum offsetTop up to the content wrapper: a box inside an intermediate positioned element (Date Input's picker row) would otherwise measure about 0.
    const content = el.querySelector<HTMLElement>(".solenoid-node__content");
    let top = box.offsetHeight / 2;
    // Walk only when content is a real ancestor, so a missing wrapper can't over-sum up to the card root.
    if (content) for (let n: HTMLElement | null = box; n && n !== content; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
    else top += box.offsetTop;
    el.style.setProperty("--out-socket-top", `${top}px`);
  }
  // After every commit, which also covers the collapse toggle's re-layout.
  useLayoutEffect(syncOutputSocketTop);

  // A pinned inline `height` would keep the collapsed card full-height while empty.
  useLayoutEffect(() => {
    if (collapsed) ref.current?.style.removeProperty("height");
  }, [collapsed]);

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
      // Live during a resize drag so cables re-route; the grip drags off window listeners, so recreating this DOM doesn't drop it.
      void getOwningView(node.id)?.rerenderNode(node.id);
      repositionDockedNodes(node.id);
      // A docked FC re-centers on its host once its real height is known; the pre-layout estimate is short.
      const hostId = (node as { hostNodeId?: string }).hostNodeId;
      if (hostId) repositionDockedNodes(hostId);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [node]);

  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const mode = appThemeStore.getMode();
  // An override (the FC's mismatch orange, its socket color) still needs theme adjusting; nodeAccent is already resolved.
  const accent = accentOverride
    ? themeAccent(accentOverride, mode)
    : node ? nodeAccent(node as unknown as ClassicPreset.Node, mode) : undefined;
  const groupColor = useSyncExternalStore(groupMembershipStore.subscribe, () => (node ? groupMembershipStore.color(node.id) : undefined));

  useSyncExternalStore(
    nodeSizeStore.subscribe,
    () => (node ? nodeSizeStore.get(node.id) : undefined),
  );
  const resizable = !!node && nodeResizable(node as unknown as ClassicPreset.Node);
  const wide = !collapsed && !!node && nodeWide(node as unknown as ClassicPreset.Node);
  const medium = !collapsed && !wide && !!node && nodeMedium(node as unknown as ClassicPreset.Node);
  // Clamped to the current content's minimum: the grip clamps only live drags, and a Display sized for a scalar may now show a chart.
  const stored = collapsed || !node ? undefined : nodeSizeStore.get(node.id);
  const min = stored && node ? nodeSizeStore.getMin(node.id) : undefined;
  const size = stored && min ? { w: Math.max(stored.w, min.w), h: Math.max(stored.h, min.h) } : stored;

  const style: CSSProperties = {};
  if (accent) (style as Record<string, string>)["--node-accent"] = accent;
  if (accent) (style as Record<string, string>)["--node-accent-dark"] = darkenAccent(accent);
  if (groupColor) (style as Record<string, string>)["--group-color"] = themeAccent(groupColor, mode);
  if (groupColor) (style as Record<string, string>)["--group-color-dark"] = darkenAccent(groupColor);
  if (size) {
    style.width = Math.round(size.w);
    (style as Record<string, string>)["--box-h"] = `${Math.round(size.h)}px`;
  }
  const styleProp = accent || groupColor || size ? style : undefined;

  function doToggle() {
    if (node) {
      collapseStore.toggle(node.id);
      void getOwningView(node.id)?.rerenderNode(node.id);
    }
  }
  function toggleCollapse(e: React.MouseEvent) {
    e.stopPropagation();
    doToggle();
  }
  // A desktop mouse press that reaches the drag loses its click to the card, so a stationary tap is detected on a window pointerup instead.
  function armChevronTap(e: React.PointerEvent) {
    const sx = e.clientX, sy = e.clientY;
    const onEnd = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onCancel, true);
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) <= HEADER_TAP_SLOP) doToggle();
    };
    const onCancel = () => {
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onCancel, true);
    };
    window.addEventListener("pointerup", onEnd, true);
    window.addEventListener("pointercancel", onCancel, true);
  }

  return (
    <div
      ref={ref}
      className={
        `solenoid-node${selected ? " solenoid-node--selected" : ""}` +
        `${collapsed ? " solenoid-node--collapsed" : ""}${groupColor ? " solenoid-node--grouped" : ""}` +
        `${resizable ? " solenoid-node--resizable" : ""}${size ? " solenoid-node--sized" : ""}` +
        `${wide ? " solenoid-node--wide" : ""}${medium ? " solenoid-node--medium" : ""}${squareCollapse ? " solenoid-node--square-collapse" : ""}` +
        `${!collapsible ? " solenoid-node--no-chevron" : ""}${className ? " " + className : ""}`
      }
      style={styleProp}
      onDoubleClick={squareCollapse && collapsed ? toggleCollapse : undefined}
    >
      {!frameless && <CardFrame />}
      {node && collapsible && (
        <button
          type="button"
          className="solenoid-node__chevron"
          title={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand the node" : "Collapse the node"}
          onPointerDown={armChevronTap}
        />
      )}
      {children}
    </div>
  );
}
