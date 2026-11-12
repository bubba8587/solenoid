---
aliases: ["Command Palette"]
tags: [spec, canvas]
---
<!-- [[A1]] -->
<!-- [[A1]] visualGraphCalculator, [[B13]] aiInScope, [[B19]] spreadsheetHabits -->

# Spec: Command Palette

Serves [[A1]] visualGraphCalculator, and in AI mode [[B13]] aiInScope. It covers what the system does and blocks, and the decision each behavior serves.

The Command Palette is the menubar in searchable form: a list of every action the app can take from its menus, plus the canvas and selection operations that have no menu home. It opens as a modal, or stays docked as a bar when the `commandPaletteAlwaysOn` setting is on (desktop only).

Code: `CommandPalette.tsx`, `menuModel.ts` (`buildMenus`, `fireMenuKey`), `aiService.ts`, `aiGrounding.ts`, `aiDemo.ts`, `aiKey.ts`.

## What it lists

- **Every enabled menubar item** (`buildMenus`), so a new menu item is a palette command automatically.
- **Canvas operations with no menu home:** Isolate selection (I) and Expand or collapse groups (E). The palette presses them as synthetic keys (`fireMenuKey`), as the menus do Tidy (T) and Cleanup (C), so the canvas's own keyboard handler runs them with every gate it applies: a locked canvas refuses Tidy from the menu as it does from T.
  - The key goes down on the document, where React Flow's Delete listens, and bubbles on to the canvas keyboard on `window`.
  - It is released a task later, since RF's key trackers would otherwise hold it pressed and a later Ctrl-click would stop multi-selecting.
- **Selection layout:** the six aligns, whose labels name the end effect ("Align center (vertical)" runs `center-h` and stacks nodes in a column), the two distributes, and Collapse and Expand selection.
- **Never settings:** they live in the Settings dialog.
- **Never node types:** the Add menu is the one place to browse the catalog.

Tests: `fireMenuKey.test.ts`: a pressed key goes down on the document and is released a task later, and the menus' Tidy and Cleanup press T and C.

## Searching and running

- With an empty query the palette shows 8 previews, led by up to 3 recently run commands (`commandRecents`, recorded by label and marked "recent"). A docked bar shows nothing until it is focused.
- A query scores command labels with `fieldScore` and shows the best 20.
- Nothing is selected until the user types; then the top result is. A blind Enter never runs an action the user did not pick.
- Running an item records it as recent and closes the palette before the command runs, since an open palette owns the keyboard ([[react-flow-surface-contract]] gate 4) and would refuse the command's own key; a docked bar is then cleared and refocused.
- Escape closes the modal, or clears and blurs the bar.
- The modal takes focus when it opens. The docked bar never takes focus on mount; the palette hotkey (the `paletteStore` flag) means "focus the bar" instead.

## AI mode

When an AI key is connected, a sparkle button switches the palette to AI mode ([[B13]] aiInScope). The mode is local to one palette session, so a reopened modal comes back in command mode, and it drops back to command mode when the key is cleared.

1. There is no result list. Enter sends the prompt with the document's text form, one turn at a time.
2. The reply is an answer, an error, or an edit. An edit shows as a line diff with any warnings, plus Cancel and Apply; an empty diff reads "The document already matches that request."
3. Apply loads the rewritten text form through `loadGraph`, the same path a file open takes, then animates in only the nodes the edit added (`revealAddedNodes`). A failed load reports "The rewrite failed to load. The document is unchanged."
4. Escape first dismisses a shown result, then the palette.

**The rewrite path** ([[B13]] aiInScope).

- **A whole-document rewrite.** An edit is a rewrite of the text form: the model emits a full replacement in a fence, the strict validator gates it, and there is no edit-operation layer. A reply without a fence is an answer; a refusal is an error; a legal cycle stays on the edit as a warning.
- **Nothing touches the document.** Nothing in the AI service touches the document; a validated rewrite reaches only the approval diff above.
- **Canonical.** The rewrite is canonicalized through the text-form writer before the diff, so the diff shows only semantic change.
- **Repair.** Each repair round feeds the validator's issues back to the model; once the repair budget is spent, the reply is an error naming the surviving issues.
- **No key.** Without a stored key the prompt errors before any request.
- **The demo.** The `demo` key swaps only the transport, so validation, repair and canonicalization run for real in the demo too. The demo model's replies are what a good real reply would be: its staged build (data, then totals, then a chart) is validator-clean, wired and placed at each stage, computes the right numbers when run, builds to the right of an existing document without disturbing it, and a question gets a summary of the document instead of an edit.

The result surface stays neutral in AI mode: the accent marks the input's rerouted Enter, not the output.

**Provider, grounding and the off switch** ([[B13]] aiInScope). The provider is Anthropic (`aiService.ts`). The model's grounding is generated from `nodeCatalog.ts` and the live node classes (`aiGrounding.ts`), never hand-written ([[engineering#One declaration per fact]]). It is built once per session, so the system prompt stays byte-identical across turns and the provider's prompt cache hits. The assistant ships switched off through `AI_ENABLED` in `aiKey.ts`; off, the sparkle, the Settings section and the What's New slide all hide, even with a key stored, and turning the flag on restores the whole surface. With the flag on, the palette counts as connected (`aiConnected`) exactly when a key for the provider is stored, with no separate flag that could drift from the key.

Tests:

- `aiService.test.ts`, over a fake transport with the real validator: no key, an answer, a canonicalized edit, a repair round, the exhausted budget, a refusal, and a cycle kept as a warning.
- `aiDemo.test.ts`: the staged build, validator-clean at each stage and right when run, an existing document kept, a question answered, and the demo transport running the real pipeline from the key alone.
- `aiKey.test.ts`: with `AI_ENABLED` off, the palette is disconnected with or without a key.

