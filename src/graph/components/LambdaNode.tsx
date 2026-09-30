// [[C50]] lambdaBindsByName, [[C95]] commitOnEnter, [[C22]] rowFormulaRefs
import { useState, useEffect } from "react";
import type { LambdaNode as LambdaNodeType } from "../rete-nodes";
import { formatLambda, perRowParamClashes } from "../nodes/lambda";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { FormulaField } from "./FormulaField";
import { applyLambdaChange } from "./expressionEdit";
import { formulaPopup } from "../formulaPopupStore";
import "./ExpressionNode.css";
import { stopDragStart } from "../coarse";

// The λ(…) row declares the parameters, bound BY NAME at the consumer ([[C50]]
// lambdaBindsByName); a formula variable that is not a parameter becomes a captured input row.

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

  // [[C95]] commitOnEnter: a per-keystroke commit would churn sockets.
  async function commitParams() {
    if (params === node.params) return;
    await applyLambdaChange(node, { params });
  }

  return (
    <NodeShell node={node} emit={emit}>
      <div className="solenoid-node__io-row solenoid-lambda__params-row">
        <span className="solenoid-node__io-label">λ(</span>
        <input
          className="solenoid-node__inline-input solenoid-lambda__params"
          style={{ width: `calc(${(params || "x, y").length + 1}ch + 14px)` }}
          value={params}
          placeholder="x, y"
          onChange={(e) => setParams(e.target.value)}
          onBlur={commitParams}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
          title="Parameters, bound by name where the lambda is used"
        />
        <span className="solenoid-node__io-label">)</span>
      </div>
      <FormulaField
        value={expr}
        placeholder="x * rate …"
        onOpen={() => formulaPopup.open(node.id)}
      />
      {node.cachedError && (
        <div className="solenoid-expr__error">{node.cachedError}</div>
      )}
      {perRowParamClashes(node.paramList(), node.expr).map((p) => (
        <div key={p} className="solenoid-expr__lambda-hint">
          LAMBDA parameter <code>{p}</code> and body <code>@{p}</code> are per-row operators. For whole-column references, use <code>[{p}]</code> and/or exclude <code>{p}</code> from the parameters list &amp; place it only in the expression body.
        </div>
      ))}
      <InlineInputs
        node={node}
        emit={emit}
        titleFor={(k) => node.varDescriptions[k] || undefined}
      />
      {/* An FC's view-as applies downstream, never to this source card; a plain div, since ValueDisplay's string path applies a docked FC's textScale. */}
      {node.cachedValue
        ? <div className="solenoid-node__display-value">{formatLambda(node.cachedValue)}</div>
        : <ValueDisplay value={null} />}
    </NodeShell>
  );
}
