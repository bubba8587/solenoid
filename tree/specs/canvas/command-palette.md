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
- **Canvas operations with no menu home:** Isolate selection (I) and Expand or collapse groups (E), which the palette fires as synthetic keydowns so the canvas's own keyboard handler runs them.
- **Selection layout:** the six aligns, whose labels name the end effect ("Align center (vertical)" runs `center-h` and stacks nodes in a column), the two distributes, and Collapse and Expand selection.
- **Settings:** every boolean and text setting in `SETTINGS_SCHEMA` as a "Toggle <label>" item that shows on or off. Folder and segment fields are left out, and so, on mobile, are fields marked `disabledOnMobile`, since a palette that could flip a setting greyed out on this device would be a back door around that gate.
- **Never node types:** the Add menu is the one place to browse the catalog.

## Searching and running

- With an empty query the palette shows 8 previews, led by up to 3 recently run commands (`commandRecents`, recorded by label and marked "recent"). A docked bar shows nothing until it is focused.
- A query scores command and toggle labels with `fieldScore` and shows the best 20.
- Nothing is selected until the user types; then the top result is. A blind Enter never runs an action the user did not pick.
- Running an item records it as recent, then closes the modal, or clears and refocuses a docked bar.
- Escape closes the modal, or clears and blurs the bar.
- The modal takes focus when it opens. The docked bar never takes focus on mount; the palette hotkey (the `paletteStore` flag) means "focus the bar" instead.

## AI mode

When an AI key is connected, a sparkle button switches the palette to AI mode ([[C55]] aiWholeDocRewrite). The mode is local to one palette session, so a reopened modal comes back in command mode, and it drops back to command mode when the key is cleared.

1. There is no result list. Enter sends the prompt with the document's text form, one turn at a time.
2. The reply is an answer, an error, or an edit. An edit shows as a line diff with any warnings, plus Cancel and Apply; an empty diff reads "The document already matches that request."
3. Apply loads the rewritten text form through `loadGraph`, the same path a file open takes, then animates in only the nodes the edit added (`revealAddedNodes`). A failed load reports "The rewrite failed to load. The document is unchanged."
4. Escape first dismisses a shown result, then the palette.

The result surface stays neutral in AI mode: the accent marks the input's rerouted Enter, not the output.
