// [[C132]] workspaceTree. The Navigator's Files tree; workspace-tree.md.
import { Fragment, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { documentStore } from "./documentStore";
import { requestConfirm } from "./confirmStore";
import { useMenuClamp } from "./components/menuClamp";
import { PREVIEW_WORKSPACE, isNavPreview, type PreviewNode, type PreviewPage } from "./workspacePreview";
import "./components/popupChrome.css";
import "./WorkspaceTree.css";

type Kind = "folder" | "doc" | "pagefolder" | "page";
type TreeRow = {
  key: string;
  kind: Kind;
  label: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  open: boolean;
  docId?: string;
};

const EXPANDED_KEY = "solenoid.navExpanded";
const nameCmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* private mode or a bad value */ }
  return new Set(["p:Finance", "p:Finance/2026", "p:Finance/2026/Budget 2026", "p:Finance/2026/Budget 2026/Inputs"]);
}

function previewRows(expanded: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const sorted = (ns: PreviewNode[]) => [...ns].sort((a, b) => (a.kind === b.kind ? nameCmp(a.name, b.name) : a.kind === "folder" ? -1 : 1));
  const pages = (ps: PreviewPage[], path: string, depth: number) => {
    for (const p of ps) {
      const key = `p:${path}/${p.name}`;
      const isFolder = p.kind === "pagefolder";
      const exp = isFolder && expanded.has(key);
      rows.push({ key, kind: p.kind, label: p.name, depth, expandable: isFolder, expanded: exp, open: false });
      if (exp) pages(p.children, `${path}/${p.name}`, depth + 1);
    }
  };
  const walk = (ns: PreviewNode[], path: string, depth: number) => {
    for (const n of sorted(ns)) {
      const full = path ? `${path}/${n.name}` : n.name;
      const key = `p:${full}`;
      const kids = n.kind === "folder" ? n.children.length > 0 : (n.pages?.length ?? 0) > 1;
      const exp = kids && expanded.has(key);
      rows.push({ key, kind: n.kind, label: n.name, depth, expandable: kids, expanded: exp, open: false });
      if (!exp) continue;
      if (n.kind === "folder") walk(n.children, full, depth + 1);
      else pages(n.pages ?? [], full, depth + 1);
    }
  };
  walk(PREVIEW_WORKSPACE, "", 0);
  return rows;
}

function Glyph({ kind, open }: { kind: Kind; open?: boolean }) {
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

type MenuItem = { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; divider?: boolean };

function RowMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
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
        <Fragment key={it.label}>
          {it.divider && i > 0 && <div className="sol-popup-menu__sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={`sol-popup-menu__item${it.danger ? " solenoid-files__menu-danger" : ""}`}
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

/** The Files tree. `outline`, when given, renders under the open document's row (the one-tree layout). */
export function WorkspaceTree({ outline }: { outline?: ReactNode }) {
  useSyncExternalStore(documentStore.subscribe, documentStore.version);
  const preview = isNavPreview();
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });

  const docs = [...documentStore.list()].sort((a, b) => nameCmp(a.name, b.name));
  const rows: TreeRow[] = [
    ...(preview ? previewRows(expanded) : []),
    ...docs.map((d): TreeRow => {
      const key = `d:${d.id}`;
      const expandable = !!outline && d.current;
      return { key, kind: "doc", label: d.name, depth: 0, expandable, expanded: expandable && !expanded.has(`${key}:folded`), open: d.current, docId: d.id };
    }),
  ];

  const commitRename = (id: string, original: string) => {
    const v = draft.trim();
    if (v && v !== original) documentStore.rename(id, v);
    setRenamingId(null);
  };

  const docMenu = (id: string, name: string, current: boolean): MenuItem[] => [
    { label: "Open", onClick: () => void documentStore.open(id), disabled: current },
    { label: "Rename", onClick: () => { setRenamingId(id); setDraft(name); } },
    { label: "Duplicate", onClick: () => void documentStore.duplicate(id) },
    { label: "Move to…", onClick: () => {}, disabled: true },
    {
      label: "Delete", danger: true, divider: true,
      onClick: async () => {
        const ok = await requestConfirm({ message: `Delete "${name}"? Unsaved changes will be lost.`, confirmLabel: "Delete" });
        if (ok) void documentStore.remove(id);
      },
    },
  ];

  const openMenuAt = (el: HTMLElement, items: MenuItem[]) => {
    const r = el.getBoundingClientRect();
    setMenu({ at: { x: r.left, y: r.bottom + 4 }, items });
  };

  const onRowClick = (r: TreeRow) => {
    if (r.kind === "doc" && r.docId) {
      if (!r.open) void documentStore.open(r.docId);
      else if (r.expandable) toggle(`${r.key}:folded`);
      return;
    }
    if (r.expandable) toggle(r.key);
  };

  return (
    <div className="solenoid-files" role="tree" aria-label="Files">
      {rows.map((r) => {
        const sample = r.key.startsWith("p:");
        const renaming = r.docId !== undefined && renamingId === r.docId;
        return (
          <Fragment key={r.key}>
            <div
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={r.expandable ? r.expanded : undefined}
              aria-selected={r.open}
              className={`solenoid-outline__row solenoid-files__row solenoid-files__row--${r.kind}${r.open ? " solenoid-outline__row--sel" : ""}${sample ? " solenoid-files__row--sample" : ""}`}
              style={{ "--depth": r.depth } as CSSProperties}
              onClick={() => onRowClick(r)}
              onDoubleClick={(e) => {
                if (r.docId && (e.target as HTMLElement).closest(".solenoid-outline__label")) { setRenamingId(r.docId); setDraft(r.label); }
              }}
              onContextMenu={(e) => {
                if (!r.docId) return;
                e.preventDefault();
                setMenu({ at: { x: e.clientX, y: e.clientY }, items: docMenu(r.docId, r.label, r.open) });
              }}
            >
              {r.expandable ? (
                <button
                  type="button"
                  className="solenoid-outline__chevron"
                  aria-label={r.expanded ? "Collapse" : "Expand"}
                  onClick={(e) => { e.stopPropagation(); toggle(r.kind === "doc" && r.docId ? `${r.key}:folded` : r.key); }}
                >
                  <Chevron open={r.expanded} />
                </button>
              ) : (
                <span className="solenoid-files__slot" />
              )}
              <span className="solenoid-files__glyph"><Glyph kind={r.kind} open={r.kind === "folder" && r.expanded} /></span>
              {renaming ? (
                <input
                  className="solenoid-files__rename"
                  value={draft}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(r.docId!, r.label); }
                    if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                  }}
                  onBlur={() => commitRename(r.docId!, r.label)}
                />
              ) : (
                <span className="solenoid-outline__label">{r.label}</span>
              )}
              {r.docId && !renaming && (
                <button
                  type="button"
                  className="solenoid-files__more"
                  title="More actions"
                  aria-label={`More actions for ${r.label}`}
                  onClick={(e) => { e.stopPropagation(); openMenuAt(e.currentTarget, docMenu(r.docId!, r.label, r.open)); }}
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

/** The Files section's + menu: New Document is real; folders and pages wait on their models. */
export function filesAddMenu(): MenuItem[] {
  return [
    { label: "New Document", onClick: () => void documentStore.newBlank() },
    { label: "New Folder", onClick: () => {}, disabled: true },
    { label: "New Page", onClick: () => {}, disabled: true },
  ];
}

export { RowMenu, type MenuItem };
