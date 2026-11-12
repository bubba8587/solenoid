import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type CSSProperties } from "react";
import type { GraphNode } from "../graphModel";
import { repositionDockedNodes } from "../canvasCommands";
import { toggleNodeCollapsed } from "../selectionOps";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { connectionVersionStore } from "../graphSignals";
import { nodeAccent, nodeResizable, nodeWide, nodeXWide, nodeMedium } from "../nodeClasses";
import { nodeSizeStore } from "../nodeSizeStore";
import { collapseStore } from "../collapseStore";
import { groupMembershipStore } from "../groupMembership";
import { appThemeStore } from "../appTheme";
import { themeAccent, darkenAccent, contrastInk } from "../palette";
import { measureThenWrite, observeResize } from "./layoutBatch";

// Under this many px a header pointer is a tap, not a drag; shared with the title label.
export const HEADER_TAP_SLOP = 4;

const noSubscribe = () => () => {};

/** An input row's leading label (a row's second label, as in Rows/Cols, sits inside the field column), and a connection
 *  card's field label. Shared with nodeCard.css and ConnectionNodes.css. */
const IO_LABEL_COLUMN =
  ".solenoid-node__io-row:not(.solenoid-node__io-row--output):not(.solenoid-node__io-row--hero) > .solenoid-node__io-label:not(.solenoid-node__io-label ~ .solenoid-node__io-label):not(:last-child), .sol-conn__field > .sol-conn__label";

/** A field whose content is words or a date, and the input width it needs beside its label before it moves below it:
 *  about eleven characters of text, a full date, a short value beside a keyed slot's type button. */
const WIDE_FIELDS: ReadonlyArray<[string, number]> = [
  ["input[type=date], .solenoid-node__value-input", 96],
  [".solenoid-node__keyed", 64],
  [".solenoid-node__quoted--inline, .sol-conn__url, input.solenoid-node__inline-input:not([type=number])", 72],
];
/** The label column leaves its field this much (a six-digit number), and the gap from label to field. */
const FIELD_FLOOR = 60;
const LABEL_GAP = 12;
/** A number field beside a label too long for the column keeps one line while it has this much (a 4-digit count). */
const SOLO_FLOOR = 40;

/** A label's width on one line, even while it wraps: the sum of its line boxes and a space per break. Screen px. */
function unwrappedWidth(range: Range, label: HTMLElement): number {
  range.selectNodeContents(label);
  const lines = new Map<number, { left: number; right: number }>();
  for (const r of range.getClientRects()) {
    if (r.width === 0) continue;
    const key = Math.round(r.top);
    const line = lines.get(key);
    if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); }
    else lines.set(key, { left: r.left, right: r.right });
  }
  let sum = 0;
  for (const l of lines.values()) sum += l.right - l.left;
  return sum + Math.max(0, lines.size - 1) * 4;
}

type LabelPlan = { width: number | null; modes: Array<[HTMLElement, "below" | "solo" | null]> };

/** The card's label column and the rows that leave it: a word or date field whose own label would leave it too
 *  narrow goes `below` its label at full width, and a number row whose label is past the column's cap stays on one line
 *  as a `solo` rather than wrapping. Layout px; the canvas zoom is divided out of the Range rects. */
function planLabelColumn(card: HTMLElement): LabelPlan {
  const scale = card.getBoundingClientRect().width / (card.offsetWidth || 1) || 1;
  const range = document.createRange();
  const rows: Array<{ row: HTMLElement; label: number; room: number; need: number | null }> = [];
  for (const label of card.querySelectorAll<HTMLElement>(IO_LABEL_COLUMN)) {
    const field = label.nextElementSibling as HTMLElement | null;
    const row = label.parentElement;
    if (!field || !row || field.classList.contains("solenoid-node__row-remove")) continue;
    const natural = Math.ceil(unwrappedWidth(range, label) / scale);
    const cs = getComputedStyle(row);
    let trailing = 0;
    for (let n = field.nextElementSibling as HTMLElement | null; n; n = n.nextElementSibling as HTMLElement | null) {
      if (n.offsetParent !== null) trailing += n.offsetWidth + parseFloat(cs.columnGap || "0");
    }
    // The room beside the label: the row's content box less the gap and whatever follows the field.
    const room = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - LABEL_GAP - trailing;
    const kind = WIDE_FIELDS.find(([sel]) => field.matches(sel));
    // A field's chrome around its input (the quote marks, a keyed slot's type button) counts against the room.
    const input = field.matches("input") ? field : field.querySelector<HTMLElement>("input");
    const need = kind ? kind[1] + (input ? field.offsetWidth - input.offsetWidth : 0) : null;
    rows.push({ row, label: natural, room, need });
  }
  const modes: LabelPlan["modes"] = [];
  let width = 0;
  let any = false;
  for (const r of rows) {
    let mode: "below" | "solo" | null = null;
    if (r.need !== null && r.room - r.label < r.need) mode = "below";
    else if (r.need === null && r.label > r.room - FIELD_FLOOR && r.room - r.label >= SOLO_FLOOR) mode = "solo";
    modes.push([r.row, mode]);
    if (!mode) { width = Math.max(width, r.label); any = true; }
  }
  return { width: any ? width : null, modes };
}

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
  // Only a square-collapse card reads it, so no other card rescans the connections on every cable change.
  const outputWired = useSyncExternalStore(
    squareCollapse ? connectionVersionStore.subscribe : noSubscribe,
    () => squareCollapse && !!node && !!getOwningEditor(node.id)?.getConnections().some((c) => c.source === node.id),
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

  /** The output socket's top: the first visible value box's middle, or null for none. */
  function readOutputSocketTop(): number | null | undefined {
    const el = ref.current;
    if (!el) return undefined;
    // First visible box: a collapsed node hides its figure (offsetParent null). A result box outranks an input field above it (Value Input).
    const firstVisible = (sel: string) => {
      for (const b of el.querySelectorAll<HTMLElement>(sel)) if (b.offsetParent !== null) return b;
      return null;
    };
    const box = firstVisible(".solenoid-node__figure, .solenoid-node__display-value") ?? firstVisible(".solenoid-node__value-input");
    if (!box) return null;
    // Sum offsetTop up to the content wrapper: a box inside an intermediate positioned element (Date Input's picker row) would otherwise measure about 0.
    const content = el.querySelector<HTMLElement>(".solenoid-node__content");
    let top = box.offsetHeight / 2;
    // Walk only when content is a real ancestor, so a missing wrapper can't over-sum up to the card root.
    if (content) for (let n: HTMLElement | null = box; n && n !== content; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
    else top += box.offsetTop;
    return top;
  }
  function syncOutputSocketTop() {
    measureThenWrite(ref, readOutputSocketTop, (top) => {
      const el = ref.current;
      if (!el || top === undefined) return;
      if (top === null) el.style.removeProperty("--out-socket-top");
      else el.style.setProperty("--out-socket-top", `${top}px`);
    });
  }
  // After every commit, which also covers the collapse toggle's re-layout.
  useLayoutEffect(syncOutputSocketTop);

  const labelColumnOwner = useRef({});
  // Every labeled input row starts its field at one x; a few rows step out of that column (`planLabelColumn`).
  useLayoutEffect(() => {
    measureThenWrite(labelColumnOwner.current, () => (ref.current ? planLabelColumn(ref.current) : undefined), (plan) => {
      const el = ref.current;
      if (!el || !plan) return;
      if (plan.width === null) el.style.removeProperty("--io-label-w");
      else if (el.style.getPropertyValue("--io-label-w") !== `${plan.width}px`) el.style.setProperty("--io-label-w", `${plan.width}px`);
      for (const [row, mode] of plan.modes) {
        if ((row.getAttribute("data-io-fit") ?? "") === (mode ?? "")) continue;
        if (mode) row.setAttribute("data-io-fit", mode);
        else row.removeAttribute("data-io-fit");
      }
    });
  });

  // A pinned inline `height` would keep the collapsed card full-height while empty.
  useLayoutEffect(() => {
    if (collapsed) ref.current?.style.removeProperty("height");
  }, [collapsed]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !node) return;
    return observeResize(el, (entry) => {
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
  }, [node]);

  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const mode = appThemeStore.getMode();
  // An override (the FC's mismatch red, its socket color) still needs theme adjusting; nodeAccent is already resolved.
  const accent = accentOverride
    ? themeAccent(accentOverride, mode)
    : node ? nodeAccent(node as unknown as GraphNode, mode) : undefined;
  const groupColor = useSyncExternalStore(groupMembershipStore.subscribe, () => (node ? groupMembershipStore.color(node.id) : undefined));

  useSyncExternalStore(
    nodeSizeStore.subscribe,
    () => (node ? nodeSizeStore.get(node.id) : undefined),
  );
  const resizable = !!node && nodeResizable(node as unknown as GraphNode);
  const xwide = !collapsed && !!node && nodeXWide(node as unknown as GraphNode);
  const wide = !collapsed && !xwide && !!node && nodeWide(node as unknown as GraphNode);
  const medium = !collapsed && !xwide && !wide && !!node && nodeMedium(node as unknown as GraphNode);
  // Clamped to the current content's minimum: the grip clamps only live drags, and a Display sized for a scalar may now show a chart.
  const stored = collapsed || !node ? undefined : nodeSizeStore.get(node.id);
  const min = stored && node ? nodeSizeStore.getMin(node.id) : undefined;
  const size = stored && min ? { w: Math.max(stored.w, min.w), h: Math.max(stored.h, min.h) } : stored;

  const style: CSSProperties = {};
  if (accent) (style as Record<string, string>)["--node-accent"] = accent;
  if (accent) (style as Record<string, string>)["--node-accent-dark"] = darkenAccent(accent);
  if (accent) (style as Record<string, string>)["--node-accent-ink"] = contrastInk(accent);
  if (groupColor) (style as Record<string, string>)["--group-color"] = themeAccent(groupColor, mode);
  if (groupColor) (style as Record<string, string>)["--group-color-dark"] = darkenAccent(groupColor);
  if (size) {
    style.width = Math.round(size.w);
    (style as Record<string, string>)["--box-h"] = `${Math.round(size.h)}px`;
  }
  const styleProp = accent || groupColor || size ? style : undefined;

  function doToggle() {
    if (node) toggleNodeCollapsed(node.id);
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
        `${xwide ? " solenoid-node--xwide" : ""}${wide ? " solenoid-node--wide" : ""}${medium ? " solenoid-node--medium" : ""}${squareCollapse ? " solenoid-node--square-collapse" : ""}` +
        `${squareCollapse && !outputWired ? " solenoid-node--output-unwired" : ""}` +
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
