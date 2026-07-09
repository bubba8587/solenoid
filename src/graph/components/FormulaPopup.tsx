import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useKatexRender, getKatexRenderer } from "./katexLoader";
import { ClassicPreset } from "rete";
import { formulaPopup } from "../formulaPopupStore";
import { getEditor, processGraph } from "../process";
import { formulaToLatex, evaluateSteps, extractVariables } from "../excelFormula";
import { nodeKindOf, NODE_KIND_ACCENTS } from "../rete-nodes";
import type { ExpressionNode, EquationNode, MapTableNode, LambdaNode } from "../rete-nodes";
import { appThemeStore } from "../appTheme";
import { groupMembershipStore } from "../groupMembership";
import { cableValueStore } from "../cableValueStore";
import { themeAccent, darkenAccent } from "../palette";
import { applyExprChange, applyLambdaChange, applyEquationChange } from "./expressionEdit";
import { FormulaEditor } from "./FormulaEditor";
import { useFormulaFit } from "./formulaFit";
import { formatScalar } from "./format";
import "./popupChrome.css";
import { CloseIcon } from "./CloseIcon";
import { PopupPinButton, PopupGoToButton } from "./PopupPinButton";
import "./FormulaPopup.css";

// Step-by-step evaluator: built, then shelved. Flip to re-enable — all the wiring
// below (gatherVars, the steps section, evaluateSteps in excelFormula) is kept
// intact behind this flag. Expression-only.
const SHOW_STEPS = false;

// ─── Formula host: the popup edits any node that has a rendered formula ─────────
// Expression (formula in node.expr, derives sockets, can be locked) and the LAMBDA
// family (formula in stringLiterals.formula, fixed sockets, overridden when its
// Formula input is wired). One adapter shape so the popup is node-type-agnostic.
type FormulaHost = {
  label: string;
  text: string;
  locked: boolean;
  setText: (s: string) => void | Promise<void>;
  /** The Equation node: no "=" prefix (the text carries its own), an equation
   *  placeholder, and the solve-oriented engine note. */
  equation?: boolean;
};

// Identify the host by constructor NAME, not instanceof: a Vite hot swap
// replaces the class objects while rete keeps the node instances built from the
// old ones, so an instanceof gate silently stops matching mid-session — the
// popup then opens but never commits ("rename does nothing until reload").
// Names survive the swap; persistence already keys saved nodes on them.
const TABLE_LAMBDA_TYPES = new Set(["MapTableNode", "ByAxisNode", "MakeArrayNode", "ReduceLambdaNode"]);

function formulaHostOf(node: ClassicPreset.Node | undefined): FormulaHost | null {
  if (!node) return null;
  const label = (node as { label?: string }).label || "Formula";
  const typeName = node.constructor.name;
  if (typeName === "ExpressionNode") {
    const n = node as ExpressionNode;
    return { label, text: n.expr, locked: n.locked, setText: (s) => applyExprChange(n, s) };
  }
  if (typeName === "EquationNode" || typeName === "TvmNode") {
    // TvmNode is an EquationNode subclass (always locked → read-only view here).
    const n = node as EquationNode;
    return { label, text: n.expr, locked: n.locked, setText: (s) => applyEquationChange(n, s), equation: true };
  }
  if (typeName === "LambdaNode") {
    const n = node as LambdaNode;
    return { label, text: n.expr, locked: false, setText: (s) => applyLambdaChange(n, { expr: s }) };
  }
  if (TABLE_LAMBDA_TYPES.has(typeName)) {
    const n = node as MapTableNode;
    // A wired Formula input overrides the literal — the popup shows the LIVE
    // piped text (what actually runs), read-only, matching the on-card field.
    const fml = getEditor()?.getConnections().find((c) => c.target === n.id && c.targetInput === "formula");
    const piped = fml ? cableValueStore.get(fml.source, fml.sourceOutput) : undefined;
    const text = typeof piped === "string" && piped.trim() ? piped : (n.stringLiterals.formula ?? "");
    return {
      label,
      text,
      locked: !!fml,
      setText: async (s) => { n.stringLiterals.formula = s; await processGraph(); },
    };
  }
  return null;
}

// Render a KaTeX string to HTML, falling back to the raw string on error or while
// katex is still loading (the popup subscribes via useKatexRender, so it re-renders
// — re-running these calls — once the chunk arrives).
function renderTex(latex: string): string {
  const render = getKatexRenderer();
  if (!render) return latex;
  try { return render(latex, { throwOnError: false }); }
  catch { return latex; }
}

// Resolve the live value feeding each variable: its incoming cable's source
// output, else the node's inline literal, else 0 (mirrors ExpressionNode.data).
// Returns null when any input isn't a plain number (a list input) — step-by-step
// is a scalar walk.
function gatherVars(node: ExpressionNode, expr: string): Record<string, number> | null {
  const editor = getEditor();
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

/**
 * The formula popup: a roomy surface for reading and editing a node's formula,
 * opened from any FormulaField's expand button. The rendered equation sits up top
 * (KaTeX display mode — fractions get vertical room), the formula text below
 * (editable, or read-only when locked / wire-overridden). Chrome mirrors the node
 * card: the same accent header, border, and group-membership treatment, so the
 * popup reads as an extension of its node. Mounted once in App.
 */
export function FormulaPopup() {
  const nodeId = useSyncExternalStore(formulaPopup.subscribe, formulaPopup.get);

  // Subscribe to theme + group membership so the popup's accent / group framing
  // track the node's. cableValueStore so the step-by-step re-evaluates live when
  // an upstream input value changes.
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  useSyncExternalStore(groupMembershipStore.subscribe, groupMembershipStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);

  const [text, setText] = useState("");
  const initedFor = useRef<string | null>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  // Editing is deferred: keystrokes only update the local `text` (and the live
  // KaTeX preview). The node's formula — and, for Expression, its derived input
  // sockets — are written once, on exit (close/Escape). This keeps a transient
  // half-typed formula (e.g. `a+b` → `a+b+` → `a+b+c`) from dropping a variable
  // mid-edit and destroying the cables already wired to it. `textRef` mirrors the
  // latest text for the close handlers (the Escape listener closes over a stale
  // `text`); `committedRef` is the last value pushed to the node, so commit is a
  // no-op when nothing changed.
  const textRef = useRef("");
  const committedRef = useRef("");

  // Push the pending edit to a node — the single place the formula (and its
  // sockets, via applyExprChange) is written. No-op when unchanged or locked.
  function commit(id: string | null) {
    if (!id) return;
    const host = formulaHostOf(getEditor()?.getNode(id));
    if (!host || host.locked) return;
    if (textRef.current === committedRef.current) return;
    committedRef.current = textRef.current;
    void host.setText(textRef.current);
  }

  // Commit the current edit, then close the popup. Used by every exit path.
  function commitAndClose() {
    commit(initedFor.current);
    formulaPopup.close();
  }

  // (Re)seed the editor text whenever a different node's popup opens. Commit any
  // pending edit on the previously-open node first (defensive — closing already
  // commits, but a direct A→B open shouldn't silently drop A's edit).
  useEffect(() => {
    if (!nodeId) { commit(initedFor.current); initedFor.current = null; return; }
    if (initedFor.current === nodeId) return;
    commit(initedFor.current);
    initedFor.current = nodeId;
    const seed = formulaHostOf(getEditor()?.getNode(nodeId))?.text ?? "";
    setText(seed);
    textRef.current = seed;
    committedRef.current = seed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); commitAndClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // The formula's own variables, offered in autocomplete alongside functions.
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

  // Scale the rendered equation to fit the popup's width (no upscaling — the popup
  // is roomy). A genuinely huge formula still floors and h-scrolls.
  useFormulaFit(renderRef, [katexHtml, nodeId], { useHeight: false, max: 1 });

  const node = nodeId ? getEditor()?.getNode(nodeId) : undefined;
  const host = formulaHostOf(node);
  if (!node || !host) return null;
  const locked = host.locked;

  // Mirror NodeCard's accent + group-color CSS vars so the header/border/corner
  // match this node exactly.
  const mode = appThemeStore.getMode();
  const rawAccent = NODE_KIND_ACCENTS[nodeKindOf(node)];
  const groupColor = groupMembershipStore.color(node.id);
  const grouped = !!groupColor;
  const style: CSSProperties = {};
  const cssVars = style as Record<string, string>;
  if (rawAccent) { cssVars["--node-accent"] = themeAccent(rawAccent, mode); cssVars["--node-accent-dark"] = darkenAccent(rawAccent); }
  if (groupColor) { cssVars["--group-color"] = themeAccent(groupColor, mode); cssVars["--group-color-dark"] = darkenAccent(groupColor); }

  // Deferred: update the preview only. The node (and its sockets) are written on
  // exit via commit() — see the close handlers.
  function onChange(next: string) {
    setText(next);
    textRef.current = next;
  }

  const cachedError = (node as { cachedError?: string | null }).cachedError;

  // Step-by-step evaluation (Expression only, shelved behind SHOW_STEPS).
  const exprNode = node.constructor.name === "ExpressionNode" ? (node as ExpressionNode) : null;
  const vars = SHOW_STEPS && exprNode ? gatherVars(exprNode, text) : null;
  const steps = vars ? evaluateSteps(text, vars) : null;
  const varEntries = vars ? Object.entries(vars) : [];

  return (
    <div className="sol-popup-overlay" onPointerDown={() => commitAndClose()}>
      <div
        className={`sol-popup formula-popup${grouped ? " sol-popup--grouped" : ""}`}
        style={style}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sol-popup__header">
          <div className="sol-popup__title">{host.label}</div>
          {locked && <span className="formula-popup__lock-tag" title="This formula can't be edited here.">Locked</span>}
          <PopupGoToButton nodeId={node.id} onClose={() => commitAndClose()} />
          <PopupPinButton nodeId={node.id} />
          <button className="sol-popup__close" onClick={() => commitAndClose()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>

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

          {/* Engine note: the formula path now resolves through the same registry the
              consolidation built, so it matches the visual nodes wherever they overlap
              (the known divergences — MOD/ATAN2/RANK/TRIMMEAN/PERCENTRANK/domain errors —
              are overridden to our impl). The load-bearing thing left to tell the user is
              the SHAPE cap: formulas are scalar / 1-D only. See dev-notes 2026-06-25. */}
          {host.equation ? (
            <div className="formula-popup__engine-note">
              ƒ One <strong>=</strong> with variables on either side. Leave exactly one variable unwired and the node solves for it — a quadratic in the unknown returns <strong>both roots</strong>; no real solution is <code>#SOLVE!</code>. Wire every variable and Check turns TRUE/FALSE.
            </div>
          ) : (
          <div className="formula-popup__engine-note">
            ƒ Works on <strong>single values and 1-D lists</strong>: it broadcasts element-wise and aggregates a list (SUM, AVERAGE…). A 2-D table/matrix can't go straight into a formula and returns <code>#SHAPE!</code>; use <strong>MAP / BYROW / BYCOL / REDUCE / MAKEARRAY</strong> to run a formula over a table. Those apply it per cell/row and can return 2-D.
          </div>
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
      </div>
    </div>
  );
}
