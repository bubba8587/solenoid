// [[reports-and-notes#HTML pages]], [[engineering#Untrusted content]]
// An HTML Page shown full screen: its body sanitized, its CSS scoped to the page, and each bare tag's value drawn in
// place, a figure as a Dashboard box.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { htmlPageStore } from "../htmlPageStore";
import { refreshConnection } from "../connectionStore";
import { cableValueStore } from "../cableValueStore";
import { appThemeStore } from "../appTheme";
import { getOwningEditor } from "../activeGraph";
import { HtmlPageNode } from "../nodeClasses";
import { sanitizeNoteHtml } from "../noteHtml";
import { PAGE_SCOPE, SLOT_ATTR } from "../htmlPageText";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isMermaidValue } from "../mermaidValue";
import { isImageValue } from "../imageValue";
import { isSvgValue } from "../svgValue";
import { isDocumentValue } from "../documentValue";
import { InlineRefValue } from "./inlineRefDisplay";
import { FigureScope } from "./chartCore";
import { RefreshIcon } from "./RefreshIcon";
import { CloseIcon } from "./CloseIcon";
import { errorTip } from "./ErrorChip";
import { useEscapeToClose } from "./useEscapeToClose";
import { useCoversCanvas } from "./useCoversCanvas";
import "./Markdown.css";
import "./ReportOverlay.css";
import "./DashboardOverlay.css";
import "./HtmlPageOverlay.css";

/** A value drawn as a box rather than in the page's text. */
export function isPageFigure(v: unknown): boolean {
  return isChartValue(v) || isFrameValue(v) || isCubeValue(v) || isMermaidValue(v) || isImageValue(v) || isSvgValue(v) || isDocumentValue(v);
}

function Slot({ node, name, highlight }: { node: HtmlPageNode; name: string; highlight: boolean }) {
  const value = useSyncExternalStore(cableValueStore.subscribe, () => node.refValue(name));
  if (!isPageFigure(value)) return <InlineRefValue nodeId={node.id} refKey={name} highlight={highlight} />;
  return (
    // A table, cube or document keeps its own height, up to a scroll; a chart, diagram or picture fills the box.
    <section className={`dashboard-box sol-box sol-htmlpage__box${isFrameValue(value) || isCubeValue(value) || isDocumentValue(value) ? " sol-htmlpage__box--flow" : ""}`}>
      <div className="dashboard-box__label sol-box__label"><span className="dashboard-box__name">{name}</span></div>
      <div className="dashboard-box__value sol-box__value sol-md"><InlineRefValue nodeId={node.id} refKey={name} rich fill /></div>
    </section>
  );
}

function PageBody({ node, body }: { node: HtmlPageNode; body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ el: HTMLElement; name: string; highlight: boolean }[]>([]);
  // Set imperatively, as a Report's preview is: React owning the parsed page would orphan the portals on re-render.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = sanitizeNoteHtml(body, node.id);
    setSlots([...root.querySelectorAll<HTMLElement>(`[${SLOT_ATTR}]`)].map((el) => ({
      el, name: el.getAttribute(SLOT_ATTR) ?? "", highlight: el.hasAttribute("data-sol-hl"),
    })));
  }, [body, node.id]);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  // A figure's slot is a block, so its box takes the page's width.
  for (const s of slots) s.el.classList.toggle("sol-htmlpage__slot--box", isPageFigure(node.refValue(s.name)));
  // An in-page link (`href="#aisle"`) scrolls the page to that id; it never moves the app's own address.
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest?.("a[href^='#']");
    if (!a || !ref.current) return;
    e.preventDefault();
    const id = decodeURIComponent((a.getAttribute("href") ?? "").slice(1));
    const to = id ? [...ref.current.querySelectorAll<HTMLElement>("[id]")].find((el) => el.id === id) : ref.current;
    to?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <>
      <div ref={ref} className={PAGE_SCOPE} onClick={onClick} />
      {/* Each value reads its styling from its own slot: the page's variables, or a rule for that one box. */}
      {slots.map((s, i) => createPortal(
        <FigureScope.Provider key={`${s.name}:${i}`} value={s.el}><Slot node={node} name={s.name} highlight={s.highlight} /></FigureScope.Provider>,
        s.el,
      ))}
    </>
  );
}

export function HtmlPageOverlay() {
  const nodeId = useSyncExternalStore(htmlPageStore.subscribe, htmlPageStore.openNodeId);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const found = nodeId ? getOwningEditor(nodeId)?.getNode(nodeId) : undefined;
  const node = found instanceof HtmlPageNode ? found : undefined;
  useEscapeToClose(() => htmlPageStore.close(), !!node);
  useCoversCanvas(!!node);
  // On a phone the page opens under the app's accent bar, which holds the notch inset, as a Dashboard does.
  useEffect(() => {
    if (!node) return;
    const root = document.documentElement;
    const place = () => root.style.setProperty("--dash-top", `${document.querySelector(".solenoid-menubar")?.getBoundingClientRect().bottom ?? 0}px`);
    place();
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("resize", place); root.style.removeProperty("--dash-top"); };
  }, [node]);
  if (!node) return null;
  const render = node.render;
  return (
    <div className="dashboard-overlay sol-htmlpage" onPointerDown={(e) => e.stopPropagation()}>
      <div className="report-header">
        <span className="report-title">{node.label?.trim() || "HTML Page"}</span>
        <div className="report-header-actions">
          <button type="button" className="report-close" onClick={() => void refreshConnection(node.id)} title="Read the files again" aria-label="Read the files again">
            <RefreshIcon size={14} />
          </button>
          <button type="button" className="report-close" onClick={() => htmlPageStore.close()} title="Close (Esc)" aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
      </div>
      <div className="sol-htmlpage__scroll">
        {render ? (
          <>
            <style>{render.css}</style>
            <PageBody node={node} body={render.body} />
          </>
        ) : node.error ? (
          <div className="sol-htmlpage__empty" title={errorTip(node.error)}><span className="sol-htmlpage__code">{node.error.code}</span> {node.error.message}</div>
        ) : (
          <div className="sol-htmlpage__empty">Pick a page on the card</div>
        )}
      </div>
    </div>
  );
}
