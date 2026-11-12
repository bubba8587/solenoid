// [[categorize#The sorter]], [[B19]] spreadsheetHabits
// The Categorize card's sorter: the unsorted items as chips on top, a column per category below. Dragging a chip (or
// several, picked with Ctrl or Shift) into a column sorts it there; dragging it back to the items unsorts it.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { categorizeEditor } from "../categorizeEditorStore";
import { notifyGraphChanged, processGraph } from "../process";
import { appThemeStore } from "../appTheme";
import { categoriesText, categoryOf, dropCategory, moveItems, nextCategoryName, renameCategory, type Assigned } from "../categorizeConfig";
import { PopupShell, popupCardVars } from "./PopupShell";
import { FieldChip, FieldsPanel, startChipDrag } from "./FieldChips";
import { useConnectedInputs, useDraftCommit } from "./inlineInput";
import { useDataColors } from "./chartCore";
import { CloseIcon } from "./CloseIcon";
import "./CategorizePopup.css";

/** A category's name, typed in place: it commits on Enter or blur, and a name another category has is refused. */
function CategoryName({ name, taken, onRename }: { name: string; taken: readonly string[]; onRename: (to: string) => void }) {
  const { draft, setDraft, onBlur, onKeyDown } = useDraftCommit(
    name,
    (s) => s,
    (text) => {
      const t = text.trim();
      return t && !taken.includes(t) ? t : name;
    },
    onRename,
  );
  return (
    <input className="categorize-zone__name" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={onBlur} onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()} aria-label="Category name" />
  );
}

const MAX_PER_ROW = 5;
export const perRow = (n: number): number => Math.max(1, Math.ceil(n / Math.ceil(Math.max(n, 1) / MAX_PER_ROW)));

export function CategorizePopup() {
  const state = useSyncExternalStore(categorizeEditor.subscribe, categorizeEditor.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [, setLanded] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);
  const drag = useRef<string[] | null>(null);
  const lastPick = useRef<string | null>(null);
  const connected = useConnectedInputs(state?.node.id ?? "");
  // Each category wears a palette color, as a chart's series do, so the columns read apart at a glance.
  const colors = useDataColors();
  useEffect(() => { setPicked(new Set()); }, [state]);

  if (!state) return null;
  const node = state.node;
  const close = () => categorizeEditor.close();
  const wired = connected.has("categories");
  const items = node.sortItems;
  const names = node.sortCategories;
  const label = new Map(items.map(([k, t]) => [k, t]));
  const has = (k: string) => label.has(k);
  const unsorted = items.filter(([k]) => { const c = categoryOf(node.assigned, k); return c === null || !names.includes(c); });
  // An item held by a category the list no longer names reads as unsorted, marked, until it's sorted again.
  const strandedIn = (k: string) => { const c = categoryOf(node.assigned, k); return c !== null && !names.includes(c) ? c : null; };

  function land() {
    node.edited();
    notifyGraphChanged();
    void processGraph(node.id).then(() => setLanded((n) => n + 1));
  }
  function commit(next: Assigned) {
    node.assigned = next;
    land();
  }
  function setNames(next: string[], assigned: Assigned = node.assigned) {
    node.stringLiterals.categories = categoriesText(next);
    node.assigned = assigned;
    land();
  }

  /** Click picks one chip; Ctrl or Cmd adds or drops it; Shift picks the run from the last pick in the same list. */
  function pick(e: React.MouseEvent, key: string, run: readonly string[]) {
    const next = new Set(e.ctrlKey || e.metaKey || e.shiftKey ? picked : []);
    if (e.shiftKey && lastPick.current && run.includes(lastPick.current)) {
      const [a, b] = [run.indexOf(lastPick.current), run.indexOf(key)].sort((x, y) => x - y);
      for (const k of run.slice(a, b + 1)) next.add(k);
    } else if ((e.ctrlKey || e.metaKey) && next.has(key)) next.delete(key);
    else next.add(key);
    lastPick.current = key;
    setPicked(next);
  }
  /** A drag carries every picked chip when it starts on one of them, else only itself. */
  function beginDrag(e: React.DragEvent, key: string) {
    const keys = picked.has(key) ? [...picked].filter(has) : [key];
    drag.current = keys;
    startChipDrag(e, keys.map((k) => label.get(k) ?? k).join(", "));
  }
  function dropInto(category: string | null, before?: string) {
    const keys = drag.current;
    drag.current = null;
    setOver(null);
    if (!keys?.length) return;
    commit(moveItems(node.assigned, keys, category, before));
    setPicked(new Set());
  }
  /** A click on a column's empty space sorts the picked chips there: quicker than dragging for a long list. */
  function sendPicked(category: string) {
    if (!picked.size) return;
    commit(moveItems(node.assigned, [...picked].filter(has), category));
    setPicked(new Set());
  }

  const chip = (key: string, run: readonly string[], category: string | null) => {
    const stranded = category === null ? strandedIn(key) : null;
    return (
      <FieldChip
        key={key}
        name={label.get(key) ?? key}
        className={`categorize-chip${picked.has(key) ? " categorize-chip--picked" : ""}${stranded ? " pivot-chip--missing" : ""}`}
        title={stranded ? "Its category is no longer listed" : undefined}
        onClick={(e) => pick(e, key, run)}
        onDragStart={(e) => beginDrag(e, key)}
        onDropBefore={category === null ? undefined : () => dropInto(category, key)}
        onRemove={category === null ? undefined : () => commit(moveItems(node.assigned, [key], null))}
        removeTitle="Unsort"
      />
    );
  };

  // A category is drawn as a card is (DESIGN.md, the Tinted-Box Rule): its color in the header band and its cap, the
  // body neutral. With chips picked, a click on the body sorts them there.
  const zone = (name: string, i: number) => {
    const keys = (node.assigned.find(([n]) => n === name)?.[1] ?? []).filter(has);
    return (
      <div
        key={name}
        className={`categorize-zone${over === name ? " categorize-zone--over" : ""}${picked.size ? " categorize-zone--target" : ""}`}
        style={{ "--cat": colors[i % colors.length] } as React.CSSProperties}
        onDragOver={(e) => { e.preventDefault(); if (over !== name) setOver(name); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((p) => (p === name ? null : p)); }}
        onDrop={(e) => { e.preventDefault(); dropInto(name); }}
      >
        <div className="categorize-zone__head">
          {wired
            ? <span className="categorize-zone__fixed">{name}</span>
            : <CategoryName name={name} taken={names.filter((n) => n !== name)}
                onRename={(to) => setNames(names.map((n) => (n === name ? to : n)), renameCategory(node.assigned, name, to))} />}
          <span className="categorize-zone__count">{keys.length}</span>
          {!wired && names.length > 1 && (
            <button className="pivot-chip__x" title="Remove category" aria-label="Remove category"
              onClick={() => setNames(names.filter((n) => n !== name), dropCategory(node.assigned, name))}><CloseIcon size={10} /></button>
          )}
        </div>
        <div className="categorize-zone__body" onClick={(e) => { if (e.target === e.currentTarget) sendPicked(name); }}>
          {keys.map((k) => chip(k, keys, name))}
        </div>
      </div>
    );
  };

  const unsortedKeys = unsorted.map(([k]) => k);
  return (
    <PopupShell title={state.title} onClose={close} cardClassName="pivot-editor categorize-editor" resizable={{ min: { w: 420, h: 260 } }} cardStyle={popupCardVars(state)}>
      <div className="pivot-editor__body categorize-editor__body">
        <FieldsPanel
          head="Items"
          hint={items.length === 0 ? "connect a list" : picked.size ? `${picked.size} picked` : undefined}
          onDrop={() => dropInto(null)}
        >
          {unsortedKeys.map((k) => chip(k, unsortedKeys, null))}
        </FieldsPanel>
        {/* The columns per row follow the category count alone, never the popup's width, so a resize stretches the
            columns and never moves a category to another row: at most five, the rows balanced (7 is 4 and 3). Below 130
            pixels a column, the grid scrolls sideways rather than squeezing. */}
        <div className="categorize-grid" style={{ "--per-row": perRow(names.length) } as React.CSSProperties}>
          {names.map(zone)}
        </div>
        {wired && names.length === 0 && <div className="pivot-zone__hint">The Categories cable carries no names.</div>}
      </div>
      <div className="pivot-editor__footer">
        {!wired && (
          <button className="categorize-add" onClick={() => setNames([...names, nextCategoryName(names)])}>Add Category</button>
        )}
        <button className="pivot-editor__done" onClick={close}>Done</button>
      </div>
    </PopupShell>
  );
}
