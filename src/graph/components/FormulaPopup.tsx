// [[C15]] matricesInFormulas, [[C51]] formulaNaming
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useKatexRender, getKatexRenderer } from "./katexLoader";
import type { ClassicPreset } from "rete";
import { formulaPopup } from "../formulaPopupStore";
import { processGraph } from "../process";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { formulaToLatex, evaluateSteps, extractVariables } from "../excelFormula";
import { nodeKindOf, NODE_KIND_ACCENTS } from "../rete-nodes";
import type { ExpressionNode, EquationNode, MapTableNode, LambdaNode } from "../rete-nodes";
import { appThemeStore } from "../appTheme";
import { groupMembershipStore } from "../groupMembership";
import { cableValueStore } from "../cableValueStore";
import { themeAccent, darkenAccent, contrastInk } from "../palette";
import { applyExprChange, applyLambdaChange, applyEquationChange } from "./expressionEdit";
import { FormulaEditor } from "./FormulaEditor";
import { useFormulaFit } from "./formulaFit";
import { formatScalar } from "./format";
import { PopupShell } from "./PopupShell";
import "./FormulaPopup.css";
import { nodeDisplayName } from "../catalogUtils";

// The step-by-step evaluator is shelved; true re-enables its intact wiring.
const SHOW_STEPS = false;

type FormulaHost = {
  label: string;
  text: string;
  locked: boolean;
  setText: (s: string) => void | Promise<void>;
  /** The Equation node: no "=" prefix — the text carries its own. */
  equation?: boolean;
  /** Undefined when this host doesn't support variable descriptions. */
  varDescriptions?: Record<string, string>;
  setVarDescription?: (name: string, desc: string) => void;
};

// By constructor name, never instanceof: a Vite hot swap replaces the classes while old instances live on.
const TABLE_LAMBDA_TYPES = new Set(["MapTableNode", "ByAxisNode", "MakeArrayNode", "ReduceLambdaNode", "ScanLambdaNode", "OdeIntegrateNode"]);

/** Display-only, so no recompute — just re-render the card for its tooltip. */
function setVarDesc(node: { id: string; varDescriptions: Record<string, string> }, name: string, desc: string): void {
  if (desc.trim() === "") delete node.varDescriptions[name];
  else node.varDescriptions[name] = desc;
  void getOwningView(node.id)?.rerenderNode(node.id);
}

function formulaHostOf(node: ClassicPreset.Node | undefined): FormulaHost | null {
  if (!node) return null;
  const label = nodeDisplayName(node);
  const typeName = node.constructor.name;
  if (typeName === "ExpressionNode") {
    const n = node as ExpressionNode;
    return { label, text: n.expr, locked: n.locked, setText: (s) => applyExprChange(n, s),
      varDescriptions: n.varDescriptions, setVarDescription: (name, desc) => setVarDesc(n, name, desc) };
  }
  if (typeName === "EquationNode" || typeName === "TvmNode") {
    const n = node as EquationNode;
    return { label, text: n.expr, locked: n.locked, setText: (s) => applyEquationChange(n, s), equation: true,
      varDescriptions: n.varDescriptions, setVarDescription: (name, desc) => setVarDesc(n, name, desc) };
  }
  if (typeName === "LambdaNode") {
    const n = node as LambdaNode;
    return { label, text: n.expr, locked: false, setText: (s) => applyLambdaChange(n, { expr: s }),
      varDescriptions: n.varDescriptions, setVarDescription: (name, desc) => setVarDesc(n, name, desc) };
  }
  if (typeName === "ComputedColumnNode") {
    const n = node as unknown as { id: string; expr: string };
    return { label, text: n.expr, locked: false,
      setText: async (s) => { n.expr = s; await processGraph(n.id); } };
  }
  if (TABLE_LAMBDA_TYPES.has(typeName)) {
    const n = node as MapTableNode;
    return {
      label,
      text: n.stringLiterals.formula ?? "",
      locked: false,
      setText: async (s) => { n.stringLiterals.formula = s; await processGraph(); },
    };
  }
  return null;
}

// Notes, not formula: kept out of the formula string and editable while it is locked, so they commit per keystroke ([[C95]] commitOnEnter).
function VariableDescriptions({ vars, host }: { vars: string[]; host: FormulaHost }) {
  const [local, setLocal] = useState<Record<string, string>>(() => ({ ...host.varDescriptions }));
  const set = (v: string, desc: string) => {
    setLocal((m) => ({ ...m, [v]: desc }));
    host.setVarDescription?.(v, desc);
  };
  return (
    <div className="formula-popup__vars">
      <div className="formula-popup__vars-title">Variables</div>
      {vars.map((v) => (
        <div key={v} className="formula-popup__var-row">
          <span className="formula-popup__var-name" dangerouslySetInnerHTML={{ __html: renderTex(v) }} />
          <input
            className="formula-popup__var-desc"
            value={local[v] ?? ""}
            placeholder="what it means, its unit…"
            onChange={(e) => set(v, e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      ))}
    </div>
  );
}

// The raw string while katex loads; useKatexRender re-renders once the chunk arrives.
function renderTex(latex: string): string {
  const render = getKatexRenderer();
  if (!render) return latex;
  try { return render(latex, { throwOnError: false }); }
  catch { return latex; }
}

// Mirrors ExpressionNode.data's variable resolution; null when any input isn't a plain number (the walk is scalar-only).
function gatherVars(node: ExpressionNode, expr: string): Record<string, number> | null {
  const editor = getOwningEditor(node.id);
  const out: Record<string, number> = {};
  for (const v of extractVariables(expr)) {
    const conn = editor?.getConnections().find((c) => c.target === node.id && c.targetInput === v);
    let raw: unknown = conn ? cableValueStore.get(conn.source, conn.sourceOutput) : node.literals[v];
    if (raw == null) raw = 0;
    if (typeof raw !== "number") return null;
    out[v] = raw;
  }
  return out;
}

export function FormulaPopup() {
  const nodeId = useSyncExternalStore(formulaPopup.subscribe, formulaPopup.get);

  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  useSyncExternalStore(groupMembershipStore.subscribe, groupMembershipStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);

  const [text, setText] = useState("");
  const initedFor = useRef<string | null>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  // Written once on exit, never per keystroke ([[C95]] commitOnEnter); `textRef` because the Escape listener closes over a stale `text`.
  const textRef = useRef("");
  const committedRef = useRef("");

  // The one place the formula, and through applyExprChange its sockets, is written.
  function commit(id: string | null) {
    if (!id) return;
    const host = formulaHostOf(getOwningEditor(id)?.getNode(id));
    if (!host || host.locked) return;
    if (textRef.current === committedRef.current) return;
    committedRef.current = textRef.current;
    void host.setText(textRef.current);
  }

  function commitAndClose() {
    commit(initedFor.current);
    formulaPopup.close();
  }

  // Commit the previously-open node first: a direct A→B open must not drop A's edit.
  useEffect(() => {
    if (!nodeId) { commit(initedFor.current); initedFor.current = null; return; }
    if (initedFor.current === nodeId) return;
    commit(initedFor.current);
    initedFor.current = nodeId;
    const seed = formulaHostOf(getOwningEditor(nodeId)?.getNode(nodeId))?.text ?? "";
    setText(seed);
    textRef.current = seed;
    committedRef.current = seed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const varSuggestions = useMemo(() => extractVariables(text), [text]);

  const render = useKatexRender();
  const katexHtml = useMemo(() => {
    if (!render) return null;
    const latex = formulaToLatex(text);
    if (latex == null) return null;
    try {
      return render(latex, { throwOnError: false, displayMode: true });
    } catch {
      return null;
    }
  }, [text, render]);

  useFormulaFit(renderRef, [katexHtml, nodeId], { useHeight: false, max: 1 });

  // Owning editor: a card inside a drill-in opens this same popup.
  const node = nodeId ? getOwningEditor(nodeId)?.getNode(nodeId) : undefined;
  const host = formulaHostOf(node);
  if (!node || !host) return null;
  const locked = host.locked;

  const mode = appThemeStore.getMode();
  const rawAccent = NODE_KIND_ACCENTS[nodeKindOf(node)];
  const groupColor = groupMembershipStore.color(node.id);
  const grouped = !!groupColor;
  const style: CSSProperties = {};
  const cssVars = style as Record<string, string>;
  // `--node-accent` ships with its own ink; the app-wide --accent-ink is a different hue.
  if (rawAccent) {
    const accent = themeAccent(rawAccent, mode);
    cssVars["--node-accent"] = accent;
    cssVars["--node-accent-ink"] = contrastInk(accent);
    cssVars["--node-accent-dark"] = darkenAccent(rawAccent);
  }
  if (groupColor) { cssVars["--group-color"] = themeAccent(groupColor, mode); cssVars["--group-color-dark"] = darkenAccent(groupColor); }

  function onChange(next: string) {
    setText(next);
    textRef.current = next;
  }

  const cachedError = (node as { cachedError?: string | null }).cachedError;

  const exprNode = node.constructor.name === "ExpressionNode" ? (node as ExpressionNode) : null;
  const vars = SHOW_STEPS && exprNode ? gatherVars(exprNode, text) : null;
  const steps = vars ? evaluateSteps(text, vars) : null;
  const varEntries = vars ? Object.entries(vars) : [];

  return (
    <PopupShell
      title={host.label}
      onClose={() => commitAndClose()}
      cardClassName="formula-popup"
      grouped={grouped}
      cardStyle={style}
      headerExtra={locked && <span className="formula-popup__lock-tag" title="This formula can't be edited here.">Locked</span>}
      pinNodeId={node.id}
    >
      <div className="formula-popup__body">
        <div className="formula-popup__render" ref={renderRef}>
          {katexHtml != null ? (
            <span dangerouslySetInnerHTML={{ __html: katexHtml }} />
          ) : text.trim() ? (
            <span className="formula-popup__raw">{text}</span>
          ) : (
            <span className="formula-popup__empty">No formula yet</span>
          )}
        </div>

        {cachedError && <div className="formula-popup__error">{cachedError}</div>}

        <div className="formula-popup__edit-row">
          {!host.equation && <span className="formula-popup__prefix">=</span>}
          <FormulaEditor
            value={text}
            readOnly={locked}
            placeholder={host.equation ? "V = I * R" : "a * b + c …"}
            rows={2}
            extraNames={varSuggestions}
            autoFocus={!locked}
            onChange={onChange}
          />
        </div>

        {host.equation ? (
          <div className="formula-popup__engine-note">
            One <strong>=</strong>, with variables on both sides. Leave one variable unwired and the node solves for it: a quadratic returns <strong>both roots</strong>, and no real solution is <code>#SOLVE!</code>. With every variable wired, Check shows TRUE or FALSE.
          </div>
        ) : (
        <div className="formula-popup__engine-note">
          The Formula surface does not support Frame-related nodes, such as JOIN.
        </div>
        )}

        {host.varDescriptions && varSuggestions.length > 0 && (
          <VariableDescriptions vars={varSuggestions} host={host} />
        )}

        {SHOW_STEPS && steps && (
          <div className="formula-popup__steps">
            <div className="formula-popup__steps-title">Step by step</div>
            {varEntries.length > 0 && (
              <div className="formula-popup__inputs">
                {varEntries.map(([k, v]) => (
                  <span key={k} className="formula-popup__chip">
                    <span dangerouslySetInnerHTML={{ __html: renderTex(k) }} /> = {formatScalar(v)}
                  </span>
                ))}
              </div>
            )}
            <ol className="formula-popup__steplist">
              {steps.steps.map((s, i) => (
                <li key={i} className="formula-popup__step" dangerouslySetInnerHTML={{ __html: renderTex(s.latex) }} />
              ))}
            </ol>
            <div className="formula-popup__result">
              = <strong>{formatScalar(steps.value)}</strong>
            </div>
          </div>
        )}
        {SHOW_STEPS && !steps && !locked && exprNode && extractVariables(text).length > 0 && !vars && (
          <div className="formula-popup__steps-note">Step-by-step shows for numeric inputs.</div>
        )}
      </div>
    </PopupShell>
  );
}
