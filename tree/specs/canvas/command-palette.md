---
aliases: ["Command Palette"]
tags: [spec, canvas]
---
<!-- [[C98]] paletteMirrorsMenubar, [[C55]] aiWholeDocRewrite, [[C95]] commitOnEnter -->

# Spec: Command Palette

Serves [[C98]] paletteMirrorsMenubar, and in AI mode [[C55]] aiWholeDocRewrite. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The Command Palette is a searchable list of every action the app can take from its menus, plus the canvas and selection operations that have no menu home. It opens as a modal, or stays docked as a bar when the `commandPaletteAlwaysOn` setting is on (desktop only). The code is `CommandPalette.tsx`.

## What it lists

- **Every enabled menubar item** (`buildMenus`), so a new menu item is a palette command automatically.
- **Canvas operations with no menu home:** Isolate selection (I) and Expand or collapse groups (E), which the palette presses as synthetic keys (`fireMenuKey`) so the canvas's own keyboard handler runs them, with every gate it applies (a locked canvas refuses Tidy from the menu as it does from T). The key goes down on the document, where React Flow's Delete listens, bubbles on to the canvas keyboard on `window`, and is released a task later, since RF's key trackers would otherwise hold it pressed and a later Ctrl-click would stop multi-selecting.
- **Selection layout:** the six aligns, whose labels name the end effect ("Align center (vertical)" runs `center-h` and stacks nodes in a column), the two distributes, and Collapse and Expand selection.
- **Settings:** every boolean and text setting in `SETTINGS_SCHEMA` as a "Toggle <label>" item that shows on or off. Folder and segment fields are left out, and so, on mobile, are fields marked `disabledOnMobile`, since a palette that could flip a setting greyed out on this device would be a back door around that gate.
- **Never node types:** the Add menu is the one place to browse the catalog.

## Searching and running

- With an empty query the palette shows 8 previews, led by up to 3 recently run commands (`commandRecents`, recorded by label and marked "recent"). A docked bar shows nothing until it is focused.
- A query scores command and toggle labels with `fieldScore` and shows the best 20.
- Nothing is selected until the user types; then the top result is. A blind Enter never runs an action the user did not pick.
- Running an item records it as recent and closes the palette before the command runs, since an open palette owns the keyboard ([[react-flow-surface-contract]] gate 4) and would refuse the command's own key; a docked bar is then cleared and refocused.
- Escape closes the modal, or clears and blurs the bar.
- The modal takes focus when it opens. The docked bar never takes focus on mount; the palette hotkey (the `paletteStore` flag) means "focus the bar" instead.

## AI mode

When an AI key is connected, a sparkle button switches the palette to AI mode ([[C55]] aiWholeDocRewrite). The mode is local to one palette session, so a reopened modal comes back in command mode, and it drops back to command mode when the key is cleared.

1. There is no result list. Enter sends the prompt with the document's text form, one turn at a time.
2. The reply is an answer, an error, or an edit. An edit shows as a line diff with any warnings, plus Cancel and Apply; an empty diff reads "The document already matches that request."
3. Apply loads the rewritten text form through `loadGraph`, the same path a file open takes, then animates in only the nodes the edit added (`revealAddedNodes`). A failed load reports "The rewrite failed to load. The document is unchanged."
4. Escape first dismisses a shown result, then the palette.

**The rewrite path** ([[C55]] aiWholeDocRewrite). An edit is a whole-document rewrite of the text form: the model emits a full replacement, the strict validator gates it, and there is no edit-operation layer. Nothing in the AI service touches the document; a validated rewrite reaches only the approval diff above. The rewrite is canonicalized through the text-form writer before the diff, so the diff shows only semantic change, and each repair round feeds the validator's issues back to the model. The demo key swaps only the transport, so validation, repair and canonicalization run for real in the demo too.

The result surface stays neutral in AI mode: the accent marks the input's rerouted Enter, not the output.

**Provider, grounding and the off switch** ([[B13]] aiInScope). The provider is Anthropic (`aiService.ts`). The model's grounding is generated from `nodeCatalog.ts` and the live node classes (`aiGrounding.ts`), never hand-written ([[C8]] declareOnce). It is built once per session, so the system prompt stays byte-identical across turns and the provider's prompt cache hits. The assistant ships switched off through `AI_ENABLED` in `aiKey.ts`; off, the sparkle, the Settings section and the What's New slide all hide, and turning the flag on restores the whole surface.
