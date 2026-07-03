import { useSyncExternalStore, useState, useRef, useEffect, useMemo } from "react";
import { IS_MOBILE } from "../coarse";
import { problemsStore, problemsPanelUi, type ProblemEntry } from "../problemsStore";
import { registerChrome } from "../chromeToggle";
import { flyToNodeAndFlash } from "../flyToNode";
import { getEditor } from "../process";
import { nodeTypeName } from "../nodeNames";
import { errorTip } from "./ErrorChip";
import { solError } from "../errorValue";
import "./problemsPanel.css";
import { CloseIcon } from "./CloseIcon";

// Lucide "list-checks" — the Problems trigger icon. https://lucide.dev/icons/list-checks
const ProblemsSvg = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
    <path d="m3 17 2 2 4-4" />
    <path d="m3 7 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </svg>
);

/**
 * The Problems HUD panel: a log of every tagged #CODE! error the graph has hit
 * (live compute-pass hits), plus model-fuzzing findings once run (origin "fuzz",
 * see #44). Each entry jumps-and-flashes to its node. Filterable by code.
 * Collapses to a count button, same shape as PinLayer/AlertLayer (its own state,
 * own registerChrome call) — HudStack is a hardcoded stack, not a generic API.
 */
export function ProblemsPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [codeFilter, setCodeFilter] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!IS_MOBILE || collapsed) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setCollapsed(true);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [collapsed]);

  useSyncExternalStore(problemsStore.subscribe, problemsStore.version);
  // The StatusBar badge can force the panel open (problemsPanelUi) — mirror that
  // external "open" request into the local collapsed state.
  const forcedOpen = useSyncExternalStore(problemsPanelUi.subscribe, problemsPanelUi.isOpen);
  useEffect(() => {
    if (forcedOpen) { setCollapsed(false); problemsPanelUi.setOpen(false); }
  }, [forcedOpen]);

  const all = problemsStore.list();
  const codes = useMemo(() => [...new Set(all.map((e) => e.code))].sort(), [all]);
  const entries = codeFilter ? all.filter((e) => e.code === codeFilter) : all;

  useEffect(() => {
    if (all.length === 0) return;
    return registerChrome("problems", { isOpen: () => !collapsed, setOpen: (o) => setCollapsed(!o) });
  }, [collapsed, all.length]);
  if (all.length === 0) return null;

  const editor = getEditor();

  const trigger = (
    <button
      type="button"
      className="solenoid-problems-layer__trigger"
      title={collapsed ? `Show ${all.length} problem${all.length !== 1 ? "s" : ""}` : "Collapse problems"}
      onClick={() => setCollapsed((c) => !c)}
    >
      <ProblemsSvg />
      {collapsed && <span className="solenoid-problems-layer__count">{all.length}</span>}
    </button>
  );

  const row = (e: ProblemEntry) => {
    const node = editor?.getNode(e.nodeId);
    const label = (node?.label ?? "").trim() || (node ? nodeTypeName(node) : "(deleted node)");
    return (
      <div
        key={e.id}
        className={`solenoid-problem${e.origin === "fuzz" ? " solenoid-problem--fuzz" : ""}`}
        onClick={() => flyToNodeAndFlash(e.nodeId)}
        title={errorTip(solError(e.code, e.message))}
      >
        <span className="solenoid-problem__code">{e.code}</span>
        <span className="solenoid-problem__label">{label}</span>
        <button
          type="button"
          className="solenoid-problem__remove"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={(ev) => { ev.stopPropagation(); problemsStore.dismiss(e.id); }}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    );
  };

  return (
    <div ref={rootRef} className={`solenoid-problems-layer${collapsed ? " solenoid-problems-layer--collapsed" : ""}`}>
      {trigger}
      {!collapsed && codes.length > 1 && (
        <div className="solenoid-problems-layer__filters">
          <button
            type="button"
            className={`solenoid-problems-layer__filter${codeFilter === null ? " solenoid-problems-layer__filter--active" : ""}`}
            onClick={() => setCodeFilter(null)}
          >
            All
          </button>
          {codes.map((c) => (
            <button
              key={c}
              type="button"
              className={`solenoid-problems-layer__filter${codeFilter === c ? " solenoid-problems-layer__filter--active" : ""}`}
              onClick={() => setCodeFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {!collapsed && entries.map(row)}
    </div>
  );
}
