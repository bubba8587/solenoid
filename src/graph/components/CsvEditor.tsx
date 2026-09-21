import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { csvFieldSpans } from "../csv";

/** The table popup's CSV text block. COMPUTED columns' values are marked in place: a
 *  textarea can't style (or lock) part of its text, so a mirror behind it paints the
 *  marks and the transparent textarea types over them. Marked text stays editable; the
 *  table ignores it (a computed column has no cells of its own), so the next time the
 *  text is built it reads the computed values again. */
export function CsvEditor({ value, onChange, onFocus, onBlur, readOnly, markedCols, firstBodyRow, error }: {
  value: string;
  onChange: (next: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  readOnly: boolean;
  /** Column indices whose body fields are marked (empty = no mirror at all). */
  markedCols: ReadonlySet<number>;
  /** 1 when the text opens with a header line (never marked), else 0. */
  firstBodyRow: number;
  /** Shown under the block while the text can't be read back into the table. */
  error?: string | null;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const marked = markedCols.size > 0;

  // The mirror carries the block's background, so it takes the TEXTAREA's box, not the
  // wrapper's: the textarea's own resize grip can make it shorter than the wrapper.
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
        // A translate, not scrollTop: the mirror has no scrollbars, so its own scroll
        // range is a little shorter than the textarea's and would clamp at the ends.
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
