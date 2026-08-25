import { useState, useEffect } from "react";
import type { LambdaNode as LambdaNodeType } from "../rete-nodes";
import { formatLambda } from "../nodes/lambda";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { FormulaField } from "./FormulaField";
import { applyLambdaChange } from "./expressionEdit";
import { formulaPopup } from "../formulaPopupStore";
import "./ExpressionNode.css";
import { stopDragStart } from "../coarse";

// The λ(…) row declares the parameters, bound POSITIONALLY by MAP/REDUCE/…; any
// formula variable that is not a parameter becomes a captured input row.

export function LambdaComponent({ data: node, emit }: NodeProps<LambdaNodeType>) {
  const [expr, setExpr] = useState(node.expr);
  const [params, setParams] = useState(node.params);

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

  // Commit on blur/Enter — every keystroke would churn sockets.
  async function commitParams() {
    if (params === node.params) return;
    await applyLambdaChange(node, { params });
  }

  return (
    <NodeShell node={node} emit={emit}>
      <div className="solenoid-node__io-row">
        <span className="solenoid-node__io-label">λ(</span>
        <input
          className="solenoid-node__inline-input"
          value={params}
          placeholder="x, y"
          onChange={(e) => setParams(e.target.value)}
          onBlur={commitParams}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onPointerDown={stopDragStart}
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
      {/* An FC's view-as applies DOWNSTREAM, never to this source card; a plain div
          rather than ValueDisplay, whose string path applies a docked FC's textScale. */}
      {node.cachedValue
        ? <div className="solenoid-node__display-value">{formatLambda(node.cachedValue)}</div>
        : <ValueDisplay value={null} />}
    </NodeShell>
  );
}
