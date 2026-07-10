import { useState, useEffect } from "react";
import type { LambdaNode as LambdaNodeType } from "../rete-nodes";
import { formatLambda } from "../nodes/lambda";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { FormulaField } from "./FormulaField";
import { applyLambdaChange } from "./expressionEdit";
import { formulaPopup } from "../formulaPopupStore";
import "./ExpressionNode.css";

// LAMBDA authoring node. The λ(…) row declares the parameters (the call
// signature — bound positionally by MAP / REDUCE / …); the formula below is the
// body. Any formula variable that is NOT a parameter becomes a captured input
// row, same dynamic-socket mechanics as the Expression node.

export function LambdaComponent({ data: node, emit }: NodeProps<LambdaNodeType>) {
  const [expr, setExpr] = useState(node.expr);
  const [params, setParams] = useState(node.params);

  // Sync from the node when it changes elsewhere (undo/redo, formula popup).
  useEffect(() => {
    if (node.expr !== expr) setExpr(node.expr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.expr]);
  useEffect(() => {
    if (node.params !== params) setParams(node.params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.params]);

  async function handleExprChange(next: string) {
    setExpr(next);
    await applyLambdaChange(node, { expr: next });
  }

  // Params commit on blur/Enter — every keystroke would churn sockets.
  async function commitParams() {
    if (params === node.params) return;
    await applyLambdaChange(node, { params });
  }

  return (
    <NodeShell node={node} emit={emit} labelPlaceholder="LAMBDA">
      <div className="solenoid-node__io-row">
        <span className="solenoid-node__io-label">λ(</span>
        <input
          className="solenoid-node__inline-input"
          value={params}
          placeholder="x, y"
          onChange={(e) => setParams(e.target.value)}
          onBlur={commitParams}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
          title="Parameters, bound positionally where the lambda is used"
        />
        <span className="solenoid-node__io-label">)</span>
      </div>
      <FormulaField
        value={expr}
        onChange={handleExprChange}
        placeholder="x * rate …"
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
      {/* The authoring node's own box stays the compact signature — the FC's
          view-as applies downstream (Display / Report), not to the source. */}
      <ValueDisplay value={node.cachedValue ? formatLambda(node.cachedValue) : null} />
    </NodeShell>
  );
}
