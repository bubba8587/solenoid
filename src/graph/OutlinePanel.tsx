// [[C88]] collapsedGroupCard, [[C85]] groupPushDeterministic
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { getActiveEditor as getEditor, getActiveView as getView } from "./activeGraph";
import { selectNode, unselectAllNodes } from "./canvasCommands";
import { connectionVersionStore } from "./graphSignals";
import { outlineSearch } from "./outlineStore";
import { keyUnderModal } from "./modalGuard";
import { registerChrome } from "./chromeToggle";
import { touchSelectStore } from "./touchSelectStore";
import { IS_COARSE, isMobile } from "./coarse";
import { connectionDialog } from "./connectionDialogStore";
import { nodeConnections } from "./nodeNames";
import {
  GroupNode, FormatControllerNode, DisplayNode,
  nodeAccent,
} from "./nodeClasses";
import { setGroupsCollapsed } from "./groupPush";
import { measuredBox } from "./nodeSize";
import { appThemeStore } from "./appTheme";
import { themeAccent, resolveColor, hexToRgba } from "./palette";
import "./OutlinePanel.css";
import { CloseIcon } from "./components/CloseIcon";
import { nodeDisplayName, nodeName } from "./catalogUtils";
import { documentStore } from "./documentStore";
import { WorkspaceTree, RowMenu, Glyph, filesAddMenu, type MenuItem } from "./WorkspaceTree";
import { isNavPreview } from "./workspacePreview";
import { searchLibrary, type SearchHit } from "./workspaceSearch";
import { treeKeyStep, typeAhead, type KeyRow, type TreeKey } from "./workspaceRows";
import { nodeNameStore } from "./nodeNameStore";


type Cat = "group" | "input" | "display" | "other";
type Row = {
  id: string;
  label: string;
  type: string;
  color: string;
  selected: boolean;
  depth: number;
  isGroup: boolean;
  collapsed: boolean;
  cat: Cat;
};
type State = { tree: Row[]; flat: Row[] };

function colorOf(n: unknown, mode: "dark" | "light"): string {
  if (n instanceof GroupNode) return themeAccent(resolveColor((n as GroupNode).color), mode);
  return nodeAccent(n as never, mode);
}

function typeOf(n: unknown): string {
  return nodeName(n as object) ?? "";
}

function catOf(n: unknown, wiredIn: Set<string>, wiredOut: Set<string>): Cat {
  if (n instanceof GroupNode) return "group";
  if (n instanceof DisplayNode) return "display";
  const io = n as { id: string; inputs?: Record<string, unknown>; outputs?: Record<string, unknown> };
  const noInputSockets = Object.keys(io.inputs ?? {}).length === 0;
  const hasOutputSockets = Object.keys(io.outputs ?? {}).length > 0;
  if (noInputSockets && hasOutputSockets) return "input";
  if (!wiredIn.has(io.id) && wiredOut.has(io.id)) return "input";
  return "other";
}

type SortMode = "position" | "alpha";
type Sections = { files: boolean; outline: boolean };
type LayoutMode = "stacked" | "tree";

const SECTIONS_KEY = "solenoid.navSections";
const SPLIT_KEY = "solenoid.navSplit";
const LAYOUT_KEY = "solenoid.navLayout";
const WIDTH_KEY = "solenoid.navWidth";
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, 200), 480));

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

function buildState(mode: "dark" | "light", sortMode: SortMode): State {
  const editor = getEditor();
  if (!editor) return { tree: [], flat: [] };
  const view = getView();
  const nodes = editor.getNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const conns = editor.getConnections();
  const wiredIn = new Set(conns.map((c) => c.target));
  const wiredOut = new Set(conns.map((c) => c.source));

  const labelOf = (n: (typeof nodes)[number]) => nodeDisplayName(n);
  const posOf = (n: (typeof nodes)[number]) => view?.position(n.id) ?? { x: 0, y: 0 };
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
      label: nodeDisplayName(n),
      type: typeOf(n),
      color,
      selected: !!(n as { selected?: boolean }).selected,
      depth,
      isGroup,
      collapsed: isGroup ? (n as GroupNode).collapsed : false,
      cat: catOf(n, wiredIn, wiredOut),
    };
  };

  const flat = sorted(nodes.filter((n) => !(n instanceof FormatControllerNode))).map((n) => rowOf(n, 0));

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

/** Shared with the palette's jump-to-node. */
async function focusNode(id: string) {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  unselectAllNodes();
  selectNode(id, false);
  const node = editor.getNode(id);
  const box = measuredBox(view, id, editor);
  if (!node || !box) return;
  const { k } = view.transform;
  const rect = view.container.getBoundingClientRect();
  // measuredBox: a collapsed group's stored box is its expanded one.
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  await view.pan(rect.width / 2 - cx * k, rect.height / 2 - cy * k);
}

function toggleGroup(id: string) {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  const g = editor.getNode(id);
  if (!(g instanceof GroupNode)) return;
  void setGroupsCollapsed(editor, view, [g], !g.collapsed);
}

export function toggleAllGroups() {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return;
  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  if (groups.length === 0) return;
  const collapse = groups.some((g) => !g.collapsed);
  void setGroupsCollapsed(editor, view, groups, collapse);
}

/** Reads the editor directly: callers must subscribe to groupCollapseStore to re-render. */
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

export function OutlinePanel() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const mode = appThemeStore.getMode();
  const [open, setOpen] = useState(false);
  const preview = isNavPreview();
  const [layout, setLayout] = useState<LayoutMode>(() => (preview && readJson<LayoutMode>(LAYOUT_KEY, "stacked") === "tree" ? "tree" : "stacked"));
  const setLayoutMode = (m: LayoutMode) => { setLayout(m); writeJson(LAYOUT_KEY, m); };
  // A phone shows one section at a time and opens on the Outline, where Search lands.
  const [sections, setSections] = useState<Sections>(() =>
    isMobile() ? { files: false, outline: true } : readJson<Sections>(SECTIONS_KEY, { files: true, outline: true }));
  const toggleSection = (k: keyof Sections) =>
    setSections((prev) => {
      const opening = !prev[k];
      const next = isMobile() ? { files: false, outline: false, [k]: opening } : { ...prev, [k]: opening };
      if (!isMobile()) writeJson(SECTIONS_KEY, next);
      return next;
    });
  const [filesH, setFilesH] = useState<number>(() => readJson<number>(SPLIT_KEY, 180));
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; sub?: MenuItem[] } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [navW, setNavW] = useState<number>(() => clampWidth(readJson<number>(WIDTH_KEY, 248)));
  useEffect(() => {
    if (!open || isMobile()) return;
    document.body.style.setProperty("--nav-w", `${navW}px`);
    return () => { document.body.style.removeProperty("--nav-w"); };
  }, [open, navW]);
  const startWidthDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = navW;
    let w = w0;
    const move = (ev: PointerEvent) => { w = clampWidth(w0 + ev.clientX - x0); setNavW(w); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); writeJson(WIDTH_KEY, w); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const revealOpenDoc = () => {
    if (!sections.files) toggleSection("files");
    const id = documentStore.currentId();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(`[data-key="d:${CSS.escape(id ?? "")}"]`);
      el?.scrollIntoView({ block: "nearest" });
      el?.focus();
    }));
  };
  const startSplitDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = filesH;
    const max = (panelRef.current?.clientHeight ?? 600) - 200;
    let h = h0;
    const move = (ev: PointerEvent) => { h = Math.round(Math.min(Math.max(h0 + ev.clientY - y0, 56), Math.max(56, max))); setFilesH(h); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); writeJson(SPLIT_KEY, h); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<"input" | "display">>(new Set());
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

  // buildState's poll signature ignores connections, so the inline lists subscribe here.
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
    void getEditor()?.removeConnection(id);
  };

  // Focus runs in the effect below, after the panel renders, so Ctrl+F works on a collapsed panel.
  const requestSearch = useCallback(() => {
    pendingFocus.current = true;
    setOpen(true);
    setSections((prev) => (prev.outline ? prev : isMobile() ? { files: false, outline: true } : { ...prev, outline: true }));
    setSearchSignal((s) => s + 1);
  }, []);

  useEffect(() => outlineSearch.register(requestSearch), [requestSearch]);
  // Re-registers on `open` change so the isOpen getter stays current.
  useEffect(() => registerChrome("navigator", { isOpen: () => open, setOpen }), [open]);
  useEffect(() => {
    document.body.classList.toggle("solenoid-nav-open", open);
    return () => document.body.classList.remove("solenoid-nav-open");
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A modal keeps its own Ctrl+F; the search would open behind it and take its focus.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyF" && !keyUnderModal(e)) { e.preventDefault(); requestSearch(); }
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
    if (!open) return;
    let prev = "";
    const tick = () => {
      const next = buildState(appThemeStore.getMode(), sortMode);
      // Order-sensitive, so a Position-mode re-sort from a moved node changes it without hashing positions.
      const sig = next.tree.map((r) => `${r.id}:${r.depth}:${r.collapsed ? 1 : 0}:${r.selected ? 1 : 0}:${r.label}:${r.color}:${r.cat}`).join("|")
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

  // Everywhere also searches the other documents in the library; workspace-tree.md § The pane.
  const [everywhere, setEverywhere] = useState(false);
  // While the search stays in this document, only the header's name and count re-render the panel; every autosave would rebuild the whole list.
  const libVersion = useSyncExternalStore(
    documentStore.subscribe,
    () => (everywhere ? `v${documentStore.version()}` : `${documentStore.currentName()}|${documentStore.list().length}`),
  );
  const hits = useMemo(
    () => (everywhere && filters.size === 0 ? searchLibrary(documentStore.searchable(), documentStore.currentId(), query) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [everywhere, filters, query, libVersion],
  );
  const openHit = async (h: SearchHit) => {
    await documentStore.open(h.docId);
    // The open can stay put (a load in progress, a failed capture or load); names repeat across documents, so never look one up in the wrong one.
    if (h.kind !== "node" || documentStore.currentId() !== h.docId) return;
    const editor = getEditor();
    if (!editor) return;
    const byName = h.nodeName ? nodeNameStore.byName(h.nodeName) : undefined;
    const id = byName ?? editor.getNodes().find((n) => n.constructor.name === h.nodeType && nodeDisplayName(n) === h.nodeLabel)?.id;
    if (id) requestAnimationFrame(() => void focusNode(id));
  };

  const lastClicked = useRef<string | null>(null);
  // The Outline is an ARIA tree too, with the Files tree's keys; workspace-tree.md § The pane.
  const [rowFocus, setRowFocus] = useState<string | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const typedRef = useRef({ text: "", at: 0 });
  const keyRows: KeyRow[] = view.map((r) => ({ key: r.id, depth: r.depth, expandable: r.isGroup && !query.trim() && filters.size === 0, expanded: !r.collapsed, label: r.label }));
  const focusable = keyRows.some((r) => r.key === rowFocus) ? rowFocus : view.find((r) => r.selected)?.id ?? view[0]?.id;
  const moveRowFocus = (id: string | undefined) => {
    if (!id) return;
    setRowFocus(id);
    requestAnimationFrame(() => rowEls.current.get(id)?.focus());
  };
  const onListKey = (e: KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest(".solenoid-outline__row[data-node]") as HTMLElement | null;
    if (!el || e.target !== el) return;
    const id = el.dataset.node!;
    // Keys the tree takes stop here, or the canvas would nudge the selected cards on the same arrow.
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    const steps: Record<string, TreeKey> = { ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end", ArrowLeft: "left", ArrowRight: "right" };
    if (steps[e.key]) {
      take();
      const out = treeKeyStep(keyRows, id, steps[e.key]);
      if (out.toggle) toggleGroup(out.toggle.key);
      moveRowFocus(out.focus);
      return;
    }
    if (e.key === "Enter") { take(); handleRowDoubleClick(id); return; }
    if (e.key === " ") {
      take();
      const editor = getEditor();
      if (!editor) return;
      const sel = new Set(editor.getNodes().filter((n) => (n as { selected?: boolean }).selected).map((n) => n.id));
      sel.has(id) ? sel.delete(id) : sel.add(id);
      lastClicked.current = id;
      unselectAllNodes();
      for (const s of sel) selectNode(s, true);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      take();
      const now = performance.now();
      typedRef.current = { text: (now - typedRef.current.at < 700 ? typedRef.current.text : "") + e.key, at: now };
      const i = keyRows.findIndex((r) => r.key === id);
      moveRowFocus(typeAhead(keyRows, typedRef.current.text.length > 1 ? keyRows[i - 1]?.key ?? id : id, typedRef.current.text));
    }
  };

  const handleRowDoubleClick = (id: string) => {
    lastClicked.current = id;
    void focusNode(id);
  };
  const handleRowClick = (e: MouseEvent, id: string) => {
    // IS_COARSE, not isMobile(): a tablet reaches select mode from the top bar while isMobile() is false.
    const accumulate = e.ctrlKey || e.metaKey || (IS_COARSE && touchSelectStore.get());
    const range = e.shiftKey;
    if (!accumulate && !range) {
      if (isMobile()) { void focusNode(id); lastClicked.current = id; }
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

  const docName = documentStore.currentName();
  const isPhone = isMobile();
  const controls = (
    <>
      <div className="solenoid-outline__searchwrap">
        <input
          ref={inputRef}
          className="solenoid-outline__search"
          placeholder={everywhere ? "Search every document…" : "Search name or type…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className={`solenoid-outline__scope${everywhere ? " solenoid-outline__scope--on" : ""}`}
          title={everywhere ? "Search this document" : "Search every document"}
          aria-label="Search every document"
          aria-pressed={everywhere}
          onClick={() => { setEverywhere((v) => !v); inputRef.current?.focus(); }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6" />
            <path d="M2 8 H14 M8 2 C5.6 4.6 5.6 11.4 8 14 M8 2 C10.4 4.6 10.4 11.4 8 14" />
          </svg>
        </button>
      </div>
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
          title="Sort by canvas position: top→bottom, then left→right"
          onClick={() => setSort("position")}
        >
          Position
        </button>
        <button
          className={`solenoid-outline__sortbtn${sortMode === "alpha" ? " solenoid-outline__sortbtn--on" : ""}`}
          title="Sort alphabetically"
          onClick={() => setSort("alpha")}
        >
          A–Z
        </button>
      </div>
    </>
  );
  const listBody = (
    <div className="solenoid-outline__tree" role="tree" aria-label="Outline" onKeyDown={(e) => onListKey(e.nativeEvent)}>
        {hits.length > 0 && view.length > 0 && <div className="solenoid-outline__heading">This document</div>}
        {view.length === 0 ? (
          hits.length === 0 && <div className="solenoid-outline__empty">{state.flat.length === 0 ? "No nodes" : "No matches"}</div>
        ) : (
          view.map((r) => {
            const connCount = r.isGroup ? 0 : connCounts.get(r.id) ?? 0;
            const showConns = !r.isGroup && expandedConns.has(r.id);
            return (
            <Fragment key={r.id}>
            <div
              className={`solenoid-outline__row${r.selected ? " solenoid-outline__row--sel" : ""}${r.isGroup ? " solenoid-outline__row--group" : ""}`}
              style={{
                "--depth": r.depth,
                ...(r.isGroup
                  ? {
                      background: hexToRgba(r.color, 0.24),
                      "--group-edge": hexToRgba(r.color, 0.55),
                    }
                  : null),
              } as CSSProperties}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={r.isGroup ? !r.collapsed : undefined}
              aria-selected={r.selected}
              data-node={r.id}
              tabIndex={r.id === focusable ? 0 : -1}
              ref={(el) => { if (el) rowEls.current.set(r.id, el); else rowEls.current.delete(r.id); }}
              onFocus={(e) => { if (e.target === e.currentTarget) setRowFocus(r.id); }}
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
                  title={showConns ? "Hide connections" : "Show connections"}
                  aria-label="Toggle connections"
                  onClick={(e) => { e.stopPropagation(); toggleConns(r.id); }}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 11 L11 5" />
                    <circle cx="3.5" cy="12.5" r="2" fill="currentColor" stroke="none" />
                    <circle cx="12.5" cy="3.5" r="2" fill="currentColor" stroke="none" />
                  </svg>
                  <span className="solenoid-outline__plug-count">{connCount}</span>
                </button>
              )}
            </div>
            {showConns && (
              <div className="solenoid-outline__conns" style={{ "--depth": r.depth } as CSSProperties}>
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
        {hits.length > 0 && (
          <>
            <div className="solenoid-outline__heading">Other documents</div>
            {hits.map((h, i) => (
              <div
                key={`${h.kind}:${h.docId}:${i}`}
                className={`solenoid-outline__row solenoid-outline__hit solenoid-outline__hit--${h.kind}`}
                title={h.detail}
                onClick={() => void openHit(h)}
              >
                {h.kind === "doc"
                  ? <span className="solenoid-outline__hitglyph"><Glyph kind="doc" /></span>
                  : <span className="solenoid-outline__dot solenoid-outline__dot--hit" />}
                <span className="solenoid-outline__label">{h.label}</span>
                {h.detail && <span className="solenoid-outline__hitwhere">{h.detail}</span>}
              </div>
            ))}
          </>
        )}
    </div>
  );
  const collapseAll = (
    <>
        {groupRows.length > 0 && (
          <button
            className="solenoid-outline__collapse-all"
            title={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
            aria-label={allGroupsCollapsed ? "Expand all groups" : "Collapse all groups"}
            onClick={toggleAllGroups}
          >
            {/* The glyph shows the action: converging to collapse, diverging to expand. */}
            <svg
              viewBox="0 0 16 16" width="14" height="14" fill="none"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M2 4 H8" />
              <path d="M2 8 H8" />
              <path d="M2 12 H8" />
              {allGroupsCollapsed ? (
                <>
                  <path d="M10 6 L12 4 L14 6" />
                  <path d="M10 10 L12 12 L14 10" />
                </>
              ) : (
                <>
                  <path d="M10 4 L12 6 L14 4" />
                  <path d="M10 12 L12 10 L14 12" />
                </>
              )}
            </svg>
          </button>
        )}
    </>
  );

  return (
    <div
      className={`solenoid-outline solenoid-outline--${layout}`}
      ref={panelRef}
      style={isPhone ? undefined : { width: navW }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!isPhone && <div className="solenoid-outline__resize" role="separator" aria-orientation="vertical" aria-label="Resize navigator" onPointerDown={startWidthDrag} />}
      <div className="solenoid-outline__header">
        <span className="solenoid-outline__title">Navigator</span>
        <span className="solenoid-outline__spacer" />
        {preview && (
          <button
            className="solenoid-outline__layout"
            title={layout === "stacked" ? "Show as one tree" : "Show Files and Outline apart"}
            onClick={() => setLayoutMode(layout === "stacked" ? "tree" : "stacked")}
          >
            {layout === "stacked" ? "One tree" : "Stacked"}
          </button>
        )}
        {layout === "tree" && (
          <button
            className="solenoid-nav-sec__btn"
            title="New"
            aria-label="New"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu({ x: r.left, y: r.bottom + 4 }); }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3 V13 M3 8 H13" /></svg>
          </button>
        )}
        {layout === "tree" && collapseAll}
        <button className="solenoid-outline__collapse" title="Hide navigator" aria-label="Hide navigator" onClick={() => setOpen(false)}><CloseIcon size={14} /></button>
      </div>
      {layout === "tree" ? (
        <>
          {controls}
          <div className="solenoid-outline__list solenoid-outline__list--tree">
            <WorkspaceTree outline={listBody} />
          </div>
        </>
      ) : (
        <>
          <div className={`solenoid-nav-sec solenoid-nav-sec--files${sections.files ? " solenoid-nav-sec--open" : ""}`}>
            <div className="solenoid-nav-sec__head">
              <button className="solenoid-nav-sec__toggle" aria-expanded={sections.files} onClick={() => toggleSection("files")}>
                <SectionChevron open={sections.files} />
                <span className="solenoid-nav-sec__title">Files</span>
                <span className="solenoid-nav-sec__count">{documentStore.list().length}</span>
              </button>
              <button
                className="solenoid-nav-sec__btn"
                title="New"
                aria-label="New"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  if (!sections.files) toggleSection("files");
                  setAddMenu({ x: r.left, y: r.bottom + 4 });
                }}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3 V13 M3 8 H13" /></svg>
              </button>
            </div>
            {sections.files && (
              <div
                className="solenoid-nav-sec__body"
                style={sections.outline && !isPhone ? { maxHeight: filesH } : undefined}
              >
                <WorkspaceTree />
              </div>
            )}
          </div>
          {sections.files && sections.outline && !isPhone && (
            <div className="solenoid-nav-split" role="separator" aria-orientation="horizontal" onPointerDown={startSplitDrag} />
          )}
          <div className={`solenoid-nav-sec solenoid-nav-sec--outline${sections.outline ? " solenoid-nav-sec--open" : ""}`}>
            <div className="solenoid-nav-sec__head">
              <button className="solenoid-nav-sec__toggle solenoid-nav-sec__toggle--short" aria-expanded={sections.outline} onClick={() => toggleSection("outline")}>
                <SectionChevron open={sections.outline} />
                <span className="solenoid-nav-sec__title">Outline</span>
              </button>
              <button className="solenoid-nav-sec__crumb" title="Show in Files" onClick={revealOpenDoc}>{docName}</button>
              <span className="solenoid-nav-sec__count">{state.flat.length}</span>
              {collapseAll}
            </div>
            {sections.outline && (
              <>
                {controls}
                <div className="solenoid-outline__list">{listBody}</div>
              </>
            )}
          </div>
        </>
      )}
      {addMenu && (
        <RowMenu
          key={addMenu.sub ? "sub" : "root"}
          at={addMenu}
          items={addMenu.sub ?? filesAddMenu((sub) => setAddMenu({ ...addMenu, sub }))}
          onClose={() => setAddMenu(null)}
        />
      )}
    </div>
  );
}

function SectionChevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "none" }} aria-hidden="true">
      <path d="M6 4 L10 8 L6 12" />
    </svg>
  );
}
