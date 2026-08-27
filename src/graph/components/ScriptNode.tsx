import { useEffect, useRef, useState } from "react";
import type { ScriptNode as ScriptNodeType } from "../rete-nodes";
import type { SolError } from "../errorValue";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { FieldResizeGrip } from "./FieldResizeGrip";
import { ResultTypeToggle } from "./ResultTypeToggle";
import { applyScriptChange } from "./expressionEdit";
import "./ExpressionNode.css";
import "./ScriptNode.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

export function ScriptComponent({ data: node, emit }: NodeProps<ScriptNodeType>) {
  // The source drafts locally and commits on blur (Ctrl+Enter blurs; Escape reverts):
  // a commit re-derives the parameter sockets, which must never happen per keystroke.
  const [draft, setDraft] = useState(node.expr);
  const [, forceUpdate] = useState(0);
  const canceled = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(node.expr); }, [node.expr]);

  async function commit() {
    if (canceled.current) { canceled.current = false; setDraft(node.expr); return; }
    if (draft === node.expr) return;
    await applyScriptChange(node, draft);
    forceUpdate((n) => n + 1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") { canceled.current = true; e.currentTarget.blur(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: t } = el;
      const next = `${draft.slice(0, s)}  ${draft.slice(t)}`;
      setDraft(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  }

  return (
    <NodeShell node={node} emit={emit}>
      <div className="solenoid-script__field">
        <textarea
          ref={taRef}
          className="solenoid-script__textarea nowheel"
          value={draft}
          placeholder="(x) => x * 2"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
          onPointerDown={stop}
          onMouseDown={stop}
        />
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
