import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { csvFieldSpans } from "../csv";

/** Computed columns' values are marked by a mirror painted behind the transparent textarea, since a textarea can't style part of its text; the table ignores marked text, so the next build reads the computed values again. */
export function CsvEditor({ value, onChange, onFocus, onBlur, readOnly, markedCols, firstBodyRow, error }: {
  value: string;
  onChange: (next: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  readOnly: boolean;
  markedCols: ReadonlySet<number>;
  /** 1 when the text opens with a header line (never marked), else 0. */
  firstBodyRow: number;
  error?: string | null;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const marked = markedCols.size > 0;

  // The mirror takes the textarea's box, not the wrapper's: the textarea's resize grip can make it shorter.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!marked || !ta) return;
    const fit = () => {
      const m = mirrorRef.current;
      if (!m) return;
      m.style.width = `${ta.offsetWidth}px`;
      m.style.height = `${ta.offsetHeight}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(ta);
    return () => ro.disconnect();
  }, [marked]);

  const mirror = useMemo<ReactNode[]>(() => {
    if (!marked) return [];
    const out: ReactNode[] = [];
    let at = 0;
    for (const s of csvFieldSpans(value)) {
      if (s.row < firstBodyRow || !markedCols.has(s.col) || s.end === s.start) continue;
      if (s.start > at) out.push(value.slice(at, s.start));
      out.push(<mark key={s.start} className="table-popup__csvmark">{value.slice(s.start, s.end)}</mark>);
      at = s.end;
    }
    out.push(value.slice(at));
    return out;
  }, [value, marked, markedCols, firstBodyRow]);

  const textarea = (
    <textarea
      ref={taRef}
      className={`table-popup__csv sol-popup__scroll${marked ? " table-popup__csv--over" : ""}`}
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      wrap="off"
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onScroll={marked ? (e) => {
        // A translate, not scrollTop: the mirror has no scrollbars, so its scroll range is shorter and would clamp at the ends.
        const t = e.currentTarget;
        if (innerRef.current) innerRef.current.style.transform = `translate(${-t.scrollLeft}px, ${-t.scrollTop}px)`;
      } : undefined}
    />
  );

  return (
    <>
      {marked ? (
        <div className="table-popup__csvwrap">
          <div ref={mirrorRef} className="table-popup__csvmirror" aria-hidden="true">
            <div ref={innerRef} className="table-popup__csvmirror-inner">{mirror}</div>
          </div>
          {textarea}
        </div>
      ) : textarea}
      {error && <div className="table-popup__csverror" role="alert">{error}</div>}
    </>
  );
}
