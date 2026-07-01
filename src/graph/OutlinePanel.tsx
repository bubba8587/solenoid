import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { getEditor, getArea, selectNode, unselectAllNodes, connectionVersionStore } from "./process";
import { outlineSearch } from "./outlineStore";
import { registerChrome } from "./chromeToggle";
import { touchSelectStore } from "./touchSelectStore";
import { IS_MOBILE } from "./coarse";
import { connectionDialog } from "./connectionDialogStore";
import { nodeConnections } from "./nodeNames";
import {
  GroupNode, FormatControllerNode, DisplayNode,
  nodeKindOf, NODE_KIND_ACCENTS,
} from "./rete-nodes";
import { setGroupsCollapsed } from "./groupPush";
import { appThemeStore } from "./appTheme";
import { themeAccent, resolveColor, hexToRgba } from "./palette";
import "./OutlinePanel.css";
import { CloseIcon } from "./components/CloseIcon";

/**
 * Left-docked outline / navigator. Respects Group membership (members nested
 * under their group) and collapse state (a collapsed group hides its members,
 * matching the canvas; its chevron toggles the canvas collapse too). Format
 * Controllers are filtered out entirely (their navigator semantics get murky
 * with FC chains and the Convert hybrid). Quick filters narrow to Inputs /
 * Displays; search flattens across everything. Reads names/kinds/structure only
 * and polls a few times a second.
 */

type Cat = "group" | "input" | "display" | "other";
type Row = {
  id: string;
  label: string;
  type: string; // class-derived type/function name (matches the node hover hint)
  color: string;
  selected: boolean;
  depth: number;
  isGroup: boolean;
  collapsed: boolean;
  cat: Cat;
};
type State = { tree: Row[]; flat: Row[] };

function colorOf(n: unknown, mode: "dark" | "light"): string {
  const base = n instanceof GroupNode
    ? resolveColor((n as GroupNode).color) // resolve the palette SLOT to a hex, exactly like GroupNode does
    : NODE_KIND_ACCENTS[nodeKindOf(n as never)] ?? "#8a8f98";
  return themeAccent(base, mode);
}

// Same readable type string the node header shows on hover (see nodeKit's
// typeHint): class name minus the "Node" suffix, camelCase split.
function typeOf(n: unknown): string {
  return (n as { constructor: { name: string } }).constructor.name
    .replace(/Node$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

function catOf(n: unknown): Cat {
  if (n instanceof GroupNode) return "group";
  if (n instanceof DisplayNode) return "display";
  // An "input" is a SOURCE: any node with no input sockets of its own that still
  // produces an output (so it feeds the graph without anything feeding it). Structural,
  // not a hand-listed set — so every literal / constant / source counts (Text, Boolean,
  // Date, Table, Frame, …), not just Number Input. Plus the curated `input` kind, which
  // catches sources that carry only CONFIG inputs (Slider's min/max/step).
  const io = n as { inputs?: Record<string, unknown>; outputs?: Record<string, unknown> };
  const noInputs = Object.keys(io.inputs ?? {}).length === 0;
  const hasOutputs = Object.keys(io.outputs ?? {}).length > 0;
  if ((noInputs && hasOutputs) || nodeKindOf(n as never) === "input") return "input";
  return "other";
}

type SortMode = "position" | "alpha";

function buildState(mode: "dark" | "light", sortMode: SortMode): State {
  const editor = getEditor();
  if (!editor) return { tree: [], flat: [] };
  const area = getArea();
  const nodes = editor.getNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Sort SIBLINGS (top-level nodes, and members within a group) by the chosen
  // mode. Alpha = label A→Z; Position = canvas reading order — top→bottom in loose
  // row bands, then left→right within a band. ROW_BAND is intentionally GENEROUS
  // (biased toward left-right): nodes within ~120px of vertical land in one band
  // and read left→right, so the order tracks columns/rows the way the eye scans
  // rather than reacting to small y jitter. Reads coords from area.nodeViews, so
  // the order tracks the canvas as nodes move.
  const labelOf = (n: (typeof nodes)[number]) => (n as { label?: string }).label ?? "";
  const posOf = (n: (typeof nodes)[number]) => area?.nodeViews.get(n.id)?.position ?? { x: 0, y: 0 };
  const ROW_BAND = 120;
  const cmp = sortMode === "alpha"
    ? (a: (typeof nodes)[number], b: (typeof nodes)[number]) =>
        labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true, sensitivity: "base" })
    : (a: (typeof nodes)[number], b: (typeof nodes)[number]) => {
        const pa = posOf(a), pb = posOf(b);
        return (Math.round(pa.y / ROW_BAND) - Math.round(pb.y / ROW_BAND)) || (pa.x - pb.x);
      };
  const sorted = (arr: (typeof nodes)[number][]) => [...arr].sort(cmp);

  const memberOf = new Map<string, string>();
  for (const n of nodes) {
    if (n instanceof GroupNode) for (const m of n.members) memberOf.set(m, n.id);
  }

  const rowOf = (n: (typeof nodes)[number], depth: number): Row => {
    const isGroup = n instanceof GroupNode;
    const color = colorOf(n, mode);
    return {
      id: n.id,
      label: (n as { label?: string }).label ?? "Node",
      type: typeOf(n),
      color,
      selected: !!(n as { selected?: boolean }).selected,
      depth,
      isGroup,
      collapsed: isGroup ? (n as GroupNode).collapsed : false,
      cat: catOf(n),
    };
  };

  // Flat list (all real nodes, FCs excluded) for search / filters.
  const flat = sorted(nodes.filter((n) => !(n instanceof FormatControllerNode))).map((n) => rowOf(n, 0));

  // Tree (respects membership + collapse) for browsing.
  const tree: Row[] = [];
  const seen = new Set<string>();
  const push = (n: (typeof nodes)[number], depth: number) => {
    if (seen.has(n.id) || n instanceof FormatControllerNode) return;
    seen.add(n.id);
    tree.push(rowOf(n, depth));
    if (n instanceof GroupNode && !n.collapsed) {
      const members = n.members.map((mid) => byId.get(mid)).filter((m): m is (typeof nodes)[number] => !!m);
      for (const m of sorted(members)) push(m, depth + 1);
    }
  };
  for (const n of sorted(nodes.filter((n) => !memberOf.has(n.id)))) push(n, 0);

  return { tree, flat };
}

async function focusNode(id: string) {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;
  unselectAllNodes();
  selectNode(id, false);
  const node = editor.getNode(id);
  const view = area.nodeViews.get(id);
  if (!node || !view) return;
  const { k } = area.area.transform;
  const rect = area.container.getBoundingClientRect();
  const w = (node as { width?: number }).width || view.element.offsetWidth || 100;
  const h = (node as { height?: number }).height || view.element.offsetHeight || 50;
  const cx = view.position.x + w / 2;
  const cy = view.position.y + h / 2;
  await area.area.translate(rect.width / 2 - cx * k, rect.height / 2 - cy * k);
}

function toggleGroup(id: string) {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;
  const g = editor.getNode(id);
  if (!(g instanceof GroupNode)) return;
  // Centralised toggle: flip + sync + re-render + settle + push/restore.
  void setGroupsCollapsed(editor, area, [g], !g.collapsed);
}

// Collapse every group, or expand them all if they're already collapsed.
// Routes through setGroupsCollapsed so the neighbour-push (and the top-left →
// bottom-right expand sweep) is applied, same as the single-group toggle.
// Exported so the TopBar's layout pill can host a duplicate of this button
// (shared handler, no behavior change).
export function toggleAllGroups() {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return;
  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  if (groups.length === 0) return;
  const collapse = groups.some((g) => !g.collapsed); // any expanded → collapse all
  void setGroupsCollapsed(editor, area, groups, collapse);
}

/** Live group-collapse summary for the toggle button (icon direction +
 *  whether to show it at all). Reads the editor directly, so callers should
 *  subscribe to groupCollapseStore to re-render on changes. */
export function groupCollapseSummary(): { hasGroups: boolean; allCollapsed: boolean } {
  const editor = getEditor();
  if (!editor) return { hasGroups: false, allCollapsed: false };
  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  return { hasGroups: groups.length > 0, allCollapsed: groups.length > 0 && groups.every((g) => g.collapsed) };
}

const FILTERS: { key: "input" | "display"; label: string }[] = [
  { key: "input", label: "Inputs" },
  { key: "display", label: "Displays" },
];

// Touch has no Ctrl/Shift, so a plain row tap has to do something. In mobile
// mode a tap selects + focuses the node, and a tap while select mode is on
// accumulates (the navigator's multi-select path on mobile).

export function OutlinePanel() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const mode = appThemeStore.getMode();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<"input" | "display">>(new Set());
  // Navigator sort order, persisted. Position = canvas reading order; Alpha = A→Z.
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (typeof localStorage !== "undefined" && localStorage.getItem("solenoid.navSort") === "alpha" ? "alpha" : "position"),
  );
  const setSort = (m: SortMode) => {
    setSortMode(m);
    try { localStorage.setItem("solenoid.navSort", m); } catch { /* private mode */ }
  };
  const [state, setState] = useState<State>({ tree: [], flat: [] });
  const [searchSignal, setSearchSignal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef(false);

  // Per-node connection list (the "plug" toggle). Live-tracks connection changes
  // via connectionVersionStore — buildState's poll signature ignores connections,
  // so without this the inline lists wouldn't refresh on wire/unwire.
  const connVersion = useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const [expandedConns, setExpandedConns] = useState<Set<string>>(new Set());
  const connCounts = useMemo(() => {
    const m = new Map<string, number>();
    const editor = getEditor();
    if (editor) {
      for (const c of editor.getConnections()) {
        m.set(c.source, (m.get(c.source) ?? 0) + 1);
        m.set(c.target, (m.get(c.target) ?? 0) + 1);
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connVersion, state]);
  const toggleConns = (id: string) =>
    setExpandedConns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const deleteConn = (id: string) => {
    // The editor's connectionremoved pipe reprocesses + bumps the version, which
    // re-renders this list.
    void getEditor()?.removeConnection(id);
  };

  // App-bar search / Ctrl+F: open the panel and focus its search field. We set a
  // pending flag and bump a signal; the focus runs in the effect below AFTER the
  // panel (and its input) has actually rendered, so it works even when the
  // panel was collapsed.
  const requestSearch = useCallback(() => {
    pendingFocus.current = true;
    setOpen(true);
    setSearchSignal((s) => s + 1);
  }, []);

  useEffect(() => outlineSearch.register(requestSearch), [requestSearch]);
  // Register with the chrome-toggle group so the Tab hotkey can open/close the
  // navigator along with the pin / alert HUDs. Re-registers on `open` change so
  // its isOpen getter stays current.
  useEffect(() => registerChrome("navigator", { isOpen: () => open, setOpen }), [open]);
  // While the expanded panel is open, flag <body> so screen-anchored popups that
  // dock to the bottom-left (the Conduit / Standoff inspector toolbars, which
  // portal to body) shift right past the panel instead of hiding under it.
  useEffect(() => {
    document.body.classList.toggle("solenoid-nav-open", open);
    return () => document.body.classList.remove("solenoid-nav-open");
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Plain Ctrl/Cmd+F only — Ctrl+Shift+F is the group autofit hotkey.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyF") { e.preventDefault(); requestSearch(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestSearch]);
  useEffect(() => {
    if (pendingFocus.current && open) {
      pendingFocus.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [searchSignal, open]);

  useEffect(() => {
    if (!open) return; // no need to track the graph while the panel is hidden
    let prev = "";
    const tick = () => {
      const next = buildState(appThemeStore.getMode(), sortMode);
      // The sig is order-sensitive (join preserves array order), so a Position-mode
      // re-sort caused by a node moving changes it → the list re-renders within a
      // poll. No need to hash positions separately.
      const sig = next.tree.map((r) => `${r.id}:${r.depth}:${r.collapsed ? 1 : 0}:${r.selected ? 1 : 0}:${r.label}:${r.color}`).join("|")
        + "#" + next.flat.map((r) => r.id).join(",");
      if (sig !== prev) { prev = sig; setState(next); }
    };
    tick();
    const id = window.setInterval(tick, 300);
    return () => window.clearInterval(id);
  }, [mode, open, sortMode]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtering = q !== "" || filters.size > 0;
    if (!filtering) return state.tree;
    return state.flat.filter(
      (r) =>
        (filters.size === 0 || filters.has(r.cat as "input" | "display")) &&
        (q === "" || r.label.toLowerCase().includes(q) || r.type.toLowerCase().includes(q)),
    );
  }, [state, query, filters]);

  // Row interaction: plain click does nothing (avoids the jumpy per-click
  // recentering); DOUBLE-click jumps to + focuses the node. Ctrl/Cmd-click
  // toggles a node in/out of the selection; Shift-click range-selects from the
  // last click. Modifier clicks mirror canvas multi-select and don't recenter.
  const lastClicked = useRef<string | null>(null);
  const handleRowDoubleClick = (id: string) => {
    lastClicked.current = id;
    void focusNode(id);
  };
  const handleRowClick = (e: MouseEvent, id: string) => {
    // Ctrl/Cmd (desktop) or select mode (touch) accumulates; Shift range-selects.
    const accumulate = e.ctrlKey || e.metaKey || (IS_MOBILE && touchSelectStore.get());
    const range = e.shiftKey;
    if (!accumulate && !range) {
      // Plain: desktop is a deliberate no-op (avoids jumpy recentering); on
      // touch it selects and jumps to the node, since there's no double-click.
      if (IS_MOBILE) { void focusNode(id); lastClicked.current = id; }
      return;
    }
    const editor = getEditor();
    if (!editor) return;
    const sel = new Set(editor.getNodes().filter((n) => (n as { selected?: boolean }).selected).map((n) => n.id));
    if (range && lastClicked.current) {
      const ids = view.map((r) => r.id);
      const a = ids.indexOf(lastClicked.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) sel.add(ids[i]);
      } else sel.add(id);
    } else {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      lastClicked.current = id;
    }
    unselectAllNodes();
    for (const s of sel) selectNode(s, true);
  };

  const toggleFilter = (k: "input" | "display") =>
    setFilters((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  if (!open) {
    // Collapsed: a small pill pairing the navigator toggle with a search button.
    // Search is just "open the navigator AND focus its search field", so the two
    // live together rather than search hiding off in the app menu.
    return (
      <div className="solenoid-outline__open-pill" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className="solenoid-outline__open-btn solenoid-outline__open-btn--nav"
          title="Open navigator"
          aria-label="Open navigator"
          onClick={() => setOpen(true)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="10" rx="1.6" />
            <path d="M6 3 V13" />
          </svg>
        </button>
        <button
          className="solenoid-outline__open-btn"
          title="Find node (Ctrl+F)"
          aria-label="Find node"
          onClick={requestSearch}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.4 10.4 14 14" />
          </svg>
        </button>
      </div>
    );
  }

  const groupRows = state.flat.filter((r) => r.isGroup);
  const allGroupsCollapsed = groupRows.length > 0 && groupRows.every((r) => r.collapsed);

  return (
    <div className="solenoid-outline" onPointerDown={(e) => e.stopPropagation()}>
      <div className="solenoid-outline__header">
        <span className="solenoid-outline__title">Outline</span>
        <span className="solenoid-outline__count">{state.flat.length}</span>
        {groupRows.length > 0 && (
          <button
            className="solenoid-outline__collapse-all"
            title={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
            aria-label={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
            onClick={toggleAllGroups}
          >
            <svg
              viewBox="0 0 16 16" width="14" height="14" fill="none"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: allGroupsCollapsed ? "rotate(180deg)" : undefined }}
            >
              <path d="M4 9 L8 5 L12 9" />
              <path d="M4 13 L8 9 L12 13" />
            </svg>
          </button>
        )}
        <button className="solenoid-outline__collapse" title="Hide outline" onClick={() => setOpen(false)}><CloseIcon size={14} /></button>
      </div>
      <input
        ref={inputRef}
        className="solenoid-outline__search"
        placeholder="Search name or type…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="solenoid-outline__filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`solenoid-outline__chip${filters.has(f.key) ? " solenoid-outline__chip--on" : ""}`}
            onClick={() => toggleFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="solenoid-outline__sortrow">
        <span className="solenoid-outline__sortlabel">Sort</span>
        <button
          className={`solenoid-outline__sortbtn${sortMode === "position" ? " solenoid-outline__sortbtn--on" : ""}`}
          title="Sort by canvas position (reading order: top→bottom, left→right)"
          onClick={() => setSort("position")}
        >
          Position
        </button>
        <button
          className={`solenoid-outline__sortbtn${sortMode === "alpha" ? " solenoid-outline__sortbtn--on" : ""}`}
          title="Sort alphabetically (A→Z)"
          onClick={() => setSort("alpha")}
        >
          A–Z
        </button>
      </div>
      <div className="solenoid-outline__list">
        {view.length === 0 ? (
          <div className="solenoid-outline__empty">{state.flat.length === 0 ? "No nodes" : "No matches"}</div>
        ) : (
          view.map((r) => {
            const connCount = r.isGroup ? 0 : connCounts.get(r.id) ?? 0;
            const showConns = !r.isGroup && expandedConns.has(r.id);
            return (
            <Fragment key={r.id}>
            <div
              className={`solenoid-outline__row${r.selected ? " solenoid-outline__row--sel" : ""}${r.isGroup ? " solenoid-outline__row--group" : ""}`}
              style={{
                paddingLeft: 8 + r.depth * 14,
                ...(r.isGroup
                  // A group reads as a CONTAINER, like on canvas: a muted tint fill inside a
                  // full 1px border in its own color (a FRAME, not a left/right accent stripe —
                  // DESIGN.md). The border gives a group more presence than a selected member
                  // row (which is a borderless accent-soft fill), so nested selections don't
                  // read the same as their group header. Selection adds the accent ring on top.
                  ? {
                      background: hexToRgba(r.color, 0.24),
                      border: `1px solid ${hexToRgba(r.color, 0.55)}`,
                      boxShadow: r.selected ? "inset 0 0 0 2px var(--accent)" : undefined,
                    }
                  : null),
              }}
              onClick={(e) => handleRowClick(e, r.id)}
              onDoubleClick={() => handleRowDoubleClick(r.id)}
            >
              {r.isGroup ? (
                <button
                  className="solenoid-outline__chevron"
                  title={r.collapsed ? "Expand group" : "Collapse group"}
                  onClick={(e) => { e.stopPropagation(); toggleGroup(r.id); }}
                >
                  <svg
                    viewBox="0 0 16 16" width="16" height="16" fill="none"
                    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: r.collapsed ? "none" : "rotate(90deg)" }}
                  >
                    <path d="M6 4 L10 8 L6 12" />
                  </svg>
                </button>
              ) : (
                <span className="solenoid-outline__dot" style={{ background: r.color }} />
              )}
              <span className="solenoid-outline__label">{r.label}</span>
              {connCount > 0 && (
                <button
                  className={`solenoid-outline__plug${showConns ? " solenoid-outline__plug--on" : ""}`}
                  title={showConns ? "Hide connections" : `Connections (${connCount})`}
                  aria-label="Toggle connections"
                  onClick={(e) => { e.stopPropagation(); toggleConns(r.id); }}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    {/* Two sockets joined by a cable — the app's own connection metaphor. */}
                    <path d="M5 11 L11 5" />
                    <circle cx="3.5" cy="12.5" r="2" fill="currentColor" stroke="none" />
                    <circle cx="12.5" cy="3.5" r="2" fill="currentColor" stroke="none" />
                  </svg>
                  <span className="solenoid-outline__plug-count">{connCount}</span>
                </button>
              )}
            </div>
            {showConns && (
              <div className="solenoid-outline__conns" style={{ paddingLeft: 8 + r.depth * 14 + 18 }}>
                {nodeConnections(r.id).map((row) => (
                  <div className="solenoid-outline__conn" key={row.id}>
                    <span className="solenoid-outline__conn-text" title={
                      row.dir === "out"
                        ? `${row.thisSocketLabel} → ${row.otherNodeName} : ${row.otherSocketLabel}`
                        : `${row.otherNodeName} : ${row.otherSocketLabel} → ${row.thisSocketLabel}`
                    }>
                      <span className="solenoid-outline__conn-dir">{row.dir === "out" ? "→" : "←"}</span>
                      <span className="solenoid-outline__conn-sock">{row.thisSocketLabel}</span>
                      <span className="solenoid-outline__conn-other">{row.otherNodeName} : {row.otherSocketLabel}</span>
                    </span>
                    <button
                      className="solenoid-outline__conn-btn"
                      title="Edit connection"
                      aria-label="Edit connection"
                      onClick={(e) => { e.stopPropagation(); connectionDialog.open({ editId: row.id }); }}
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.5 2.5 L13.5 5.5 L6 13 L3 13 L3 10 Z" />
                      </svg>
                    </button>
                    <button
                      className="solenoid-outline__conn-btn solenoid-outline__conn-btn--del"
                      title="Delete connection"
                      aria-label="Delete connection"
                      onClick={(e) => { e.stopPropagation(); deleteConn(row.id); }}
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M4 4 L12 12 M12 4 L4 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
