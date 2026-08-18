import { useLayoutEffect, useState } from "react";

/** The record-layout textarea shared by the Record card and the Frame Input
 *  card (the popup Form view authors the SAME syntax): local draft, commit on
 *  blur — Enter must insert a newline, so this cannot use the Enter-commits
 *  helper. A wired layout renders the inert pill instead. Commit semantics
 *  stay with the caller (Record reprocesses; Frame Input only autosaves). */
export function RecordLayoutField({ value, wired, onCommit }: {
  value: string;
  wired?: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useLayoutEffect(() => { setDraft(value); }, [value]);
  if (wired) return <div className="solenoid-record-layout solenoid-record-layout--wired">connected</div>;
  return (
    <textarea
      className="solenoid-record-layout"
      value={draft}
      placeholder="Layout"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
