// [[C132]] workspaceTree. The Navigator's Files tree; workspace-tree.md.
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { documentStore } from "./documentStore";
import { requestConfirm } from "./confirmStore";
import { IS_COARSE } from "./coarse";
import { useMenuClamp } from "./components/menuClamp";
import { PREVIEW_WORKSPACE, isNavPreview } from "./workspacePreview";
import { SEEDS, SEED_GROUPS } from "./seeds";
import {
  libraryRows, previewRows, revealKeys, rekeyExpanded, docFoldedKey, docKey, folderKey, treeKeyStep, typeAhead,
  PREVIEW_EXPANDED, type RowKind, type TreeRow, type TreeKey,
} from "./workspaceRows";
import "./components/popupChrome.css";
import "./WorkspaceTree.css";

const EXPANDED_KEY = "solenoid.navExpanded";

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* private mode or a bad value */ }
  return new Set(PREVIEW_EXPANDED);
}
function saveExpanded(s: Set<string>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...s])); } catch { /* private mode */ }
}

/** The folder new rows land in: the last folder the user picked in the tree. */
const target = { folder: "" };

export function Glyph({ kind, open }: { kind: RowKind; open?: boolean }) {
  const common = { viewBox: "0 0 16 16", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "folder":
      return open
        ? <svg {...common}><path d="M2 12.5 V4 a1 1 0 0 1 1-1 h3 l1.5 1.5 H12 a1 1 0 0 1 1 1 V7" /><path d="M2 12.5 L4 7.5 a1 1 0 0 1 .9-.6 H14 a.6.6 0 0 1 .55.85 L12.7 12 a1 1 0 0 1-.9.5 Z" /></svg>
        : <svg {...common}><path d="M2 4 a1 1 0 0 1 1-1 h3 l1.5 1.5 H13 a1 1 0 0 1 1 1 V12 a1 1 0 0 1-1 1 H3 a1 1 0 0 1-1-1 Z" /></svg>;
    case "doc":
      return <svg {...common}><path d="M4 1.5 H9.5 L13 5 V14 a.5.5 0 0 1-.5.5 h-8.5 a.5.5 0 0 1-.5-.5 V2 a.5.5 0 0 1 .5-.5 Z" /><path d="M9.5 1.5 V5 H13" /></svg>;
    case "pagefolder":
      return <svg {...common}><rect x="4.5" y="2" width="9.5" height="9.5" rx="1.4" /><path d="M2 5 V13 a1 1 0 0 0 1 1 H11" /></svg>;
    case "page":
      return <svg {...common}><rect x="2" y="2.5" width="12" height="11" rx="1.6" /><rect x="4.5" y="5" width="3" height="2.4" rx=".5" /><rect x="8.5" y="8.6" width="3" height="2.4" rx=".5" /><path d="M7.5 6.2 H8.2 a.8.8 0 0 1 .8.8 V8.6" /></svg>;
  }
}

export type MenuItem = { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; divider?: boolean; indent?: number };

export function RowMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useMenuClamp<HTMLDivElement>(at.x, at.y);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, ref]);
  return createPortal(
    <div ref={ref} className="sol-popup-menu__list sol-popup-menu__list--at solenoid-files__menu" role="menu" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it, i) => (
        <Fragment key={`${i}:${it.label}`}>
          {it.divider && i > 0 && <div className="sol-popup-menu__sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={`sol-popup-menu__item${it.danger ? " solenoid-files__menu-danger" : ""}`}
            style={it.indent ? { paddingLeft: 10 + it.indent * 14 } : undefined}
            disabled={it.disabled}
            onClick={() => { onClose(); it.onClick(); }}
          >{it.label}</button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="13" cy="8" r="1.3" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "none" }} aria-hidden="true">
      <path d="M6 4 L10 8 L6 12" />
    </svg>
  );
}

type Renaming = { kind: "doc"; id: string } | { kind: "folder"; path: string } | null;
type Drag = { kind: "doc"; id: string } | { kind: "folder"; path: string };
const DRAG_MIME = "application/x-solenoid-tree";

/** Reached by the + menu, which lives in the section header outside the tree. */
const treeActions: { newFolder?: () => void; newDocument?: () => void } = {};

/** The Files tree. `outline`, when given, renders under the open document's row (the one-tree layout). */
export function WorkspaceTree({ outline }: { outline?: ReactNode }) {
  useSyncExternalStore(documentStore.subscribe, documentStore.version);
  const preview = isNavPreview();
  const [expanded, setExpandedState] = useState<Set<string>>(loadExpanded);
  const setExpanded = (fn: (prev: Set<string>) => Set<string>) =>
    setExpandedState((prev) => { const next = fn(prev); saveExpanded(next); return next; });
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);

  const docs = documentStore.list();
  const folders = documentStore.folders();
  const current = docs.find((d) => d.current);

  // Whenever the open document changes, its folders open so its row is never hidden.
  useEffect(() => {
    if (!current?.folder) return;
    const keys = revealKeys(current.folder);
    setExpanded((prev) => (keys.every((k) => prev.has(k)) ? prev : new Set([...prev, ...keys])));
    target.folder = current.folder;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.folder]);

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const rows: TreeRow[] = [
    ...(preview ? previewRows(PREVIEW_WORKSPACE, expanded) : []),
    ...libraryRows(docs, folders, expanded, !!outline),
  ];

  // A ref as well as state: Escape and then the input's blur both fire, and only the first may act.
  const renamingRef = useRef<Renaming>(null);
  const startRename = (r: Renaming, label: string) => { renamingRef.current = r; setRenaming(r); setDraft(label); };
  const commitRename = () => {
    const r = renamingRef.current;
    renamingRef.current = null;
    setRenaming(null);
    if (!r) return;
    const v = draft.trim();
    if (r.kind === "doc") {
      if (v) documentStore.rename(r.id, v);
      moveFocus(docKey(r.id));
      return;
    }
    const to = v ? documentStore.renameFolder(r.path, v) : r.path;
    if (to !== r.path) setExpanded((prev) => rekeyExpanded(prev, r.path, to));
    moveFocus(folderKey(to));
  };
  const cancelRename = () => {
    const r = renamingRef.current;
    renamingRef.current = null;
    setRenaming(null);
    if (r) moveFocus(r.kind === "doc" ? docKey(r.id) : folderKey(r.path));
  };

  const newFolderIn = (parent: string) => {
    const path = documentStore.newFolder(parent);
    target.folder = path;
    setExpanded((prev) => new Set([...prev, ...revealKeys(parent)]));
    startRename({ kind: "folder", path }, path.slice(path.lastIndexOf("/") + 1));
  };
  const newDocumentIn = async (folder: string) => {
    await documentStore.newBlank(folder || undefined);
    const id = documentStore.currentId();
    if (id) startRename({ kind: "doc", id }, documentStore.currentName());
  };
  treeActions.newFolder = () => newFolderIn(target.folder);
  treeActions.newDocument = () => void newDocumentIn(target.folder);

  const moveMenu = (id: string, at: { x: number; y: number }) => {
    const here = docs.find((d) => d.id === id)?.folder ?? "";
    setMenu({
      at,
      items: [
        { label: "Top level", onClick: () => documentStore.moveToFolder(id, ""), disabled: here === "" },
        ...folders.map((f) => ({
          label: f.slice(f.lastIndexOf("/") + 1),
          indent: f.split("/").length,
          disabled: f === here,
          onClick: () => { documentStore.moveToFolder(id, f); setExpanded((prev) => new Set([...prev, ...revealKeys(f)])); },
        })),
      ],
    });
  };

  const docMenu = (id: string, name: string, open: boolean, at: { x: number; y: number }): MenuItem[] => [
    { label: "Open", onClick: () => void documentStore.open(id), disabled: open },
    { label: "Rename", onClick: () => startRename({ kind: "doc", id }, name) },
    { label: "Duplicate", onClick: () => void documentStore.duplicate(id) },
    { label: "Move to…", onClick: () => setTimeout(() => moveMenu(id, at), 0), disabled: folders.length === 0 },
    { label: "Delete", danger: true, divider: true, onClick: () => void deleteDoc(id, name) },
  ];

  const deleteDoc = async (id: string, name: string) => {
    const ok = await requestConfirm({ message: `Delete "${name}"? Unsaved changes will be lost.`, confirmLabel: "Delete" });
    if (ok) void documentStore.remove(id);
  };
  const deleteFolder = async (path: string, name: string) => {
    const n = documentStore.documentsIn(path);
    if (n > 0) {
      const what = n === 1 ? "its document" : `its ${n} documents`;
      const ok = await requestConfirm({ message: `Delete "${name}" and ${what}? Unsaved changes will be lost.`, confirmLabel: "Delete" });
      if (!ok) return;
    }
    if (target.folder === path || target.folder.startsWith(`${path}/`)) target.folder = "";
    void documentStore.removeFolder(path);
  };

  const folderMenu = (path: string, name: string): MenuItem[] => [
    { label: "New Document", onClick: () => void newDocumentIn(path) },
    { label: "New Folder", onClick: () => newFolderIn(path) },
    { label: "Rename", onClick: () => startRename({ kind: "folder", path }, name), divider: true },
    { label: "Delete", danger: true, divider: true, onClick: () => void deleteFolder(path, name) },
  ];

  const menuFor = (r: TreeRow, at: { x: number; y: number }): MenuItem[] | null => {
    if (r.sample) return null;
    if (r.kind === "doc" && r.docId) return docMenu(r.docId, r.label, r.open, at);
    if (r.kind === "folder" && r.folderPath) return folderMenu(r.folderPath, r.label);
    return null;
  };

  const onRowClick = (r: TreeRow) => {
    if (r.kind === "doc" && r.docId) {
      if (!r.open) void documentStore.open(r.docId);
      else if (r.expandable) toggle(docFoldedKey(r.docId));
      return;
    }
    if (r.kind === "folder" && r.folderPath !== undefined) target.folder = r.folderPath;
    if (r.expandable) toggle(r.key);
  };

  // The ARIA tree keys: one row in the tab order, arrows move it; workspace-tree.md § The pane.
  const focusable = rows.some((r) => r.key === focusKey) ? focusKey : rows.find((r) => r.open)?.key ?? rows[0]?.key;
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const typed = useRef({ text: "", at: 0 });
  const moveFocus = (key: string | undefined) => {
    if (!key) return;
    setFocusKey(key);
    requestAnimationFrame(() => rowEls.current.get(key)?.focus());
  };
  const toggleRow = (r: TreeRow) => toggle(r.kind === "doc" && r.docId ? docFoldedKey(r.docId) : r.key);
  const onTreeKey = (e: KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest(".solenoid-files__row") as HTMLElement | null;
    if (!el || e.target !== el || renaming) return;
    const key = el.dataset.key!;
    const r = rows.find((x) => x.key === key);
    if (!r) return;
    const steps: Record<string, TreeKey> = { ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end", ArrowLeft: "left", ArrowRight: "right" };
    // Every key the tree takes stops here, or the canvas's own Delete and arrow keys act on the selected cards too.
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    if (steps[e.key]) {
      take();
      const out = treeKeyStep(rows, key, steps[e.key]);
      if (out.toggle) toggleRow(out.toggle);
      moveFocus(out.focus);
      return;
    }
    if (e.key === "Enter" || e.key === " ") { take(); onRowClick(r); return; }
    if (r.sample) return;
    if (e.key === "F2") { take(); startRename(r.kind === "doc" ? { kind: "doc", id: r.docId! } : { kind: "folder", path: r.folderPath! }, r.label); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      take();
      if (r.docId) void deleteDoc(r.docId, r.label);
      else if (r.folderPath) void deleteFolder(r.folderPath, r.label);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
      take();
      const now = performance.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key, at: now };
      const hit = typeAhead(rows, typed.current.text.length > 1 ? rows[rows.findIndex((x) => x.key === key) - 1]?.key ?? key : key, typed.current.text);
      moveFocus(hit);
    }
  };

  // Desktop drag and drop: a document or folder onto a folder row, or onto the tree's empty space for the top level.
  const dropTargetOf = (r: TreeRow | null): string | null => (r === null ? "" : r.kind === "folder" && !r.sample ? r.folderPath ?? null : null);
  const canDrop = (to: string | null) => {
    const d = drag.current;
    if (!d || to === null) return false;
    if (d.kind === "folder") return to !== d.path && !to.startsWith(`${d.path}/`);
    return true;
  };
  const onDragOver = (e: DragEvent, r: TreeRow | null) => {
    const to = dropTargetOf(r);
    if (!canDrop(to)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropKey(r ? r.key : "root");
  };
  const onDrop = (e: DragEvent, r: TreeRow | null) => {
    const to = dropTargetOf(r);
    const d = drag.current;
    const ok = canDrop(to);
    setDropKey(null);
    drag.current = null;
    if (!d || !ok || to === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (d.kind === "doc") documentStore.moveToFolder(d.id, to);
    else {
      const moved = documentStore.moveFolder(d.path, to);
      if (moved !== d.path) setExpanded((prev) => rekeyExpanded(prev, d.path, moved));
    }
    if (to) setExpanded((prev) => new Set([...prev, ...revealKeys(to)]));
  };

  return (
    <div
      className={`solenoid-files${dropKey === "root" ? " solenoid-files--drop" : ""}`}
      role="tree"
      aria-label="Files"
      onDragOver={(e) => onDragOver(e, null)}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropKey(null); }}
      onDrop={(e) => onDrop(e, null)}
      onKeyDown={(e) => onTreeKey(e.nativeEvent)}
    >
      {rows.map((r) => {
        const isRenaming = renaming !== null && (
          (renaming.kind === "doc" && r.docId === renaming.id) ||
          (renaming.kind === "folder" && r.kind === "folder" && !r.sample && r.folderPath === renaming.path));
        const real = !r.sample && (r.docId !== undefined || r.folderPath !== undefined);
        return (
          <Fragment key={r.key}>
            <div
              role="treeitem"
              ref={(el) => { if (el) rowEls.current.set(r.key, el); else rowEls.current.delete(r.key); }}
              data-key={r.key}
              tabIndex={r.key === focusable ? 0 : -1}
              onFocus={(e) => { if (e.target === e.currentTarget) setFocusKey(r.key); }}
              aria-level={r.depth + 1}
              aria-expanded={r.expandable ? r.expanded : undefined}
              aria-selected={r.open}
              className={`solenoid-outline__row solenoid-files__row solenoid-files__row--${r.kind}${r.open ? " solenoid-outline__row--sel" : ""}${r.sample ? " solenoid-files__row--sample" : ""}${dropKey === r.key ? " solenoid-files__row--drop" : ""}`}
              style={{ "--depth": r.depth } as CSSProperties}
              draggable={real && !IS_COARSE && !isRenaming}
              onDragStart={(e) => {
                drag.current = r.kind === "doc" ? { kind: "doc", id: r.docId! } : { kind: "folder", path: r.folderPath! };
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(DRAG_MIME, r.key);
              }}
              onDragEnd={() => { drag.current = null; setDropKey(null); }}
              onDragOver={(e) => onDragOver(e, r)}
              onDrop={(e) => onDrop(e, r)}
              onClick={() => onRowClick(r)}
              onDoubleClick={(e) => {
                if (!real || !(e.target as HTMLElement).closest(".solenoid-outline__label")) return;
                startRename(r.kind === "doc" ? { kind: "doc", id: r.docId! } : { kind: "folder", path: r.folderPath! }, r.label);
              }}
              onContextMenu={(e) => {
                const at = { x: e.clientX, y: e.clientY };
                const items = menuFor(r, at);
                if (!items) return;
                e.preventDefault();
                setMenu({ at, items });
              }}
            >
              {r.expandable ? (
                <button
                  type="button"
                  className="solenoid-outline__chevron"
                  aria-label={r.expanded ? "Collapse" : "Expand"}
                  onClick={(e) => { e.stopPropagation(); toggle(r.kind === "doc" && r.docId ? docFoldedKey(r.docId) : r.key); }}
                >
                  <Chevron open={r.expanded} />
                </button>
              ) : (
                <span className="solenoid-files__slot" />
              )}
              <span className="solenoid-files__glyph"><Glyph kind={r.kind} open={r.kind === "folder" && r.expanded} /></span>
              {isRenaming ? (
                <input
                  className="solenoid-files__rename"
                  value={draft}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelRename(); }
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <span className="solenoid-outline__label">{r.label}</span>
              )}
              {real && !isRenaming && (
                <button
                  type="button"
                  className="solenoid-files__more"
                  title="More actions"
                  aria-label={`More actions for ${r.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const b = e.currentTarget.getBoundingClientRect();
                    const at = { x: b.left, y: b.bottom + 4 };
                    const items = menuFor(r, at);
                    if (items) setMenu({ at, items });
                  }}
                >
                  <MoreGlyph />
                </button>
              )}
            </div>
            {outline && r.open && r.expanded && (
              <div className="solenoid-files__outline" style={{ "--depth-base": r.depth + 1 } as CSSProperties}>{outline}</div>
            )}
          </Fragment>
        );
      })}
      {menu && <RowMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** The Files section's + menu; new rows land in the folder last picked in the tree. `openSub` replaces the menu with a submenu. */
export function filesAddMenu(openSub: (items: MenuItem[]) => void): MenuItem[] {
  const seedsOf = (ids: string[]): MenuItem[] =>
    ids.map((id) => ({ label: SEEDS[id].label, onClick: () => void documentStore.newFromTemplate(id, target.folder || undefined) }));
  const groups: MenuItem[] = SEED_GROUPS.map((g) => ({ label: g.head, onClick: () => setTimeout(() => openSub(seedsOf(g.ids)), 0) }));
  return [
    { label: "New Document", onClick: () => treeActions.newDocument?.() },
    { label: "New Folder", onClick: () => treeActions.newFolder?.() },
    { label: "New Page", onClick: () => {}, disabled: true },
    { label: "New from Example…", divider: true, onClick: () => setTimeout(() => openSub(groups), 0) },
  ];
}

