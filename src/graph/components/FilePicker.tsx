// [[B14]] oneDesignSystem, [[B2]] webTryDesktopFull: the app's own file and folder picker, where the operating system's
// dialog can't reach (the web, the demo vault). `chooseFile` opens it; mounted once in App. The model (tree, search,
// previews, recent picks) is `filePickerModel.ts`.
import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { filePicker, type FilePickerState } from "../filePickerStore";
import { crumbsOf, entriesAt, indexOf, listed, noteHead, recentPicks, relist, rememberPick, ROW_CAP, search, treeOf, whenText, wholeLines, type Entry, type Match } from "../filePickerModel";
import { csvToFrame } from "../frameBackend";
import type { FrameValue } from "../frame";
import { FrameDisplay } from "./FrameDisplay";
import { parseNoteFrontmatter } from "../noteFrontmatter";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/dateSerial";
import { PopupShell } from "./PopupShell";
import { PopupSkeleton } from "./PopupSkeleton";
import { SearchField } from "./SearchField";
import "./FilePicker.css";

/** One row the list shows: an entry of the folder being browsed, a search match, or a recent pick. */
type Row = { key: string; kind: "folder" | "file" | "here"; path: string; name: string; detail: string; marks?: [number, number][]; count?: number };

const FOLDER = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>;
const FILE = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>;
const CLOCK = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>;

const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const parentOf = (p: string) => (p.lastIndexOf("/") > 0 ? p.slice(0, p.lastIndexOf("/")) : "");

function marked(text: string, marks?: [number, number][]): ReactNode {
  if (!marks?.length) return text;
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={i} className="file-picker__mark">{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function FilePicker() {
  const state = useSyncExternalStore(filePicker.subscribe, filePicker.get);
  if (!state) return null;
  return <PickerBody key={state.title + state.kind + (state.current ?? "")} state={state} />;
}

function PickerBody({ state }: { state: FilePickerState }) {
  const folderMode = state.kind === "folder";
  const rootLabel = state.rootLabel ?? "Vault";
  // A picker reopened shows its last listing at once and refreshes it behind: a big vault walks once a session.
  const [paths, setPaths] = useState<string[] | null>(() => listed(state.listKey) ?? null);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [folder, setFolder] = useState(() => (state.current ? (folderMode ? parentOf(state.current) : parentOf(state.current)) : ""));
  const [at, setAt] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recent = useMemo(() => (state.recentKey ? recentPicks(state.recentKey) : []), [state.recentKey]);

  useEffect(() => {
    if (state.blocked) return;
    let live = true;
    relist(state.listKey, state.load).then((p) => { if (live) setPaths(p); }, () => { if (live) setPaths((had) => had ?? []); });
    return () => { live = false; };
  }, [state]);

  const tree = useMemo(() => (paths ? treeOf(paths, state.kind) : null), [paths, state.kind]);
  const known = useMemo(() => new Set(paths ?? []), [paths]);
  const index = useMemo(() => (paths ? indexOf(paths) : null), [paths]);
  const searching = query.trim() !== "";
  const found = useMemo(() => (index && deferred.trim() ? search(index, deferred) : { matches: [], total: 0 }), [index, deferred]);

  const rows = useMemo((): Row[] => {
    if (!tree || !paths) return [];
    if (searching) {
      return found.matches.map((m: Match) => ({ key: m.path, kind: folderMode ? "folder" : "file", path: m.path, name: m.name, detail: m.folder, marks: m.marks }));
    }
    const here: Row[] = folderMode ? [{ key: "\u0000here", kind: "here", path: folder, name: folder ? nameOf(folder) : rootLabel, detail: "this folder" }] : [];
    const inFolder = entriesAt(tree, folder).slice(0, ROW_CAP).map((e: Entry): Row => e.kind === "folder"
      ? { key: e.path, kind: "folder", path: e.path, name: e.name, detail: "", count: e.count }
      : { key: e.path, kind: "file", path: e.path, name: e.name, detail: "" });
    return [...here, ...inFolder];
  }, [tree, paths, searching, found, folder, folderMode, rootLabel]);
  // How many the list leaves undrawn: past the cap, a search narrows.
  const undrawn = !tree ? 0 : searching ? found.total - found.matches.length : Math.max(0, entriesAt(tree, folder).length - ROW_CAP);

  const recentRows = useMemo((): Row[] => (searching || folder !== "" ? [] : recent.filter((p) => known.has(p)).map((p) => ({ key: `\u0000r${p}`, kind: folderMode ? "folder" : "file", path: p, name: nameOf(p), detail: parentOf(p) }))), [recent, known, searching, folder, folderMode]);
  const all = useMemo(() => [...recentRows, ...rows], [recentRows, rows]);

  // Open on the current pick when there is one, else on the first row.
  const opened = useRef(false);
  useEffect(() => {
    if (!tree) return;
    const cur = !opened.current && state.current !== undefined ? all.findIndex((r) => r.path === state.current && !r.key.startsWith("\u0000r")) : -1;
    opened.current = true;
    setAt(cur >= 0 ? cur : 0);
  }, [all, tree, state.current]);

  useEffect(() => { if (paths) bodyRef.current?.querySelector<HTMLInputElement>(".file-picker__search input")?.focus(); }, [paths]);
  useEffect(() => { listRef.current?.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);

  const sel = all[at];
  const choose = (path: string) => {
    if (state.recentKey) rememberPick(state.recentKey, path);
    state.answer(path);
  };
  const enter = (row: Row) => { setFolder(row.path); setQuery(""); setAt(0); };
  const act = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "here") choose(row.path);
    else if (row.kind === "folder" && !(folderMode && (searching || row.key.startsWith("\u0000r")))) enter(row);
    else choose(row.path);
  };
  const up = () => { if (!searching && folder) { const was = folder; setFolder(parentOf(folder)); setAt(Math.max(0, entriesAt(tree!, parentOf(was)).findIndex((e) => e.path === was) + (folderMode ? 1 : 0))); } };

  const onKey = (e: React.KeyboardEvent) => {
    const page = 8;
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, all.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "PageDown") { e.preventDefault(); setAt((i) => Math.min(i + page, all.length - 1)); }
    else if (e.key === "PageUp") { e.preventDefault(); setAt((i) => Math.max(i - page, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); act(sel); }
    else if (e.key === "ArrowRight" && sel?.kind === "folder" && !searching) { e.preventDefault(); enter(sel); }
    else if ((e.key === "ArrowLeft" || (e.key === "Backspace" && query === "")) && !searching && folder) { e.preventDefault(); up(); }
  };

  const count = paths ? (folderMode ? paths.length : paths.length) : 0;
  const footerPick = sel && sel.kind !== "folder" ? sel.path : folderMode && sel ? sel.path : null;

  return (
    <PopupShell title={state.title} onClose={() => state.answer(null)} cardClassName="file-picker" fitNarrow resizable={{ min: { w: 420, h: 320 } }}>
      <div ref={bodyRef} className="file-picker__body" onKeyDown={onKey}>
        {state.blocked ? (
          <div className="file-picker__empty">{state.blocked}</div>
        ) : paths === null || !tree ? (
          <PopupSkeleton />
        ) : (
          <>
            <div className="file-picker__top">
              <SearchField
                className="file-picker__search"
                value={query}
                onChange={(q) => { setQuery(q); setAt(0); }}
                placeholder={folderMode ? `Search ${count} folders` : `Search ${count} files`}
                label={folderMode ? "Search folders" : "Search files"}
                count={searching ? `${found.total} of ${count}` : undefined}
              />
              {!searching && (folder !== "" || (tree.folders.get("")?.size ?? 0) > 0) && (
                <nav className="file-picker__crumbs" aria-label="Folder">
                  {crumbsOf(folder, rootLabel).map(([p, label], i, list) => (
                    <span key={p || "\u0000root"} className="file-picker__crumb-wrap">
                      {i > 0 && <span className="file-picker__crumb-sep" aria-hidden="true">›</span>}
                      <button type="button" className={`file-picker__crumb${i === list.length - 1 ? " file-picker__crumb--here" : ""}`} onClick={() => { setFolder(p); setAt(0); }}>{label}</button>
                    </span>
                  ))}
                </nav>
              )}
            </div>
            <div className="file-picker__panes">
              <div ref={listRef} className="file-picker__list nowheel" role="listbox" aria-label={state.title}>
                {all.length === 0 ? (
                  <div className="file-picker__empty">{searching ? "Nothing matches" : state.empty}</div>
                ) : all.map((r, i) => (
                  <PickerRow
                    key={r.key}
                    row={r}
                    i={i}
                    on={i === at}
                    current={r.path === state.current && r.kind !== "here" && i >= recentRows.length}
                    head={i === 0 && recentRows.length > 0 ? "Recent" : i === recentRows.length && recentRows.length > 0 ? (folder ? nameOf(folder) : rootLabel) : undefined}
                    recent={i < recentRows.length}
                    onHover={() => setAt(i)}
                    onPick={() => { setAt(i); if (r.kind === "folder" && !folderMode) enter(r); }}
                    onChoose={() => act(r)}
                  />
                ))}
                {undrawn > 0 && <div className="file-picker__more">{undrawn} more. {searching ? "Keep typing to narrow" : "Search to find one"}</div>}
              </div>
              <Preview state={state} row={sel} tree={tree} />
            </div>
            <div className="file-picker__foot">
              <button type="button" className="file-picker__cancel" onClick={() => state.answer(null)}>Cancel</button>
              <button type="button" className="file-picker__choose" disabled={footerPick === null} onClick={() => { if (footerPick !== null) choose(footerPick); }}>
                {folderMode ? "Choose folder" : "Choose"}
              </button>
            </div>
          </>
        )}
      </div>
    </PopupShell>
  );
}

function PickerRow({ row, i, on, current, head, recent, onHover, onPick, onChoose }: {
  row: Row; i: number; on: boolean; current: boolean; head?: string; recent: boolean;
  onHover: () => void; onPick: () => void; onChoose: () => void;
}) {
  return (
    <>
      {head && <div className="file-picker__head">{head}</div>}
      <button
        type="button"
        role="option"
        aria-selected={on}
        data-at={i}
        className={`file-picker__row file-picker__row--${row.kind}${on ? " file-picker__row--at" : ""}${current ? " file-picker__row--current" : ""}`}
        title={row.path || row.name}
        onPointerMove={onHover}
        onClick={onPick}
        onDoubleClick={onChoose}
      >
        <span className="file-picker__icon">{recent ? CLOCK : row.kind === "file" ? FILE : FOLDER}</span>
        <span className="file-picker__name">{marked(row.name, row.marks)}</span>
        {row.detail && <span className="file-picker__folder">{row.detail}</span>}
        {row.count ? <span className="file-picker__count" title={`${row.count} inside`}>{row.count}</span> : null}
        {current && <span className="file-picker__now">current</span>}
      </button>
    </>
  );
}

type Shown =
  | { kind: "note"; fields: [string, string][]; lines: string[] }
  | { kind: "table"; frame: FrameValue; partial: boolean }
  | { kind: "text"; lines: string[] }
  | { kind: "none" };

/** A property as the note's card shows it: a date field's serials as dates ([[C137]] datesNeverSerials). */
/** How much of a file a preview reads: a table's first screenful of rows, a note's properties and opening lines. */
const CSV_HEAD = 64 * 1024;
const NOTE_HEAD = 16 * 1024;

const fieldText = (v: unknown, dated: boolean): string =>
  Array.isArray(v) ? v.map((x) => fieldText(x, dated)).join(", ")
    : v === null || v === undefined ? ""
    : typeof v === "number" && dated ? formatDateSerial(v, DEFAULT_DATE_FORMAT)
    : typeof v === "object" ? "…" : String(v);

/** What the highlighted row holds: a note's properties and opening lines, a table's first rows, a folder's contents. */
function Preview({ state, row, tree }: { state: FilePickerState; row: Row | undefined; tree: ReturnType<typeof treeOf> }) {
  const [shown, setShown] = useState<Shown | null>(null);
  // A folder pick previews the files beneath a folder, which its own list of folders doesn't hold.
  const filesKey = `${state.listKey}|files`;
  const [files, setFiles] = useState<ReturnType<typeof treeOf> | null>(() => {
    const had = state.files ? listed(filesKey) : undefined;
    return had ? treeOf(had, "file") : null;
  });
  useEffect(() => {
    if (!state.files) return;
    let live = true;
    relist(filesKey, state.files).then((p) => { if (live) setFiles(treeOf(p, "file")); }, () => {});
    return () => { live = false; };
  }, [state, filesKey]);
  const folderAt = row && row.kind !== "file" ? row.path : null;
  const inFolder = useMemo(() => (folderAt === null ? [] : entriesAt(files ?? tree, folderAt)), [folderAt, files, tree]);
  const [when, setWhen] = useState<number | null>(null);
  const path = row && row.kind === "file" ? row.path : null;

  useEffect(() => {
    setShown(null);
    setWhen(null);
    if (path === null) return;
    let live = true;
    // A short settle, so holding an arrow key down reads only where it stops.
    const t = setTimeout(() => {
      state.stat?.(path).then((s) => { if (live) setWhen(s?.mtimeMs ?? null); }, () => {});
      const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      if (!state.readHead || (ext !== "md" && ext !== "csv" && ext !== "txt")) { setShown({ kind: "none" }); return; }
      // Only the head is read: a preview of a 2 GB CSV costs what one of 2 KB does.
      const chars = ext === "csv" ? CSV_HEAD : NOTE_HEAD;
      state.readHead(path, chars).then((head) => {
        if (!live) return;
        const cut = head.length >= chars;
        if (ext === "md") {
          const fm = parseNoteFrontmatter(head);
          setShown({ kind: "note", fields: fm.fields.slice(0, 8).map((f) => [f.key, fieldText(f.value, f.guessed.startsWith("date"))]), lines: noteHead(fm.body) });
        } else if (ext === "csv") setShown({ kind: "table", frame: csvToFrame(wholeLines(head, cut)), partial: cut });
        else setShown({ kind: "text", lines: noteHead(head) });
      }, () => { if (live) setShown({ kind: "none" }); });
    }, 90);
    return () => { live = false; clearTimeout(t); };
  }, [path, state]);

  if (!row) return <aside className="file-picker__preview file-picker__preview--blank" />;
  if (row.kind !== "file") {
    const at = row.path;
    const shownTree = files ?? tree;
    const subs = shownTree.folders.get(at)?.size ?? 0;
    const here = shownTree.files.get(at)?.length ?? 0;
    const inside = inFolder.slice(0, 10);
    return (
      <aside className="file-picker__preview">
        <div className="file-picker__pv-title">{FOLDER}<span>{row.kind === "here" ? (at ? nameOf(at) : state.rootLabel ?? "Vault") : row.name}</span></div>
        <div className="file-picker__pv-meta">
          {state.kind === "folder" && !files
            ? `${subs} folder${subs === 1 ? "" : "s"} inside`
            : `${here} file${here === 1 ? "" : "s"} here${subs ? ` · ${subs} folder${subs === 1 ? "" : "s"}` : ""} · ${shownTree.below.get(at) ?? 0} in all`}
        </div>
        <ul className="file-picker__pv-list">
          {inside.map((e) => <li key={e.path}>{e.kind === "folder" ? FOLDER : FILE}<span>{e.name}</span></li>)}
          {inFolder.length > inside.length && <li className="file-picker__pv-more">and {inFolder.length - inside.length} more</li>}
        </ul>
      </aside>
    );
  }
  return (
    <aside className="file-picker__preview">
      <div className="file-picker__pv-title">{FILE}<span>{row.name}</span></div>
      <div className="file-picker__pv-meta">
        {parentOf(row.path) || state.rootLabel || "Top folder"}{when !== null && <> · {whenText(when)}</>}
      </div>
      {shown === null ? (
        <div className="file-picker__pv-wait"><span className="sol-skeleton__block" /></div>
      ) : shown.kind === "note" ? (
        <>
          {shown.fields.length > 0 && (
            <dl className="file-picker__pv-fields">
              {shown.fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}
            </dl>
          )}
          <pre className="file-picker__pv-text">{shown.lines.join("\n") || "Empty note"}</pre>
        </>
      ) : shown.kind === "table" ? (
        <div className="file-picker__pv-table-wrap">
          <FrameDisplay frame={shown.frame} previewRows={10} previewCols={4} peek />
          {shown.partial && <div className="file-picker__pv-more">The first rows of a big file</div>}
        </div>
      ) : shown.kind === "text" ? (
        <pre className="file-picker__pv-text">{shown.lines.join("\n")}</pre>
      ) : (
        <div className="file-picker__pv-none">No preview</div>
      )}
    </aside>
  );
}
