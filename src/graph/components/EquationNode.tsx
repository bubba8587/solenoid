import { useState, useEffect } from "react";
import type { EquationNode as EquationNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps, type OutputRowDef } from "./nodeKit";
import { FormulaField } from "./FormulaField";
import { applyEquationChange } from "./expressionEdit";
import "./ExpressionNode.css";

export function EquationComponent({ data: node, emit }: NodeProps<EquationNodeType>) {
  const [expr, setExpr] = useState(node.expr);
  const [, forceUpdate] = useState(0);

  // Stay in sync when the node changes elsewhere (undo/redo).
  useEffect(() => {
    if (node.expr !== expr) setExpr(node.expr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.expr]);

  async function handleExprChange(newExpr: string) {
    setExpr(newExpr);
    await applyEquationChange(node, newExpr);
    forceUpdate((n) => n + 1);
  }

  const lockBadge = node.locked ? (
    <svg className="solenoid-node__corner-lock" width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <title>Equation set by its pack and locked. Rename the title freely.</title>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ) : undefined;

  // One output row per variable (the solved one marked), plus Holds?.
  const rows: OutputRowDef[] = [
    ...node.varNames.map((v) => ({
      key: v,
      label: node.solvedFor === v ? `${v.toUpperCase()} (SOLVED)` : v.toUpperCase(),
      value: node.cachedValues[v] ?? null,
    })),
    { key: "holds", label: "HOLDS?", value: node.cachedHolds },
  ];

  return (
    <NodeShell node={node} emit={emit} labelPlaceholder="Equation" cornerBadge={lockBadge} hideOutputSockets>
      {/* The relation, KaTeX-rendered; sockets derive from its variables. The
          FormulaField edits inline (LAMBDA-style) — no popup host yet. */}
      <FormulaField
        value={expr}
        onChange={handleExprChange}
        placeholder="V = I * R"
        locked={node.locked}
      />
      {node.cachedError && (
        <div className="solenoid-expr__error">{node.cachedError}</div>
      )}
      <InlineInputs node={node} emit={emit} />
      <InlineOutputRows node={node} emit={emit} rows={rows} />
    </NodeShell>
  );
}
