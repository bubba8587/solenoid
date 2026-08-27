import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useKatexRender, getKatexRenderer } from "./katexLoader";
import type { ClassicPreset } from "rete";
import { formulaPopup } from "../formulaPopupStore";
import { processGraph } from "../process";
import { getOwningEditor, getOwningArea } from "../activeGraph";
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

// Step-by-step evaluator: built, then shelved; flip to re-enable its intact wiring.
const SHOW_STEPS = false;

// One adapter shape, so the popup stays node-type-agnostic across the formula hosts.
type FormulaHost = {
  label: string;
  text: string;
  locked: boolean;
  setText: (s: string) => void | Promise<void>;
  /** The Equation node: no "=" prefix — the text carries its own. */
  equation?: boolean;
  /** Per-variable prose; undefined = this host doesn't support variable descriptions. */
  varDescriptions?: Record<string, string>;
  setVarDescription?: (name: string, desc: string) => void;
};

// Identify hosts by constructor NAME, never instanceof — a Vite hot swap replaces the class
// objects while rete keeps instances built from the old ones, silently breaking the gate.
const TABLE_LAMBDA_TYPES = new Set(["MapTableNode", "ByAxisNode", "MakeArrayNode", "ReduceLambdaNode", "ScanLambdaNode", "OdeIntegrateNode"]);

/** Display-only, so no recompute — just re-render the card for its tooltip. */
function setVarDesc(node: { id: string; varDescriptions: Record<string, string> }, name: string, desc: string): void {
  if (desc.trim() === "") delete node.varDescriptions[name];
  else node.varDescriptions[name] = desc;
  void getOwningArea(node.id)?.update("node", node.id);
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
    // Its variables are column names, so there are no variable descriptions.
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

// Descriptions are notes, not formula: kept OUT of the formula string, committed per
// keystroke, and editable even when the formula is locked.
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

// Falls back to the raw string while katex is still loading; useKatexRender re-renders
// the popup once the chunk arrives.
function renderTex(latex: string): string {
  const render = getKatexRenderer();
  if (!render) return latex;
  try { return render(latex, { throwOnError: false }); }
  catch { return latex; }
}

// Mirrors ExpressionNode.data's variable resolution; null when any input isn't a plain
// number, since the step-by-step walk is scalar-only.
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

/** The formula popup, mounted once in App and opened from any FormulaField. */
export function FormulaPopup() {
  const nodeId = useSyncExternalStore(formulaPopup.subscribe, formulaPopup.get);

  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  useSyncExternalStore(groupMembershipStore.subscribe, groupMembershipStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);

  const [text, setText] = useState("");
  const initedFor = useRef<string | null>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  // The formula is written ONCE on exit, never per keystroke — a half-typed formula would
  // drop a variable mid-edit and destroy the cables already wired to it. `textRef` exists
  // because the Escape listener closes over a stale `text`.
  const textRef = useRef("");
  const committedRef = useRef("");

  // The single place the formula (and, via applyExprChange, its sockets) is written.
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

  // Owning editor, not main — a card inside a composite drill-in opens this same popup.
  const node = nodeId ? getOwningEditor(nodeId)?.getNode(nodeId) : undefined;
  const host = formulaHostOf(node);
  if (!node || !host) return null;
  const locked = host.locked;

  // Mirror NodeCard's accent + group-color CSS vars so the chrome matches the node.
  const mode = appThemeStore.getMode();
  const rawAccent = NODE_KIND_ACCENTS[nodeKindOf(node)];
  const groupColor = groupMembershipStore.color(node.id);
  const grouped = !!groupColor;
  const style: CSSProperties = {};
  const cssVars = style as Record<string, string>;
  // `--node-accent` must ship with its own ink — the app-wide --accent-ink is a different hue.
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

        {/* Engine note: the formula path resolves through the same registry as the
            visual nodes, so they match wherever they overlap. The load-bearing thing
            to tell the user is the SHAPE boundary as of matricesInFormulas/tableRefSemantics: scalars, lists and
            MATRICES are in (with complex); frames/cubes stay out — the verb nodes
            are their surface, and a computed column's references are the row door. */}
        {host.equation ? (
          <div className="formula-popup__engine-note">
            ƒ One <strong>=</strong> with variables on either side. Leave exactly one variable unwired and the node solves for it — a quadratic in the unknown returns <strong>both roots</strong>; no real solution is <code>#SOLVE!</code>. Wire every variable and Check turns TRUE/FALSE.
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
