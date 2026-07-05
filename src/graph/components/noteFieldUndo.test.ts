import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pushNoteFieldRemovalUndo } from "./NoteNode";
import { setPushHistory } from "../process";
import { NoteNode } from "../nodes/annotation";

// The OUTPUT-side sibling of the extensible-row undo hole (b0066df): a body edit that
// removes a wired frontmatter key drops the output socket (body-derived, untracked) AND
// its cable (removeConnection, tracked) — so a plain Ctrl+Z re-added the cable onto a
// socket that no longer existed (a zombie cable to a missing output). The fix records
// the body edit as its own undo entry, ordered so undo restores the body + socket FIRST.

type Entry = { undo: () => void; redo: () => void };
let entries: Entry[] = [];
beforeEach(() => { entries = []; setPushHistory((a) => entries.push(a)); });
afterEach(() => { setPushHistory(() => {}); });

describe("pushNoteFieldRemovalUndo — a body edit that removes a wired key is undoable", () => {
  it("undo restores the body + re-derives the removed output socket; redo removes it again", () => {
    const prevBody = "---\na: 1\nb: 2\n---";
    const node = new NoteNode({ body: prevBody });
    expect(node.outputs.a).toBeDefined();
    expect(node.outputs.b).toBeDefined();

    // Simulate the commit: the body edit removed key `b`, then syncFields dropped its socket.
    const newBody = "---\na: 1\n---";
    node.body = newBody;
    node.syncFields();
    expect(node.outputs.b).toBeUndefined(); // socket gone — would strand its cable

    let refreshed = 0;
    pushNoteFieldRemovalUndo(node, prevBody, newBody, () => { refreshed++; });
    expect(entries).toHaveLength(1);

    entries[0].undo();
    expect(node.body).toBe(prevBody);
    expect(node.outputs.b).toBeDefined(); // socket back → a re-added cable lands on a live socket
    expect(refreshed).toBe(1);

    entries[0].redo();
    expect(node.body).toBe(newBody);
    expect(node.outputs.b).toBeUndefined();
    expect(refreshed).toBe(2);

    entries[0].undo(); // still coherent after a redo
    expect(node.body).toBe(prevBody);
    expect(node.outputs.b).toBeDefined();
  });
});
