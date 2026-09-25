---
name: demo-video
description: Record and cut Solenoid's marketing/demo video from the real app and a real Obsidian. Scripted scenes drive the dev server through headless Chromium and a private Obsidian on a virtual display, then captions, title cards, crossfades and a synthesized soundtrack are laid on with ffmpeg. Use when asked to make, refresh or re-cut the demo video, or to add or change a scene.
---

# The demo video

`scripts/demo-video/` films the real app and the real Obsidian plugin, never a mockup ([[B3]] sameNodeEverywhere),
one scene at a time, and assembles a cut. There are two cuts (`cuts.mjs`): `demo`, the tour of the app, and
`obsidian`, a one-minute story for Obsidian users about the plugin. Everything is reproducible: re-run it after UI
changes and the video follows the app.

| File | Job |
|---|---|
| `scenes.mjs` | The Solenoid scenes: each `setup` builds a document off camera, `act` performs on camera; `caption` is `[title, sentence]` |
| `roundtrip.mjs` | The demo cut's Obsidian round trip: the plugin's look, palettes side by side with the app, a Frame property, the imported note side by side, Import Obsidian Note, Write to Obsidian, the note opened in Obsidian |
| `plugin.mjs` | The obsidian cut: the popup's Grid and CSV views, then Priya's emailed table typed into the `q3` Frame property through its Form view, all in Obsidian; then Solenoid beside it joins the note to a roster note, totals it with PIVOTBY and writes the chart back into the note; the plugin's look |
| `cuts.mjs` | Each cut's backdrops, running order, title-card copy, wordmark and output name |
| `record.mjs` | Runs a cut's scenes, or those named, into `.dev/video/clips/<scene>.mp4` + `.json`: Solenoid scenes in Chromium, `app: "obsidian"` scenes on the rig, `app: "both"` stills of both, `app: "split"` scenes with Obsidian and a Solenoid window side by side |
| `rig.mjs` | Chromium launch (headless, or `launchWindow` as a real window on the rig's display), CDP screencast capture, frame-timestamp encoding, the scripted hand (move, click, drag, type, keys) |
| `obsidian.mjs` | The Obsidian rig: fresh demo-vault copy, Obsidian on its own Xvfb display, window placement, the note-only layout, whole-screen recorder, the vault bridge for Solenoid |
| `kit.js` | Page side: camera flights over the live editor, node, socket and cable lookup, card spacing (`row`), callout boxes, the painted pointer, click ring and keycaps |
| `cards.mjs` | Captions and title-card text as HTML in the app's fonts and palette |
| `compose.mjs` | One cut's overlays, crossfades, post zooms, fast-forwards and soundtrack → `.dev/video/<out>.mp4`, `-silent.mp4` and `-poster.png` |
| `music.mjs` | The soundtrack, synthesized: D major pad, bass, soft arpeggio, Freeverb |
| `data/` | The scenes' datasets: `kitchen-costs.csv` (the 40-row ledger pasted in Obsidian), `orders.csv`; the charts scene reads `demo-vault/Data/transactions.csv` |

## Run it

1. **ffmpeg** with libx264 and x11grab on `PATH`, or `FFMPEG=/path/to/ffmpeg`. In a cloud container with no
   ffmpeg: `pip download imageio-ffmpeg --no-deps`, unzip the wheel, use
   `imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-*` (a full static build). Playwright's bundled ffmpeg won't do.
2. **Chromium**: `CHROME=/path` or a system Chrome/Chromium/Edge (`scripts/browser.mjs`); in the cloud container
   `/opt/pw-browsers/chromium-*/chrome-linux/chrome`. Running as root in a container also needs `NO_SANDBOX=1`.
3. **Obsidian** for the round trip: `OBSIDIAN=/path/to/obsidian` (default `/opt/Obsidian/obsidian`). With no install,
   download the AppImage from the obsidianmd/obsidian-releases GitHub release and run it with `--appimage-extract`;
   the binary is `squashfs-root/obsidian`. It also needs `Xvfb`, and `npm run plugin:build` first (the rig copies
   `obsidian-plugin/dist` into the vault).
4. **Fonts**: a bare container has only DejaVu, which makes stock Obsidian look wrong. Install Inter (the static
   `extras/ttf/Inter-*.ttf` from rsms/inter, family "Inter") into `~/.local/share/fonts` and make it the fontconfig
   default for `sans-serif` and `system-ui` (`~/.config/fontconfig/fonts.conf`), then `fc-cache -f`.
5. **Dev server**: `node scripts/dev-up.mjs`. The kit imports app modules by their Vite dev URLs
   (`/src/graph/process.ts`), so a production build won't work. **Restart it after editing app code:** once Vite has
   hot-updated a module, the app imports it under a new URL and the kit's import loads a second copy (the editor
   reads as null).
6. `node scripts/demo-video/record.mjs <cut>` films a cut's scenes (`demo` or `obsidian`), or name scenes to redo
   them. About 30 s a scene. Record one cut per run: the obsidian cut leaves Obsidian with its sidebars collapsed.
7. `node scripts/demo-video/compose.mjs <cut>` (`demo` when none is named).
8. **Watch before you ship.** You can't play video, so pull stills and tile them: `ffmpeg -ss <t> -i clip.mp4
   -frames:v 1 f.png` at the moments that matter (before and after each action, mid-flight), then read the
   tiles. Check `.dev/video/segments/*.mp4` too: they carry the captions, so collisions show there.

Every render and its intermediates land in `.dev/video/` (gitignored). A cut worth keeping is copied to `assets/video/`
(its mp4 and poster) and committed: 10 to 25 MB a version, in git history for good, so only on the author's word.

## How the capture works (don't relearn these)

- **1920×1080 frames**: Chromium runs with `--window-size=1280,720 --force-device-scale-factor=1.5` *and* an
  emulated 1280×720 viewport at 1.5. Either alone gives 1280×720 screencast frames or a cropped window.
  1280×720 CSS at 1.5× reads like a laptop screen: UI text stays legible in the video.
- **Screencast, not screenshots**: `Page.startScreencast` (JPEG q92) sends a frame per compositor change with
  its timestamp, about 35 fps at 1080p. `encodeClip` gives each frame its true duration in an ffconcat list
  and resamples to 30 fps, so still holds cost nothing and motion keeps its timing.
- **Obsidian is filmed whole**: its Settings is a separate window, which a page screencast can't see, so the rig
  runs Obsidian alone on Xvfb `:8` (1920×1080) at `--force-device-scale-factor=1.5`, sizes its window to the screen,
  and `ScreenRecorder` grabs the display with x11grab at 30 fps, trimming the lead-in at `begin()`. Its debugging port
  is 9334, apart from the plugin rig's 9333 (`scripts/obsidian-rig.mjs`). A fresh profile opens Settings once
  (trusting the vault's plugins); the rig closes it. `GTK_THEME=Adwaita:dark`, because with no compositor a
  window's resize border shows the GTK background, a light frame round Settings otherwise.
- **No pointer in headless**: `kit.js` paints one (arrow, hand or I-beam from the element's computed
  cursor), a ring on each press, and keycaps (`hand.press("a", "A")`). The hand moves on a bowed path with
  minimum-jerk timing; `hand.type` varies its rhythm. In Obsidian the kit is injected into each window
  (`injectCursor`) and `c.enterWindow(/^Settings/)` / `c.leaveWindow` hand the pointer across at the same screen spot.
- **Camera**: `c.frame` (instant, off camera), `c.fly` (van Wijk smooth zoom), `c.drift` (slow push or pan).
  They write `view.transform` and call `view.pan`, which bypasses the 10% zoom lattice ([[D71]]
  zoomLatticeDiscreteOnly governs discrete steps only). Wheel zoom would jump in 10% steps.
- **Documents**: `c.doc(graph, name)` imports save-format JSON (`tree/specs/documents/save-format.md`)
  through `documentStore.importAsDocument`; ids are remapped, so find nodes by label with `c.socket`,
  `c.within`, `c.node` (a node with no label is found by its header title). `c.example(seedId)` opens a
  shipped example. A Frame Input takes plain CSV as its `frameText` and types the columns itself.
- **Settings the recorder sets**: spline cables with flow beads (the README hero look) and the minimap hidden.
- **Split scenes** (`app: "split"`) film both apps at once: Obsidian placed on the left 768 px of the display, and
  Solenoid as a real Chromium window (`launchWindow`: `--app`, no `about:blank` tab, no automation bar, `--test-type`
  against the `--no-sandbox` bar) on the rest at device scale 1.2, where its toolbar fits; one x11grab takes both.
  Window bounds are in CSS px at the window's scale and must be whole numbers, or Chromium ignores them. Solenoid's
  pointer is drawn at Obsidian's size (`overlayScale`), and `c.hand("sol", target)` carries the pointer across the
  seam. The Solenoid window can't take settings before its first load, so it sets them and reloads.

## The Obsidian round trip

The vault is a fresh copy of `demo-vault/` at `$TMPDIR/solenoid-demo-obsidian/Demo vault` (Obsidian names the vault
after the folder), reset whenever the run includes a `fresh` scene (`obs-look`, `pl-intro`), with the snippet off,
the plugin's look off and no saved layout. Scenes run in order and hand state on. In the demo cut `obs-property`
pastes the ledger into a new `costs` Frame property, `sol-import` and `sol-write` read that note, `sol-write` writes
`Projects/Kitchen remodel costs.md` and its chart PNG, `obs-open` opens it. In the obsidian cut `pl-form` adds the
West rows to `Sales/Q3 review`, `pl-reload` reads them (Data › Refresh all connections), `pl-write` fills the note's
`Regional chart` block, and `pl-look` shows the finished note. A later scene recorded alone keeps the vault as it
stands and says so if the state it needs is missing.

- **Solenoid reaches the vault** through the FsProvider seam: `bridgeVault` exposes Node's fs, fenced to the vault,
  to the page (`setFsProvider`) and sets `obsidianVault`. The vault cards gate on `hasFs()`, so they work in the
  browser build this way.
- **Open in Obsidian** calls `window.open("obsidian://…")`; the bridge routes it to the rig, which opens the note,
  as the OS would.
- **The paste is real**: the ledger goes on Electron's clipboard without a trailing newline, and `Ctrl V` in the
  Frame editor's CSV view pastes it. Click at the top-left of the box first: a blank frame's block holds a blank
  header line, and a caret below it would make the header row data.

## Writing a scene

- **Captions add what the footage can't show.** Never narrate what is on screen ("charts redraw as the data
  changes" was cut for that): name the feature, then give a fact the viewer can't see, such as what the colors
  mean, the verbs and chart types not shown, that the note stays plain YAML, that nothing writes until Run. Check
  every claim against the catalog description. Follow
  `DESIGN.md` § Voice: no em dashes, no slogans, no teased counts. Reuse the landing page's approved lines.
- **Data inputs are extensive**: a Frame of about 40 rows, not 4, unless it would make a chart busy. Aggregate
  before charting (GROUPBY, then the chart).
- **The caption owns the bottom-left strip** (CSS x 24–564, y 590–690 of 720). Frame with `dx`/`dy` so no
  card sits there; check it in the composed segment.
- The socket legend covers the right edge at 1280 wide: `c.legend(false)` unless the scene is about types.
- 7–12 s a scene: about 1 s before the first action, 1.5–2 s after the last change so the caption reads.
- Prefer one clear interaction per scene (an edit, a drag, a slider, a slicer chip) that visibly changes something
  downstream. A slider makes the best motion: `slide(c, label, fraction, ms)`.
- Keep chart values readable; axis ticks are compact (`180K`).
- **Space the cards**: `c.row(labels, gap)` lays cards left to right at a CSS-px gap (moves them with
  `view.moveNode`); seeds and `c.doc` graphs start crowded or overlapping otherwise.
- **Point at the change**: `c.box(labelOrRect, pad)` draws a gold outline in the page; `c.clearBoxes()` removes
  them all. Useful targets: `c.socketRow(label, key, side)`, `c.chip(label)` (a card's `[40×3 Frame]` chip),
  `c.node(label)`. A box is page chrome, so hold the camera still while one shows.
- **Zoom in post** on chrome the camera can't reach (the Report drawer is DOM, not canvas):
  `rec.at("zoom", {x, y, w, h})` in device px, then `rec.at("unzoom")`. Compose eases in and back out over 0.7 s
  each way with `zoompan` on a doubled frame (its window snaps to whole input pixels), at most 2.2×. It upscales
  1080p, so keep it short. `scale` with `eval=frame` into `crop` doesn't work: crop keeps its first frame size and
  pins the window top-left.
- **Stills scenes** (`app: "both"`, e.g. `palettes`, `import-pair`): `setup({ sol, obs, sleep })` once, then per
  entry in `states` `apply(ctx, state)`, and the recorder takes a Solenoid screenshot and an Obsidian screen grab.
  Compose puts them side by side (`panels: ["obs", "sol"]` flips the order), labels them, crossfades the states and
  holds each `hold` seconds under a slow push-in. An `app: "obsidian"` scene with `states` and `panels: ["obs"]` is
  the same, full frame (`pl-look`). A scene with no `caption` gets no caption strip.
- **Chapter card**: a scene's `chapter: { eyebrow, mark }` opens it on its own first frame, blurred, under a wordmark
  for 1.9 s. The obsidian cut uses one where the story moves into Solenoid (`pl-reload`); keep that scene still for
  its first second, since the crossfade reveals it.
- **Fast-forward**: `c.rec.at("fast", { rate: 4 })` and `c.rec.at("unfast")` play that span at 2, 3 or 4 times under
  a small badge; the other marks move with it. The plugin cut types the first record at speed and forwards the rest.
  More than one zoom: `zoom2`/`unzoom2` and so on. A `caption` mark holds the caption back until then, for a shot
  whose controls sit in the caption's corner (the Grid popup's view buttons).
- **Obsidian for the camera**: `noteOnly` collapses both sidebars, hides the ribbon and the status bar; reading view
  (`openNote(c, file, { reading: true })`) hides `%%` block markers; `webFrame.setZoomFactor` (as Ctrl + = does)
  makes a full-screen shot read larger. Keep what matters above the caption band at the left (CSS y 590).

**Mechanics that bit (2026-09-25):**
- Dropping a cable on empty canvas opens the Add menu only with the `quickWire` setting, off by default.
  Use the A key: the menu opens at the pointer and the card lands there.
- The formula popup commits on close (its × or Esc), not Enter; Enter is a newline.
- A Convert card's top box shows its input number with the output unit: keep Convert out of frame.
- Money over area renders a generic `¤`: keep compound currency units out.
- A Format Controller needs its own cable from the host socket into its `in`, besides docking on it; without it
  the value downstream is empty.
- An Import Obsidian Note's property sockets exist only once the note is read, so cables to them are dropped on
  import. Seed its `body` with the note's text (read from the vault) so the sockets exist up front.
- A document named like an open one gets " 2" appended: a follow-on scene reuses the document instead
  (`documentStore.currentName()`).
- A scene that comes back with "Something threw while rendering" found an app bug: read the stack in the still,
  fix the app on develop, and re-record.
- `record.mjs` talks to the page over CDP: awaiting a long app call (`paletteStore.setActiveBase`) across it
  fails with "Promise was collected". Fire it on a `setTimeout` in the page and sleep.
- Obsidian draws a note's plugin-typed properties raw on the first render after the look turns on: `openNote`
  calls `leaf.rebuildView()`.
- To show landing-page components (the FnWall) over the app, import React from the page's own `.vite/deps`
  URLs and unwrap CJS (`m.default ?? m`); the wall only animates under a `.sol-landing--anim` parent.
- Plugging a cable into a wired input evicts the old one; there's no unplug gesture. Click the cable
  (`c.cableMid`, 30% from its source so crossings don't catch another cable) and press Delete.
- A cable that has to run back left winds across the cards. Route it through Conduits turned 180°: a U-turn under
  the source, a straight run between rows, a hook into the target (`salesGraph`). A spline's arms are 40% of its
  length, so one long backward cable bulges over whatever lies between.
- A menu path must go straight down from its top item: brushing the next top item switches the open menu, and the
  click lands on that menu's first item.
- The plugin's popup centers over the note's pane and can't be moved; the Form view covers most of a narrow pane.
- Obsidian started with its left sidebar collapsed defers the file explorer's view, so `revealInFolder` may not
  exist; a note already open keeps its reading-view scroll through `openFile`.
- `pkill -f <pattern>` matches your own shell when the pattern is in the command line. Kill by PID.

## The cut

Intro card over a blurred backdrop → the cut's scenes → outro card. The demo cut's backdrops are drifts over the
chart showcase and Getting started; the obsidian cut's are still split screens under a push-in, and its cards carry
the Solenoid Properties wordmark (`src/logo/solenoidpropertieswordmark.svg`). 0.5 s crossfades; captions fade in
after each crossfade and out before the next. Title-card copy lives in `cuts.mjs`: the landing pages' lines.

**Preview frame**: the intro card is whole from frame zero (no fade from black), because players and link previews
show the first frame before play. Compose also writes it as `solenoid-demo-poster.png` and embeds it in both mp4s as
cover art (an `attached_pic` stream).

The soundtrack is generated to the cut's exact length, so nothing licensed ships. The agent can't hear it:
it was checked by numbers (no clipping, no DC, lows under -2 dB of the total, mids present) and the author
should listen before publishing. `solenoid-demo-silent.mp4` is always written beside it.
