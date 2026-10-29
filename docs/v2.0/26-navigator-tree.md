# Bundle 26 — The workspace tree: folders, documents and pages in the Navigator

**Source:** the author, 2026-10-29: multi-document work goes through tree navigation in the
Navigator rather than Excel-style sheet tabs, "so graphs can have whatever kind of grouping and
group-groups", and the tree "could also be read that way directly from a simple file tree".
Asked to choose between a page tree inside one document, a tree of separate files, or both,
the author chose **both layers**: folders of files, and each file with its own tree of pages.
Values flowing between separate documents will get their own systems later and are out of this
bundle's scope. **Verdict:** IN as a plan; the leaf is [[C132]] workspaceTree. **Written:**
2026-10-29, plan plus a pane prototype. The mechanics are `../../tree/specs/documents/workspace-tree.md`.

This bundle owns **what the Navigator pane shows and does**. It reshapes two neighbors without
taking their jobs: bundle 20 (pages) keeps the page model, the engine and cross-page cables but
loses its page strip to the tree; bundle 21 Stage 0 (the sync-folder watcher) is the same watcher
the desktop tree needs, so the two build it once.

## What stands today

- The library is a flat list, newest first (`documentStoreCore.ts` `DocLibrary`); no folder,
  parent or order field exists. It lives in `localStorage` on every platform, a desktop document
  optionally bound to a `.json` file (`filePath`). Mechanics:
  `../../tree/specs/documents/per-doc-autosave-persistence.md`.
- The only switcher is the documents menu under the document name (`DocumentTitle.tsx`):
  Recent documents with rename, duplicate and remove; New Blank Document; New from example.
- The desktop "Documents folder" setting is a bookmark for Open in file manager; nothing scans it.
  Open adds a new library entry every time, even for a path already in the library. Nothing
  watches a file for outside changes.
- The Navigator is the node outline of the one open canvas (`OutlinePanel.tsx`,
  `../../tree/specs/canvas/outline-panel.md`). It overlays the canvas at 248px.
- Pages do not exist in the model. Bundle 20 plans them: `page` on each node in the sidecar,
  `pages` on `SavedGraph`, one engine, cross-page cables as portal stubs.

## The tree, in one picture

Four kinds of row, and one rule that keeps them apart: **a container never holds nodes, and a
canvas never holds other rows of its own kind.**

| Row | Is | Holds | Where it lives |
|---|---|---|---|
| Folder | a grouping of documents | folders, documents | desktop: a folder on disk; web: a path on the library entry |
| Document | one file, one engine, one name space | pages and page folders, or (one page) its outline | desktop: a file; web: a library entry |
| Page folder | a grouping of pages inside a document | page folders, pages | the document's `pages` list |
| Page | one canvas | the outline of that canvas (groups, nodes) | the document's `pages` list |

A document with a single page shows no page row: the document row expands straight to its
outline, so today's one-canvas documents look exactly as they do now. The page rows appear the
moment a second page is added. A folder never holds nodes, and page folders exist so a big
model can be sorted ("Inputs", "Scenarios", "Reports") without splitting the engine.

The boundary that matters to the user is the document row: inside it, cables cross pages
freely; between documents, nothing flows yet. The document icon carries that boundary
visually (a file glyph against the folder and page glyphs), and the spec pins the glyph set.

## Four ways to lay out the pane

Each was sketched at desktop (248 to 360px wide) and phone (`min(248px, 84vw)`) sizes, with a
library of 40 documents in 6 folders and an open document of 3 pages, one holding 60 nodes.

**A. One tree.** Folders, documents and pages in one tree, and the open page's outline nested
under its page row as more rows. One scroll, one search box, one keyboard model.
**B. Two stacked sections.** A Files section (folders, documents, pages) above an Outline
section (the open page's groups and nodes), each with its own header, collapse chevron and
scroll, and a drag handle between them on desktop.
**C. A switch.** A segmented control at the top of the pane flips the whole pane between Files
and Outline.
**D. Drill-down.** One level at a time with a breadcrumb at the top, as in a phone's file app:
Workspace › Finance › Budget 2026 › Q3, tapping a row goes in, the breadcrumb comes back out.

| | A one tree | B stacked | C switch | D drill-down |
|---|---|---|---|---|
| See where you are and what is in it at once | yes, until the outline pushes the files off-screen | yes | no | the breadcrumb only |
| A 60-node outline next to 40 documents | the files scroll away | each scrolls on its own | fine | fine |
| Fits a phone | cramped | cramped: two scrollers in 600px | good | best |
| What a search searches is obvious | mixed (file names and node names in one list) | per section | per mode | per level |
| Moving a node to another page by drag | a short drag | across the split | impossible without hovering the switch | impossible |
| Change from today | the outline indents one level deeper | a section added above today's list | a switch added above today's list | a new navigation model |
| Build cost | low | low | lowest | medium |

**Recommendation: B on desktop and tablet, and B as an accordion on a phone** (opening one
section folds the other, so the phone shows one scroller at a time, which is C's strength
without its switch). The Outline section's header carries the breadcrumb of the open page
(Budget 2026 › Q3), and tapping it scrolls the Files section to that row and opens it, which is
D's strength without its navigation model. A is the runner-up and costs the least to try,
so the prototype renders both A and B for a side-by-side look (§ The prototype).

## The upgrades, ranked

Each line says what the user gets. The spec carries the mechanics.

### Must ship with the tree

1. **Files section.** The tree of folders, documents and pages above the outline. A single click
   on a document or page opens it: switching is the reason the row exists, unlike an outline row,
   where a plain click stays put so the canvas doesn't jump. The open document and page wear the
   accent-soft fill (the selected-row look the outline already uses), never a stripe.
2. **Folders on the web.** A library entry gains a folder path, so the browser library sorts
   into the same tree the desktop reads from disk. New Folder, rename, move into a folder,
   delete an empty folder; deleting a folder with documents asks and names the count.
3. **The desktop tree is the Documents folder** ([[D103]] folderOnDisk). Its subfolders are the
   folders, its graph files are the documents, and a rename or move in the pane is a rename or
   move on disk. A file changed outside the app reloads if the open copy is clean and offers Keep
   mine, Take theirs or Save mine as a copy if it is not (bundle 21 Stage 0, built once for both).
4. **Pages and page folders** under each document, once bundle 20's model lands: add, rename,
   reorder by drag, nest in a page folder, delete (a page with nodes asks, and its nodes move to
   another page rather than vanish).
5. **A + menu in the pane header**: New Document, New Folder, New Page, and New from example
   (the seed accordion, moved here from the documents menu). New items land in the selected
   folder or document and open in rename.
6. **Row menu**: a ⋯ button on hover (always shown on touch) and right-click or long-press: Open,
   Rename, Duplicate, Move to…, Delete, and on desktop Reveal in file manager and Copy path.
   Rename is also F2 and a double click on the name.
7. **The documents menu retires** once the pane does its job: the document name in the top bar
   becomes a breadcrumb (Finance › Budget 2026 › Q3) whose segments open the Navigator at that row.
   One home per action.

### Strong second wave

8. **Search with a scope.** The search field gains a scope pill: This page (today's behavior),
   This document (every page), Everywhere (document and page names in the whole library, plus
   node names from a small per-document name index kept beside the library entry). A result in
   another document opens it and flies to the node.
9. **Drag and drop.** Documents between folders; pages between page folders; outline rows onto a
   page row to move those nodes to that page (their cables survive as bundle 20's stubs); outline
   rows onto a group row to add them to the group. A drop onto a document row in another document
   is refused until values between documents exist.
10. **Status on the row.** A dot for unsaved changes (desktop), a badge for changed on disk, and the
    Problems count, so a broken document is visible from the tree before it is opened.
11. **Remembered state.** Which folders and documents are expanded, the split position and the pane
    width, per device; the tree reopens as it was left.
12. **A resizable pane** on desktop: drag its right edge between 200 and 480px. Whether a pinned-open
    pane pushes the canvas the way the docked Report does, instead of overlaying it, is an author
    call (§ Questions).
13. **Keyboard.** The tree is an ARIA tree: arrows move and fold, Enter opens, F2 renames, Delete
    deletes, typing jumps to the next row starting with those letters, Ctrl+F focuses search.

### Later, or only if asked

14. **Pinned** documents in a small section at the top of Files.
15. **A page preview** on hover: a thumbnail of the page's cards, drawn from the minimap's geometry.
16. **Several roots** on desktop: the Documents folder and an Obsidian vault side by side, each a
    top-level row. The vault root is where [[B1]] obsidianBet pays off (graphs beside the notes they
    read and write), and it needs only the same folder reader.
17. **Open in a second window** (desktop). Not before values between documents, because two
    windows on two documents invite the cross-document drag this plan refuses.

## The prototype

Built on `rust-port` with this bundle, inside the pane only:

- **Files section, real**: lists the actual library, opens a document on a single click, renames
  inline and duplicates or deletes from the row menu, with the open document marked.
- **Folders, pages and page folders, mocked**: `?navpreview=1` on the URL fills the Files section
  with a sample workspace (folders, a multi-page document with a page folder) so the look can be
  judged before the models exist. The sample rows are inert except for folding.
- **Layout A and B side by side**: the pane header's layout toggle (preview only) switches between
  the stacked sections and the one tree.

What the prototype does not do: no folder or page persistence, no disk tree, no search scope, no
drag and drop.

## Questions for the author

1. **Is a document one file or a folder?** The recommendation keeps one file per document with its
   pages inside (the 2026-08-30 call). The alternative stores a document as a folder of page files
   plus a small manifest, which makes the tree a plain file tree all the way down and diffs one page
   at a time in git, at the cost of a document no longer being one thing to email or attach.
2. **Do new documents become files right away on desktop?** Obsidian makes a file the moment a note
   is created. Today a new document lives in the browser storage until the first Save. A real-folder
   tree reads best when every row is a file, which means a new document is written into the selected
   folder at once, named Untitled, and autosave writes the file.
3. **Overlay or push** when the pane is open on desktop: it overlays the canvas today, which suits a
   glance; a tree you work from all day suits a dock that pushes the canvas like the docked Report.
4. **The graph file extension.** Files are `.json` today, so a folder reader can't tell a graph from
   any other JSON. A distinct extension (`.solenoid`, or `.sol.json` to keep editors' JSON
   highlighting) lets the tree list only graphs.
5. **Page folders, or flat pages?** The recommendation allows page folders, since the same tree draws
   them for free; flat pages are simpler if documents stay small.

## Build order

1. The pane restructure: Files section over today's flat library, the + menu, the row menu, layout B
   with the phone accordion. Nothing in the model changes.
2. Folders in the web library (`folder` on the library entry, new transforms in `documentStoreCore`,
   persistence tests), New Folder, Move to…, delete with the count.
3. Bundle 20's page model, then page and page-folder rows, add, rename, reorder.
4. The desktop disk tree and the watcher (with bundle 21 Stage 0), the extension call, Reveal and
   Copy path.
5. Search scope and the name index; drag and drop; row status; remembered state; resizing.
6. The documents menu retires and the top-bar name becomes the breadcrumb.

## Exit criteria

A library of nested folders, each document with nested pages, reads as one tree in the Navigator
on desktop, web and phone; the desktop tree and the Documents folder on disk agree after any
rename, move or outside edit; the open document and page are always visible in the tree; the
outline of the open page stays one tap away; and every action the documents menu offered has a
home in the pane before that menu goes.
