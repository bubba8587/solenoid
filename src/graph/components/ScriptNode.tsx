import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ScriptNode as ScriptNodeType } from "../rete-nodes";
import type { SolError } from "../errorValue";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { FieldResizeGrip } from "./FieldResizeGrip";
import { ResultTypeToggle } from "./ResultTypeToggle";
import { applyScriptChange } from "./expressionEdit";
import { JsEditor } from "./JsEditor";
import { scriptPopup } from "../scriptPopupStore";
import { stopDragStart } from "../coarse";
import "./ExpressionNode.css";
import "./ScriptNode.css";

// The on-card field opens at the source's own height, between the shared 64px field
// floor and a cap that keeps a long script from swallowing the card.
const LINE_H = 16;
const FIELD_CHROME = 10; // padding + borders around the text box
const FIELD_MAX_H = 360;

export function ScriptComponent({ data: node, emit }: NodeProps<ScriptNodeType>) {
  // The source drafts locally and commits on blur (Ctrl+Enter blurs; Escape reverts):
  // a commit re-derives the parameter sockets, which must never happen per keystroke.
  const [draft, setDraft] = useState(node.expr);
  const [, forceUpdate] = useState(0);
  const canceled = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(node.expr); }, [node.expr]);

  // Fit the field to the source ONCE on mount (a loaded script shows itself); after
  // that the height is the user's, dragged by the grip.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const lines = node.expr.split("\n").length;
    el.style.height = `${Math.min(Math.max(lines * LINE_H + FIELD_CHROME, 64), FIELD_MAX_H)}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function commit() {
    if (canceled.current) { canceled.current = false; setDraft(node.expr); return; }
    if (draft === node.expr) return;
    await applyScriptChange(node, draft);
    forceUpdate((n) => n + 1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") { canceled.current = true; e.currentTarget.blur(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.blur(); }
  }

  return (
    <NodeShell node={node} emit={emit}>
      <div className="solenoid-script__field">
        <JsEditor
          value={draft}
          onChange={setDraft}
          placeholder="(x) => x * 2"
          taRef={taRef}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="solenoid-expr__expand"
          title="Open the script"
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); scriptPopup.open(node.id); }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" aria-hidden="true">
            <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
          </svg>
        </button>
        <FieldResizeGrip targetRef={taRef} />
      </div>
      {node.cachedError && (
        <div className="solenoid-expr__error">{node.cachedError}</div>
      )}
      <InlineInputs node={node} emit={emit} />
      <ResultTypeToggle node={node} dim="combo" />
      <ValueDisplay value={node.cachedResult as number | number[] | string | string[] | SolError | null} />
    </NodeShell>
  );
}
