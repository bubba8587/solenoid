import { useState, useEffect } from "react";
import type { ExpressionNode as ExpressionNodeType } from "../rete-nodes";
import type { SolError } from "../errorValue";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { FormulaField } from "./FormulaField";
import { applyExprChange } from "./expressionEdit";
import { ResultTypeToggle } from "./ResultTypeToggle";
import { formulaPopup } from "../formulaPopupStore";
import "./ExpressionNode.css";

export function ExpressionComponent({ data: node, emit }: NodeProps<ExpressionNodeType>) {
  const [expr, setExpr] = useState(node.expr);
  const [, forceUpdate] = useState(0);

  // Resync when the node changes elsewhere — undo/redo, or the formula popup.
  useEffect(() => {
    if (node.expr !== expr) setExpr(node.expr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.expr]);

  async function handleExprChange(newExpr: string) {
    setExpr(newExpr);
    await applyExprChange(node, newExpr);
    forceUpdate((n) => n + 1);
  }

  const lockBadge = node.locked ? (
    <svg className="solenoid-node__corner-lock" width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <title>Formula set by its pack and locked. Rename the title freely.</title>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ) : undefined;

  return (
    <NodeShell node={node} emit={emit} labelPlaceholder="Expression" cornerBadge={lockBadge}>
      {/* Expression infers its inputs from the text, so there is no formula socket. */}
      <FormulaField
        value={expr}
        onChange={handleExprChange}
        placeholder="a * b + c …"
        locked={node.locked}
        onOpen={() => formulaPopup.open(node.id)}
      />
      {node.cachedError && (
        <div className="solenoid-expr__error">{node.cachedError}</div>
      )}
      <InlineInputs
        node={node}
        emit={emit}
        titleFor={(k) => node.varDescriptions[k] || undefined}
      />
      <ResultTypeToggle node={node} dim="combo" />
      {/* cachedResult is value-polymorphic; ValueDisplay branches on each shape. */}
      <ValueDisplay value={node.cachedResult as number | number[] | string | string[] | SolError | null} />
    </NodeShell>
  );
}
