---
aliases: ["Outline panel"]
tags: [spec, canvas]
---
<!-- [[D64]] oneSizeRead, [[C52]] visibleSelection -->

# Spec: Outline panel

Serves [[D64]] oneSizeRead (focusing a node) and follows [[C52]] visibleSelection. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The Outline, called the Navigator on screen, is the left-docked list of every node on the main canvas, mirroring group membership and collapse state. Format Controllers are left out entirely. The code is `OutlinePanel.tsx`.

## The list

- **Unfiltered, it is a tree:** top-level nodes, and under each expanded group its members, indented 14 px per level.
- **A search query or a filter chip switches to a flat list.** A query matches the display name and the catalog name (`nodeName`, the same string the card's hover hint shows).
- **The filter chips are Inputs and Displays.** A node is an input when it is a source by either measure: it has no input sockets but has an output, so it counts before it is wired; or nothing is wired into it while its output is wired onward, which stops being true the moment an input is wired.
- **Sorting** is Position (the default) or Alphabetical, remembered under `solenoid.navSort`. Position reads top to bottom in row bands of 120 world units, then left to right; the band is deliberately generous so the order doesn't react to small vertical jitter. Alphabetical compares display names numerically and ignoring case.
- **A group row reads as a container:** its own color as a 24% tint fill inside a full 1 px border at 55%, never an accent stripe.

## Keeping current

While open, the panel polls the graph every 300 ms and re-renders only when an order-sensitive signature of its rows changes, so a Position re-sort caused by a moved node shows within one poll. The per-row connection lists subscribe to `connectionVersionStore`, because the signature ignores connections.

## Acting on rows

- A plain click on a row does nothing, to avoid jumpy recentering.
- A double click selects the node and pans it to the center (`focusNode`, also the Command Palette's jump-to-node). It sizes through `measuredBox` ([[D64]] oneSizeRead), so a collapsed group centers on its visible box.
- Ctrl or Cmd click and Shift click add to the selection or select a range without recentering; on a touch device in select mode a tap accumulates too.
- On mobile a plain tap selects and jumps, since there is no double click.
- Ctrl or Cmd+F, without Shift, opens the panel and focuses its search, except under a modal (`keyUnderModal`), where the search would open behind it and take its focus.
- The header's collapse-all button toggles every group through `setGroupsCollapsed`, so the neighbor push and expand sweep apply. Its glyph shows the action: converging to collapse, diverging to expand.

## Layout

While open, the panel sets `body.solenoid-nav-open`, so bottom-left popups shift right past it. Its place among the bars is in [[layout-chrome]].
