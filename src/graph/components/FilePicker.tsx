// [[B14]] oneDesignSystem, [[B2]] webTryDesktopFull: the app's own file and folder picker, where the operating system's
// dialog can't reach (the web, the demo vault). `chooseFile` opens it; mounted once in App.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { filePicker } from "../filePickerStore";
import { PopupShell } from "./PopupShell";
import { PopupSkeleton } from "./PopupSkeleton";
import { SearchField } from "./SearchField";
import "./FilePicker.css";

/** Every term of `query` in `path`, a name match ranked before a folder match. */
function matches(paths: string[], query: string): string[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return paths;
  const hit = paths.filter((p) => terms.every((t) => p.toLowerCase().includes(t)));
  const named = (p: string) => terms.every((t) => (p.slice(p.lastIndexOf("/") + 1)).toLowerCase().includes(t));
  return [...hit.filter(named), ...hit.filter((p) => !named(p))];
}

export function FilePicker() {
  const state = useSyncExternalStore(filePicker.subscribe, filePicker.get);
  const [paths, setPaths] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPaths(null);
    setQuery("");
    if (!state || state.blocked) return;
    let live = true;
    state.load().then((p) => { if (live) setPaths(p); }, () => { if (live) setPaths([]); });
    return () => { live = false; };
  }, [state]);

  const shown = useMemo(() => {
    const listed = matches(paths ?? [], query);
    return state?.kind === "folder" && state.rootLabel !== undefined && !query.trim() ? ["", ...listed] : listed;
  }, [paths, query, state]);

  useEffect(() => {
    const i = state?.current !== undefined ? shown.indexOf(state.current) : -1;
    setAt(query.trim() || i < 0 ? 0 : i);
  }, [shown, query, state]);

  useEffect(() => { if (paths) bodyRef.current?.querySelector("input")?.focus(); }, [paths]);
  useEffect(() => { listRef.current?.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);

  if (!state) return null;
  const pick = (rel: string) => state.answer(rel);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && shown[at] !== undefined) { e.preventDefault(); pick(shown[at]); }
  };

  return (
    <PopupShell title={state.title} onClose={() => state.answer(null)} cardClassName="file-picker" fitNarrow>
      <div ref={bodyRef} className="file-picker__body" onKeyDown={onKey}>
        {state.blocked ? (
          <div className="file-picker__empty">{state.blocked}</div>
        ) : paths === null ? (
          <PopupSkeleton />
        ) : (
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={state.kind === "folder" ? "Search folders" : "Search files"}
              label={state.kind === "folder" ? "Search folders" : "Search files"}
              count={query.trim() ? `${shown.length} of ${paths.length}` : undefined}
            />
            <div ref={listRef} className="file-picker__list nowheel" role="listbox" aria-label={state.title}>
              {shown.length === 0 ? (
                <div className="file-picker__empty">{query.trim() ? "Nothing matches" : state.empty}</div>
              ) : shown.map((p, i) => {
                const slash = p.lastIndexOf("/");
                const name = p === "" ? state.rootLabel : p.slice(slash + 1);
                const folder = slash > 0 ? p.slice(0, slash) : "";
                return (
                  <button
                    key={p || "\u0000root"}
                    type="button"
                    role="option"
                    aria-selected={i === at}
                    data-at={i}
                    className={`file-picker__row${i === at ? " file-picker__row--at" : ""}${p === state.current ? " file-picker__row--current" : ""}`}
                    title={p || state.rootLabel}
                    onPointerMove={() => setAt(i)}
                    onClick={() => pick(p)}
                  >
                    <span className="file-picker__name">{name}</span>
                    {folder && <span className="file-picker__folder">{folder}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </PopupShell>
  );
}
