import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flattenLeaves, searchLeaves } from "./catalogSearch";
import { IS_COARSE } from "./coarse";
import "./AddNodeMenu.css";

// Leaf entry — produces a node when selected.
export type NodeCatalogEntry = {
  type: string;
  label: string;
  description?: string;
  create: () => unknown;
  // Optional accent (a node-kind color) — highlights user-input nodes
  // (Scalar, Constant, List, Range). Rendered as a filled rounded-rect.
  accent?: string;
  // parity: true (default) = fully equivalent to Excel counterpart(s).
  // parity: false = implemented but with known limitations (see the node's `note`
  // in nodeExcel.ts). An ExcelEquiv may override this per Excel function.
  parity?: boolean;
  // Deprecated node: stays registered (FLAT_CATALOG) so saved graphs that use
  // it still load and render, but is hidden from the Add menu and the
  // Function Reference so new ones can't be created.
  hidden?: boolean;
  // Pack id(s) that contribute this node. Undefined/empty = built-in (core or
  // Excel matcher). Set by the catalog builder; drives the subtle pack indicator.
  packs?: string[];
  // Excel function(s) this node is equivalent to — the node's OWN reference
  // metadata, so the Function Reference can be generated from the catalog instead
  // of a parallel hand-list. For op-families this is forwarded from the op-meta;
  // standalone nodes set it inline. Empty = a Solenoid-native node (no Excel fn).
  excel?: ExcelEquiv[];
  // Extra search synonyms the label/description/category don't carry (e.g. the
  // class-derived hover hint when it differs from the label, or common aliases).
  // Space-separated; matched by the Add-menu search only, never displayed.
  keywords?: string;
};

// One Excel function a node stands in for. `parity`/`note` override the entry's
// defaults for this specific Excel function (one node can cover several).
export type ExcelEquiv = {
  excel: string;
  syntax: string;
  parity?: boolean;
  note?: string;
};

// A tiny dim dot marking a node that came from an add-on pack (vs. built-in).
function PackDot({ packs }: { packs: string[] }) {
  return (
    <span
      className="solenoid-add-menu__pack-dot"
      title={`From ${packs.length > 1 ? "packs" : "pack"}: ${packs.join(", ")}`}
      aria-hidden="true"
    />
  );
}

// Category entry — opens a submenu.
export type CatalogCategory = {
  type: "category";
  label: string;
  description?: string;
  children: CatalogEntry[];
};

// Pair entry — two leaf entries shown side by side (for opposites).
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
// One navigable slot. Pairs are flattened into two half-leaves so the
// keyboard moves through every node and the grid lays the halves into its
// two columns.
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

// Render items at the level the path currently points into (all path
// indices except the last name opened categories).
function levelItemsAt(entries: CatalogEntry[], path: number[]): RenderItem[] {
  let items = toRenderItems(entries);
  for (let d = 0; d < path.length - 1; d++) {
    const it = items[path[d]];
    if (it && it.kind === "category") items = toRenderItems(it.entry.children);
    else break;
  }
  return items;
}

// Group render items into visual rows (a pair = one row of two flat
// indices; everything else = a one-item row), matching the grid layout —
// so the keyboard can move up/down by row and left/right within a pair.
function rowsOf(items: RenderItem[]): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < items.length; ) {
    const it = items[i];
    if (it.kind === "leaf" && it.half) { rows.push([i, i + 1]); i += 2; }
    else { rows.push([i]); i += 1; }
  }
  return rows;
}

// ─── Fuzzy search ───────────────────────────────────────────────────────
// Scoring lives in catalogSearch.ts (pure + unit-tested). It matches the wide
// searchable text — label + description + Excel names + ancestor CATEGORY path +
// kebab type id + keywords — so "arithmetic" and "table input" rank their nodes.

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
      {children}
    </div>
  );
}

// ─── Path-controlled tree (hover + keyboard share `path`) ───────────────

type TreeMenuProps = {
  entries: CatalogEntry[];
  depth: number;
  path: number[];
  // Hover moves the active path (the parent gates it so a PINNED submenu — one
  // opened by a click — isn't collapsed by mousing elsewhere).
  onHover: (p: number[]) => void;
  // Click on a category: pin its submenu open.
  onOpenCategory: (p: number[]) => void;
  onSelect: (entry: NodeCatalogEntry) => void;
  onSubmenuSide: (s: "left" | "right") => void;
};

function TreeMenu({ entries, depth, path, onHover, onOpenCategory, onSelect, onSubmenuSide }: TreeMenuProps) {
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
              title={it.entry.description}
              onMouseEnter={() => onHover([...prefix, i, 0])}
              // Submenus render as DOM children of this category div, so a click
              // on a nested category/leaf bubbles up here too. Stop it, or the
              // outermost ancestor's handler wins and re-pins/collapses to the top
              // (this is why pinning a 3rd-level submenu didn't work).
              onClick={(e) => { e.stopPropagation(); onOpenCategory([...prefix, i]); }}
            >
              <span>{it.entry.label}</span>
              <span className="solenoid-add-menu__arrow">▶</span>
              {open && anchorRefs.current[i] && (
                <Submenu anchor={anchorRefs.current[i]!} onSide={onSubmenuSide}>
                  <TreeMenu entries={it.entry.children} depth={depth + 1} path={path} onHover={onHover} onOpenCategory={onOpenCategory} onSelect={onSelect} onSubmenuSide={onSubmenuSide} />
                </Submenu>
              )}
            </div>
          );
        }
        const leaf = it.entry;
        const active = onPath && deepest;
        return (
          <div
            key={`leaf:${leaf.type}`}
            ref={active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            className={`solenoid-add-menu__item${it.half ? " solenoid-add-menu__item--half" : ""}${leaf.accent ? " solenoid-add-menu__item--accent" : ""}${active ? " solenoid-add-menu__item--active" : ""}`}
            title={leaf.description}
            style={leaf.accent ? ({ "--item-accent": leaf.accent } as CSSProperties) : undefined}
            onMouseEnter={() => onHover([...prefix, i])}
            onClick={(e) => { e.stopPropagation(); onSelect(leaf); }}
          >
            {leaf.label}
            {leaf.packs?.length ? <PackDot packs={leaf.packs} /> : null}
          </div>
        );
      })}
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
};

export function AddNodeMenu({ screenX, screenY, entries, onSelect, onClose }: AddNodeMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0); // search results
  const [treePath, setTreePath] = useState<number[]>([0]); // tree nav
  // A clicked category pins its submenu open: while `pinned` is set, hover can
  // still navigate WITHIN that subtree but can't collapse it by straying
  // elsewhere. Clicking another category re-pins; typing a search clears it.
  const [pinned, setPinned] = useState<number[] | null>(null);
  const [submenuSide, setSubmenuSide] = useState<"left" | "right">("right");
  const [rootOpensLeft, setRootOpensLeft] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: screenX, top: screenY, visible: false,
  });

  const leaves = useMemo(() => flattenLeaves(entries), [entries]);
  const results = useMemo(
    () => (query.trim() ? searchLeaves(leaves, query.trim()) : []),
    [leaves, query],
  );
  const searching = !!query.trim();

  // Hover gated by the pin: ignore moves that would leave the pinned subtree, so
  // a click-pinned submenu stays on screen no matter where the cursor wanders.
  const startsWith = (p: number[], base: number[]) => base.every((v, i) => p[i] === v);
  const handleHover = (p: number[]) => {
    if (pinned && !startsWith(p, pinned)) return;
    setTreePath(p);
  };
  const handleOpenCategory = (p: number[]) => {
    setPinned(p);
    setTreePath([...p, 0]);
  };

  // Focus the search on open — desktop only. On touch it would pop the
  // on-screen keyboard over the category list before the user can browse;
  // tapping the field still summons it on demand.
  useEffect(() => { if (pos.visible && !IS_COARSE) inputRef.current?.focus(); }, [pos.visible]);

  // Keep the highlighted search result in view as the list scrolls.
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  // Clamp into the viewport using the ACTUAL rendered size, but only ever
  // move the menu UP/LEFT (never back down/right) — so as search results
  // come and go it's pushed up once and then stays put (no jumping). The
  // panel is height-capped, so the reserved space can't be exceeded.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Predict which side submenus open on, from the root's position.
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
  }, [screenX, screenY, searching, results.length, treePath.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = window.setTimeout(() => window.addEventListener("mousedown", onClose), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (searching) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && results[activeIndex]) { onSelect(results[activeIndex]); }
      else if (e.key === "Escape") { e.stopPropagation(); setQuery(""); }
      return;
    }
    // Tree navigation (2D — rows for ↑/↓, pair columns for ←/→). Keyboard nav
    // releases any click-pin so arrowing out of a pinned branch can't strand it.
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
      // Spatial move within a pair takes priority (toward the partner).
      if (rows[r].length === 2 && goRight && c === 0) { setActive(rows[r][1]); return; }
      if (rows[r].length === 2 && !goRight && c === 1) { setActive(rows[r][0]); return; }
      // Otherwise descend/ascend — flipped when submenus open leftward, so
      // the arrow toward the submenu enters and the one away exits.
      const openLeft = treePath.length > 1 ? submenuSide === "left" : rootOpensLeft;
      const isDescend = openLeft ? !goRight : goRight;
      if (isDescend) { if (active?.kind === "category") setTreePath([...treePath, 0]); }
      else if (treePath.length > 1) setTreePath(treePath.slice(0, -1));
    } else if (e.key === "Enter") {
      if (active?.kind === "category") setTreePath([...treePath, 0]);
      else if (active?.kind === "leaf") onSelect(active.entry);
    }
  }

  return (
    <div
      ref={ref}
      className="solenoid-add-menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? "visible" : "hidden" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="solenoid-add-menu__heading">Add node</div>
      <div className="solenoid-add-menu__panel">
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
              <div
                key={leaf.type}
                ref={i === activeIndex ? activeRef : undefined}
                className={`solenoid-add-menu__item${leaf.accent ? " solenoid-add-menu__item--accent" : ""}${i === activeIndex ? " solenoid-add-menu__item--active" : ""}`}
                title={leaf.description}
                style={leaf.accent ? ({ "--item-accent": leaf.accent } as CSSProperties) : undefined}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => onSelect(leaf)}
              >
                {leaf.label}
                {leaf.packs?.length ? <PackDot packs={leaf.packs} /> : null}
              </div>
            ))
          ) : (
            <div className="solenoid-add-menu__empty">No matches</div>
          )
        ) : (
          <TreeMenu entries={entries} depth={0} path={treePath} onHover={handleHover} onOpenCategory={handleOpenCategory} onSelect={onSelect} onSubmenuSide={setSubmenuSide} />
        )}
      </div>
    </div>
  );
}
