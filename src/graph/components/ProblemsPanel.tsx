import { useSyncExternalStore, useState, useRef, useEffect, useMemo } from "react";
import { IS_MOBILE } from "../coarse";
import { problemsStore, problemsPanelUi, type ProblemEntry } from "../problemsStore";
import { registerChrome } from "../chromeToggle";
import { flyToNodeAndFlash } from "../flyToNode";
import { getEditor } from "../process";
import { nodeTypeName } from "../nodeNames";
import { errorTip } from "./ErrorChip";
import { solError } from "../errorValue";
import { insertClampBefore } from "../modelFuzz";
import "./problemsPanel.css";
import { CloseIcon } from "./CloseIcon";

// Lucide "triangle-alert" — the Problems trigger icon (Problems ARE errors, so the
// warning triangle belongs here; Alerts, which aren't necessarily bad, use a bell).
// https://lucide.dev/icons/triangle-alert
const ProblemsSvg = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

/** The Problems HUD panel: every tagged #CODE! error the graph has hit, plus
 *  model-fuzzing findings (origin "fuzz"). Each entry jumps-and-flashes to its node.
 *  Carries its own collapsed state + registerChrome call, like PinLayer/AlertLayer —
 *  HudStack is a hardcoded stack, not a generic API. */
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
        {e.suggestion && (
          <button
            type="button"
            className="solenoid-problem__fix"
            title={`Insert a Clamp node on "${e.suggestion.label}" to keep it in range`}
            onClick={(ev) => { ev.stopPropagation(); void insertClampBefore(e.nodeId, e.suggestion!.socketKey, { min: e.suggestion!.min, max: e.suggestion!.max }); }}
          >
            + Clamp
          </button>
        )}
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
