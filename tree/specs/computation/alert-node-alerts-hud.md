---
aliases: ["Alert node + Alerts HUD"]
tags: [spec, computation]
---
<!-- [[C39]] effectsEdgeTriggered -->

# Spec: Alert node + Alerts HUD

Serves [[C39]] effectsEdgeTriggered. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The **Alert** card watches a value and raises a notification when a condition is met. Each firing lands in two places: a toast, and the Alerts section of the HUD, the column of floating panels on the right edge of the screen. The card lives in `nodes/display.ts` (`AlertNode`) and `components/AlertNode.tsx`; the log is `alertStore.ts`; the column is `components/HudStack.tsx`.

## Modes

The trigger dropdown picks both the condition and which input sockets are live. It is an argument, not an op, and persists as **`condition`** ([[C26]] opArgDistinct). `ALERT_MODE_KEYS` maps each mode to its live sockets:

| Mode (`condition`) | Dropdown label | Live sockets | Triggered when |
|---|---|---|---|
| `range` (default) | Out of range | `value`, `low`, `high` | `value` is below `low` or above `high` |
| `equals` | Equals | `value`, `target` | `value` exactly equals `target`; the `target` socket is labeled "Match" |
| `boolean` | Is true | `value` | `value` is a real `true` or exactly `1`; any other nonzero number is not true, because logicals are first-class and bridge to numbers only as 1 and 0 |
| `text` | Text contains | `text`, `match` | `text` contains `match`; an empty `match` never triggers |

The card carries the full set of sockets at all times, and the component shows only the active mode's keys. On a mode change the component first drops the cables on sockets the new mode hides, through `dropInputCables` ([[D10]] onePrunePath), and then sets the mode.

An unwired socket falls back to the card's typed literal (defaults: `value` 50, `low` 0, `high` 100, `target` 0, `text` and `match` empty). A wired socket always wins, even when its cable carries a blank ([[D33]] unwiredNotBlank).

## The status output

The `result` socket (labeled "Status") emits a number:

- `0` when calm;
- in `range` mode, `1` below Low and `2` above High;
- in every other mode, `1` when triggered;
- null when a needed input is missing, which means the status is unknown.

A list input yields a list of statuses, one per element. A per-cell error or blank rides through as a non-alerting cell.

The card's value box shows a neutral dot and word, never a pass or fail mark, because an Alert watches and notifies rather than judging. Calm reads "in range", "no match", "false" or "no match" by mode; met reads "below" or "above", "equal", "true" or "match". A list reads "all clear" or "some out". The met color is the theme's amber accent; calm is `--text-dim`.

## When it fires

An Alert fires on a change of status, not on a boolean flip ([[C39]] effectsEdgeTriggered):

1. A null status is unknown. It neither fires nor changes the remembered status.
2. Otherwise the card builds a status key (`statusKey`: the number, or the list joined with commas) and compares it with the key it remembered from the last run (`lastStatusKey`).
3. If the mode changed since the last run, the comparison is against `NO_STATUS` instead, since the old mode's status means nothing in the new one.
4. The new key becomes the remembered one.
5. While the graph is rebuilding (`isGraphRebuilding()`), nothing fires, so loading a document or a seed does not replay old alerts. The recompute that follows a rebuild still runs inside the rebuild scope.
6. Otherwise the card fires when the status is alerting (any nonzero cell) and its key differs from the previous one.

So in `range` mode, calm to LOW, calm to HIGH and LOW to HIGH (either way) all fire; LOW to LOW and HIGH to HIGH do not; returning to calm is silent. `lastStatusKey` starts at `NO_STATUS`, a sentinel that matches no real key, so a card born alerting, or switched into a condition that is already met, fires once.

## Firing

`fireAlert(...)` in `alertStore.ts` is the single entry point. It does two things:

- it logs an event (`id`, `nodeId`, `label`, `kind`, `message`, `time`) to `alertStore`, newest first, capped at 50 events. The log is transient and never saved.
- it raises a toast through `pushNotice` (`noticeStore`), with the tone mapped from the kind: `info` to info, `warning` to warn, `critical` to error. The Alert card always fires `warning`.

The message is a neutral observation prefixed with the card's label (or "Alert" when the label is blank):

- range, one value: "Tank: 150 above 100" or "Tank: 3 below 10"; a list: "Tank: 2 below 10, 1 above 100";
- equals: "Tank: equals 7";
- boolean: "Tank: is true";
- text: `Log: contains "error"`.

Numbers print as integers or rounded to three decimals.

`alertStore` registers `forget` and `forgetAll` with the node-store registry ([[C40]] storesRegisterForget): deleting an Alert card removes its events, and a whole-graph rebuild clears the log. Each event in the HUD has its own dismiss button (`alertStore.dismiss`).

## The HUD column

`HudStack` is one portal into `document.body` that owns the fixed position of the right-side column. It stacks four sections, top to bottom:

1. `PinLayer`, the pinned values;
2. `AlertLayer`, the fired alerts;
3. `ProblemsPanel`;
4. `CommentsPanel`.

Each section renders nothing when empty, so the column is invisible until used, and each section's button lands below whatever sits above it however many entries there are. Positioning lives in `hudStack.css`:

- `top: calc(var(--chrome-top, 66px) + 58px)`, below the nav pill (124px with the default chrome), and `right: 12px`;
- a column with a 10px gap, right-aligned, at most 260px wide, with `pointer-events: none` so clicks in the gaps reach the canvas (chips and buttons turn pointer events back on);
- on mobile, `top: calc(136px + env(safe-area-inset-top))` so it stays below the Fit/Lock pill, and a width of at most `min(260px, 100vw - 24px)`;
- a docked Report shifts `right` by the dock width (`ReportOverlay.css`); a docked Inspector does the same on desktop (`InspectorPanel.css`) and hides the column on mobile;
- presenter mode hides the column (`PresentationOverlay.css`).

The column is not a generic panel API. Each section is its own component with its own state, its own trigger button and its own `registerChrome` call. A new panel is a new component added as a sibling inside `HudStack`, not a plug-in to a shared base.
