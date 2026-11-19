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
import { PAGE_SCOPE, SLOT_ATTR, dirOf, pageLink } from "../htmlPageText";
import { openExternal } from "../fileBridge";
import { pushNotice } from "../noticeStore";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isMermaidValue } from "../mermaidValue";
import { isImageValue } from "../imageValue";
import { isSvgValue } from "../svgValue";
import { isDocumentValue } from "../documentValue";
import { InlineRefValue } from "./inlineRefDisplay";
import { FigureScope } from "./chartCore";
import { errorTip } from "./ErrorChip";
import { useEscapeToClose } from "./useEscapeToClose";
import { useCoversCanvas } from "./useCoversCanvas";
import "./Markdown.css";
import "./ReportOverlay.css";
import "./DashboardOverlay.css";
import "./HtmlPageOverlay.css";
import solenoidIcon from "../../logo/solenoidicon.svg";

/** Prints the page alone, every sheet of it with its own backgrounds; the print stylesheet hides the rest of the app. */
/** While a page is open, Print (Ctrl+P, ⌘P, the browser's menu) prints the page alone: the class the print
 *  stylesheet keys on is set for the dialog and cleared after. */
function usePrintsThePage(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const on = () => root.classList.add("sol-printing-page");
    const off = () => root.classList.remove("sol-printing-page");
    // The desktop app's webview has no Print shortcut of its own, so the page answers Ctrl+P and ⌘P itself.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") { e.preventDefault(); on(); window.print(); }
    };
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, [open]);
}

/** The way back to the app, the page's only chrome: shown at the top and on a scroll up or a pointer near it, hidden
 *  on a scroll down so the page has the whole window. */
function BackButton({ scroller }: { scroller: HTMLElement | null }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (!scroller) return;
    let last = scroller.scrollTop;
    const onScroll = () => {
      const y = scroller.scrollTop;
      if (y < 48 || y < last - 4) setShown(true);
      else if (y > last + 4) setShown(false);
      last = y;
    };
    const onMove = (e: PointerEvent) => { if (e.clientY < 72 && e.clientX < 160) setShown(true); };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove);
    return () => { scroller.removeEventListener("scroll", onScroll); window.removeEventListener("pointermove", onMove); };
  }, [scroller]);
  return (
    <button
      type="button"
      className={`sol-htmlpage__back${shown ? "" : " sol-htmlpage__back--hidden"}`}
      onClick={() => htmlPageStore.close()}
      onFocus={() => setShown(true)}
      title="Back to Solenoid (Esc)"
      aria-label="Back to Solenoid"
    >
      <span className="sol-htmlpage__mark" style={{ WebkitMaskImage: `url("${solenoidIcon}")`, maskImage: `url("${solenoidIcon}")` }} />
    </button>
  );
}

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

/** The place a link to another page names, until that page is drawn. */
let pendingAnchor: string | null = null;

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
  // A link goes to a place on the page, to another page the graph shows, or to the web outside the app; it never moves
  // the app's own address.
  const scrollTo = (id: string) => {
    if (!ref.current) return;
    const to = id ? [...ref.current.querySelectorAll<HTMLElement>("[id]")].find((el) => el.id === id) : ref.current;
    to?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest?.("a[href]");
    if (!a) return;
    e.preventDefault();
    const link = pageLink(a.getAttribute("href") ?? "", dirOf(node.fileName.trim()));
    if (!link) return;
    if ("web" in link) { void openExternal(link.web); return; }
    if (!("page" in link)) { scrollTo(link.anchor); return; }
    const target = getOwningEditor(node.id)?.getNodes()
      .find((n) => n instanceof HtmlPageNode && n.fileName.trim().replace(/\\/g, "/") === link.page);
    if (!target) { pushNotice(`No HTML Page in this graph shows ${link.page}`); return; }
    pendingAnchor = link.anchor;
    htmlPageStore.open(target.id, true);
  };
  // Opened by a link that names a place on it: go there once the page is drawn.
  useLayoutEffect(() => {
    if (pendingAnchor === null) return;
    const id = pendingAnchor;
    pendingAnchor = null;
    if (ref.current) ref.current.closest(".sol-htmlpage__scroll")?.scrollTo({ top: 0 });
    if (id) requestAnimationFrame(() => scrollTo(id));
  }, [body]);
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
  usePrintsThePage(!!node);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  // Back from editing the files elsewhere, the page reads them again; unchanged text redraws nothing.
  const openId = node?.id;
  useEffect(() => {
    if (!openId) return;
    const reread = () => void refreshConnection(openId);
    window.addEventListener("focus", reread);
    return () => window.removeEventListener("focus", reread);
  }, [openId]);
  if (!node) return null;
  const render = node.render;
  return (
    <div className="sol-htmlpage" role="dialog" aria-label={node.label?.trim() || "HTML Page"} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sol-htmlpage__scroll" ref={setScroller}>
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
      <BackButton scroller={scroller} />
    </div>
  );
}
