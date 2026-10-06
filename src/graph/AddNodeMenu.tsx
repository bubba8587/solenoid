// [[B16]] oneFormulaSurface
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { flattenLeaves, searchLeaves } from "./catalogSearch";
import { IS_COARSE, deviceModeStore } from "./coarse";
import { addMenuRequest } from "./addMenuStore";
import { descriptionText } from "./descriptionMd";
import "./AddNodeMenu.css";
import { NODE_KIND_ACCENTS, type NodeKind } from "./nodes/shared";
import { themeAccent } from "./palette";
import { appThemeStore } from "./appTheme";
import { SOCKET_COLORS, type SocketDataType } from "./sockets";

/** A row takes its kind's color as a card of that kind shows it: the current palette, adjusted for light mode. */
const leafAccent = (kind: NodeKind): string => themeAccent(NODE_KIND_ACCENTS[kind], appThemeStore.getMode());
import { ChevronRightIcon, ChevronLeftIcon } from "./components/Icons";

function leafHighlight(leaf: NodeCatalogEntry): { className: string; style?: CSSProperties } {
  if (leaf.accents?.length) return { className: " solenoid-add-menu__item--accent solenoid-add-menu__item--bands" };
  if (leaf.accent) return { className: " solenoid-add-menu__item--accent", style: { "--item-accent": leafAccent(leaf.accent) } as CSSProperties };
  return { className: "" };
}

/** A type-toggle node's flag: one slanted tile per type at the row's trailing end, in that type's socket color. */
function TypeBands({ types }: { types?: readonly SocketDataType[] }) {
  if (!types?.length) return null;
  return (
    <span className="solenoid-add-menu__bands" aria-hidden="true">
      {types.map((t) => <span key={t} className="solenoid-add-menu__band" style={{ "--band-color": SOCKET_COLORS[t] } as CSSProperties} />)}
    </span>
  );
}

export type NodeCatalogEntry = {
  type: string;
  label: string;
  description?: string;
  create: () => unknown;
  /** The node kind whose palette color tints the row, resolved when the menu draws so a palette switch reaches it. */
  accent?: NodeKind;
  /** A type toggle's choices, in toggle order: the row's highlight splits into one band per type, in that type's socket color. */
  accents?: readonly SocketDataType[];
  parity?: boolean;
  hidden?: boolean;
  packs?: string[];
  hiddenOps?: Array<{ op: string; label: string }>;
  hideOpsMark?: boolean;
  excel?: ExcelEquiv[];
  keywords?: string;
  fx?: string[];
  /** A generated row that places what another row places (the host, or `host__op-op`); search shows one of them. */
  places?: string;
};

export type ExcelEquiv = {
  excel: string;
  syntax: string;
  parity?: boolean;
  note?: string;
};

function OpsMark() {
  return <span className="solenoid-add-menu__ops-mark" aria-hidden="true" title="Node contains multiple operations">{"{ }"}</span>;
}

function PackDot({ packs }: { packs: string[] }) {
  return (
    <span
      className="solenoid-add-menu__pack-dot"
      title={`From ${packs.length > 1 ? "packs" : "pack"}: ${packs.join(", ")}`}
      aria-hidden="true"
    />
  );
}

export type CatalogCategory = {
  type: "category";
  label: string;
  description?: string;
  children: CatalogEntry[];
};

export type CatalogPair = {
  type: "pair";
  children: [NodeCatalogEntry, NodeCatalogEntry];
};

export type CatalogEntry = NodeCatalogEntry | CatalogCategory | CatalogPair;

function isCategory(e: CatalogEntry): e is CatalogCategory {
  return e.type === "category";
}
function isPair(e: CatalogEntry): e is CatalogPair {
  return e.type === "pair";
}

// ─── Render/nav items ───────────────────────────────────────────────────
type RenderItem =
  | { kind: "leaf"; entry: NodeCatalogEntry; half: boolean }
  | { kind: "category"; entry: CatalogCategory };

function toRenderItems(entries: CatalogEntry[]): RenderItem[] {
  const out: RenderItem[] = [];
  for (const e of entries) {
    if (isPair(e)) {
      out.push({ kind: "leaf", entry: e.children[0], half: true });
      out.push({ kind: "leaf", entry: e.children[1], half: true });
    } else if (isCategory(e)) {
      out.push({ kind: "category", entry: e });
    } else {
      out.push({ kind: "leaf", entry: e, half: false });
    }
  }
  return out;
}

function levelItemsAt(entries: CatalogEntry[], path: number[]): RenderItem[] {
  let items = toRenderItems(entries);
  for (let d = 0; d < path.length - 1; d++) {
    const it = items[path[d]];
    if (it && it.kind === "category") items = toRenderItems(it.entry.children);
    else break;
  }
  return items;
}

function rowsOf(items: RenderItem[]): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < items.length; ) {
    const it = items[i];
    if (it.kind === "leaf" && it.half) { rows.push([i, i + 1]); i += 2; }
    else { rows.push([i]); i += 1; }
  }
  return rows;
}


const VIEWPORT_MARGIN = 8;

// ─── Submenu — a viewport-clamped panel next to its anchor ──────────────

function Submenu({ anchor, children, onSide }: { anchor: HTMLElement; children: ReactNode; onSide?: (s: "left" | "right") => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState({ left: 0, top: 0, visible: false });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const gap = 4;
    let left = a.right + gap;
    let side: "left" | "right" = "right";
    if (left + m.width > window.innerWidth - VIEWPORT_MARGIN) { left = a.left - m.width - gap; side = "left"; }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    let top = a.top;
    if (top + m.height > window.innerHeight - VIEWPORT_MARGIN) top = window.innerHeight - m.height - VIEWPORT_MARGIN;
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    setStyle({ left, top, visible: true });
    onSide?.(side);
  }, [anchor, onSide]);

  return (
    <div
      ref={ref}
      className="solenoid-add-menu__panel solenoid-add-menu__panel--submenu"
      style={{ position: "fixed", left: style.left, top: style.top, visibility: style.visible ? "visible" : "hidden" }}
    >
      <div className="solenoid-add-menu__scroll">{children}</div>
    </div>
  );
}

// ─── Path-controlled tree (hover + keyboard share `path`) ───────────────

type TreeMenuProps = {
  entries: CatalogEntry[];
  depth: number;
  path: number[];
  onHover: (p: number[]) => void;
  onOpenCategory: (p: number[]) => void;
  onSelect: (entry: NodeCatalogEntry) => void;
  onSubmenuSide: (s: "left" | "right") => void;
  isDim: (leaf: NodeCatalogEntry) => boolean;
};

function TreeMenu({ entries, depth, path, onHover, onOpenCategory, onSelect, onSubmenuSide, isDim }: TreeMenuProps) {
  const items = useMemo(() => toRenderItems(entries), [entries]);
  const anchorRefs = useRef<(HTMLElement | null)[]>([]);
  const prefix = path.slice(0, depth);
  const deepest = depth === path.length - 1;

  return (
    <>
      {items.map((it, i) => {
        const onPath = path[depth] === i;
        if (it.kind === "category") {
          const open = onPath && path.length > depth + 1;
          return (
            <div
              key={`cat:${it.entry.label}`}
              ref={(el) => { anchorRefs.current[i] = el; }}
              className={`solenoid-add-menu__item solenoid-add-menu__item--category${onPath ? " solenoid-add-menu__item--active" : ""}${open ? " solenoid-add-menu__item--open" : ""}`}
              title={it.entry.description && descriptionText(it.entry.description)}
              onMouseEnter={() => onHover([...prefix, i, 0])}
              // Submenus are DOM children of this div: without stopping the bubble, the outermost ancestor re-pins to the top.
              onClick={(e) => { e.stopPropagation(); onOpenCategory([...prefix, i]); }}
            >
              <span>{it.entry.label}</span>
              <span className="solenoid-add-menu__arrow"><ChevronRightIcon size={12} /></span>
              {open && anchorRefs.current[i] && (
                <Submenu anchor={anchorRefs.current[i]!} onSide={onSubmenuSide}>
                  <TreeMenu entries={it.entry.children} depth={depth + 1} path={path} onHover={onHover} onOpenCategory={onOpenCategory} onSelect={onSelect} onSubmenuSide={onSubmenuSide} isDim={isDim} />
                </Submenu>
              )}
            </div>
          );
        }
        const leaf = it.entry;
        const active = onPath && deepest;
        const dim = isDim(leaf);
        const hl = leafHighlight(leaf);
        return (
          <div
            key={`leaf:${leaf.type}`}
            ref={active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            className={`solenoid-add-menu__item${it.half ? " solenoid-add-menu__item--half" : ""}${hl.className}${active ? " solenoid-add-menu__item--active" : ""}${dim ? " solenoid-add-menu__item--incompatible" : ""}`}
            title={leaf.description && descriptionText(leaf.description)}
            style={hl.style}
            onMouseEnter={() => onHover([...prefix, i])}
            onClick={(e) => { e.stopPropagation(); onSelect(leaf); }}
          >
            {leaf.label}
            {leaf.hiddenOps?.length && !leaf.hideOpsMark ? <OpsMark /> : null}
            {leaf.packs?.length ? <PackDot packs={leaf.packs} /> : null}
            <TypeBands types={leaf.accents} />
          </div>
        );
      })}
    </>
  );
}

// ─── Drill-down list (phone): one level at a time, a back row on top ────

function LeafRow({ leaf, half, active, dim, onSelect, onMouseEnter, rowRef }: {
  leaf: NodeCatalogEntry; half?: boolean; active?: boolean; dim: boolean;
  onSelect: () => void; onMouseEnter?: () => void; rowRef?: React.Ref<HTMLDivElement>;
}) {
  const hl = leafHighlight(leaf);
  return (
    <div
      ref={rowRef}
      className={`solenoid-add-menu__item${half ? " solenoid-add-menu__item--half" : ""}${hl.className}${active ? " solenoid-add-menu__item--active" : ""}${dim ? " solenoid-add-menu__item--incompatible" : ""}`}
      title={leaf.description && descriptionText(leaf.description)}
      style={hl.style}
      onMouseEnter={onMouseEnter}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {leaf.label}
      {leaf.hiddenOps?.length && !leaf.hideOpsMark ? <OpsMark /> : null}
      {leaf.packs?.length ? <PackDot packs={leaf.packs} /> : null}
      <TypeBands types={leaf.accents} />
    </div>
  );
}

/** No hover and no resting highlight: a finger has no hover, so nothing lights until it lands. */
function DrillMenu({ entries, stack, onPush, onPop, onSelect, isDim }: {
  entries: CatalogEntry[];
  stack: number[];
  onPush: (i: number) => void;
  onPop: () => void;
  onSelect: (leaf: NodeCatalogEntry) => void;
  isDim: (leaf: NodeCatalogEntry) => boolean;
}) {
  let items = toRenderItems(entries);
  let parent: CatalogCategory | null = null;
  for (const i of stack) {
    const it = items[i];
    if (!it || it.kind !== "category") break;
    parent = it.entry;
    items = toRenderItems(it.entry.children);
  }
  return (
    <>
      {parent && (
        <div className="solenoid-add-menu__item solenoid-add-menu__item--back" onClick={(e) => { e.stopPropagation(); onPop(); }}>
          <ChevronLeftIcon size={14} />
          <span>{parent.label}</span>
        </div>
      )}
      {items.map((it, i) => it.kind === "category" ? (
        <div
          key={`cat:${it.entry.label}`}
          className="solenoid-add-menu__item solenoid-add-menu__item--category"
          onClick={(e) => { e.stopPropagation(); onPush(i); }}
        >
          <span>{it.entry.label}</span>
          <span className="solenoid-add-menu__arrow"><ChevronRightIcon size={12} /></span>
        </div>
      ) : (
        <LeafRow key={`leaf:${it.entry.type}`} leaf={it.entry} half={it.half} dim={isDim(it.entry)} onSelect={() => onSelect(it.entry)} />
      ))}
    </>
  );
}

// ─── Root menu ──────────────────────────────────────────────────────────

type AddNodeMenuProps = {
  screenX: number;
  screenY: number;
  entries: CatalogEntry[];
  onSelect: (entry: NodeCatalogEntry) => void;
  onClose: () => void;
  compatibleTypes?: Set<string>;
};

export function AddNodeMenu({ screenX, screenY, entries, onSelect, onClose, compatibleTypes }: AddNodeMenuProps) {
  // A palette or theme switch while the menu is open repaints its row tints (the theme store notifies on both).
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [treePath, setTreePath] = useState<number[]>([0]);
  const [pinned, setPinned] = useState<number[] | null>(null);
  const [submenuSide, setSubmenuSide] = useState<"left" | "right">("right");
  const [rootOpensLeft, setRootOpensLeft] = useState(false);
  // A phone drills one level at a time in a docked sheet instead of opening flyouts beside the finger.
  const drill = useSyncExternalStore(deviceModeStore.subscribe, deviceModeStore.get);
  const [stack, setStack] = useState<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [stack]);
  useEffect(() => { addMenuRequest.setOpen(true); return () => addMenuRequest.setOpen(false); }, []);
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: screenX, top: screenY, visible: false,
  });

  const leaves = useMemo(() => flattenLeaves(entries), [entries]);
  const results = useMemo(
    () => (query.trim() ? searchLeaves(leaves, query.trim()) : []),
    [leaves, query],
  );
  const searching = !!query.trim();

  const isDim = (leaf: NodeCatalogEntry) => compatibleTypes != null && !compatibleTypes.has(leaf.type);
  const select = (leaf: NodeCatalogEntry) => { if (!isDim(leaf)) onSelect(leaf); };

  const startsWith = (p: number[], base: number[]) => base.every((v, i) => p[i] === v);
  const handleHover = (p: number[]) => {
    if (pinned && !startsWith(p, pinned)) return;
    setTreePath(p);
  };
  const handleOpenCategory = (p: number[]) => {
    setPinned(p);
    setTreePath([...p, 0]);
  };

  useEffect(() => { if (pos.visible && !IS_COARSE) inputRef.current?.focus(); }, [pos.visible]);

  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  // Only ever move up or left, so the menu doesn't jump as results come and go.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (drill) { setPos((p) => (p.visible ? p : { ...p, visible: true })); return; }
    const rect = el.getBoundingClientRect();
    setRootOpensLeft(screenX + rect.width * 2 + 8 > window.innerWidth - VIEWPORT_MARGIN);
    setPos((p) => {
      let left = p.visible ? p.left : screenX;
      let top = p.visible ? p.top : screenY;
      if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN) left = window.innerWidth - rect.width - VIEWPORT_MARGIN;
      if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) top = window.innerHeight - rect.height - VIEWPORT_MARGIN;
      left = Math.max(VIEWPORT_MARGIN, left);
      top = Math.max(VIEWPORT_MARGIN, top);
      if (p.visible) { top = Math.min(top, p.top); left = Math.min(left, p.left); }
      if (p.visible && left === p.left && top === p.top) return p;
      return { left, top, visible: true };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenX, screenY, searching, results.length, treePath.length, drill]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Capture phase: React Flow's handlers stop a canvas mousedown before it bubbles.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      // The phone's + button toggles the menu itself; closing here would reopen it on the same tap.
      if (t?.closest?.(".solenoid-add-menu, .solenoid-add-menu__panel--submenu, .solenoid-mobile-bar__add")) return;
      onClose();
    };
    const t = window.setTimeout(() => window.addEventListener("pointerdown", onDown, true), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (searching) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && results[activeIndex]) { select(results[activeIndex]); }
      else if (e.key === "Escape") { e.stopPropagation(); setQuery(""); }
      return;
    }
    if (pinned) setPinned(null);
    const items = levelItemsAt(entries, treePath);
    const rows = rowsOf(items);
    const idx = treePath[treePath.length - 1] ?? 0;
    const active = items[idx];
    let r = 0, c = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const ci = rows[ri].indexOf(idx);
      if (ci >= 0) { r = ri; c = ci; break; }
    }
    const setActive = (flat: number) => setTreePath([...treePath.slice(0, -1), flat]);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nr = rows[Math.min(r + 1, rows.length - 1)];
      setActive(nr[Math.min(c, nr.length - 1)]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const nr = rows[Math.max(r - 1, 0)];
      setActive(nr[Math.min(c, nr.length - 1)]);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const goRight = e.key === "ArrowRight";
      if (rows[r].length === 2 && goRight && c === 0) { setActive(rows[r][1]); return; }
      if (rows[r].length === 2 && !goRight && c === 1) { setActive(rows[r][0]); return; }
      const openLeft = treePath.length > 1 ? submenuSide === "left" : rootOpensLeft;
      const isDescend = openLeft ? !goRight : goRight;
      if (isDescend) { if (active?.kind === "category") setTreePath([...treePath, 0]); }
      else if (treePath.length > 1) setTreePath(treePath.slice(0, -1));
    } else if (e.key === "Enter") {
      if (active?.kind === "category") setTreePath([...treePath, 0]);
      else if (active?.kind === "leaf") select(active.entry);
    }
  }

  return (
    <div
      ref={ref}
      className={`solenoid-add-menu${drill ? " solenoid-add-menu--sheet" : ""}`}
      style={drill ? { visibility: pos.visible ? "visible" : "hidden" } : { left: pos.left, top: pos.top, visibility: pos.visible ? "visible" : "hidden" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="solenoid-add-menu__heading">Add node</div>
      <div className="solenoid-add-menu__panel">
        <div className="solenoid-add-menu__scroll" ref={scrollRef}>
        <input
          ref={inputRef}
          className="solenoid-add-menu__search"
          placeholder="Search…"
          value={query}
          spellCheck={false}
          autoFocus={!IS_COARSE}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); setPinned(null); }}
          onKeyDown={onInputKeyDown}
        />
        {searching ? (
          results.length > 0 ? (
            results.map((leaf, i) => (
              <LeafRow
                key={leaf.type}
                leaf={leaf}
                rowRef={i === activeIndex ? activeRef : undefined}
                active={i === activeIndex}
                dim={isDim(leaf)}
                onMouseEnter={drill ? undefined : () => setActiveIndex(i)}
                onSelect={() => select(leaf)}
              />
            ))
          ) : (
            <div className="solenoid-add-menu__empty">No matches</div>
          )
        ) : (
          drill ? (
            <DrillMenu entries={entries} stack={stack} onPush={(i) => setStack((st) => [...st, i])} onPop={() => setStack((st) => st.slice(0, -1))} onSelect={select} isDim={isDim} />
          ) : (
            <TreeMenu entries={entries} depth={0} path={treePath} onHover={handleHover} onOpenCategory={handleOpenCategory} onSelect={select} onSubmenuSide={setSubmenuSide} isDim={isDim} />
          )
        )}
        </div>
      </div>
    </div>
  );
}
