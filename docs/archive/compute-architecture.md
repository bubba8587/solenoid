# Solenoid — Compute Architecture

Scoping notes. No build commitment yet. How the calculation work is planned to split
between the web browser version and the desktop version, and where the heavy math runs.

## Two versions, on purpose

The plan is two versions of Solenoid, and the line between them is also the line between
"light math" and "heavy math."

- **Browser version: a live, free demo.** What we have now, the relatively light stuff that
  runs fine in plain web code, gets forked into a version that stays live in the browser.
  No install. Anyone can open it and play. This is the front door.
- **Desktop version: the real tool.** When you want to switch on the heavier add-on Packs,
  that is the moment you get nudged to download the desktop app.

The honest reason to download is the native compute. Nothing else. A browser can technically
do real file handling these days, so we should not pretend that is what you are downloading
for, and we should not cripple saving just to manufacture a reason to switch. The reason to
switch is that you hit something the browser genuinely cannot do fast. That is enough on its
own.

If anything, the browser version should be kept deliberately thin, and maybe trimmed further
than the technical line strictly requires. Not to punish the demo, but to keep the line
between "demo" and "the real thing" crisp and obvious. The risk with a capable browser version
is that it quietly creeps toward good-enough, the desktop download stops feeling worth it, and
the whole funnel goes soft. Better to make the browser clearly a taste of the thing, with the
real tool plainly on the other side of the download.

The browser version never tries to do the heavy native math. That is a firm rule, not a
"we will get to it later." The browser is the demo and the funnel. The desktop is where the
serious computation lives. This also matches the product positioning in the competitive doc:
a personal tool that lives on your own machine.

So the split below is not just a technical detail. It is the difference between the free
thing in the browser and the thing you download.

## Light math vs heavy math

Some things have to stay in the browser-style web code no matter what, because that is where
the screen and the graph live:

- The canvas, the graph itself, and the logic that re-runs a calculation when an input
  changes.
- Drawing everything on screen.
- The light math: ordinary arithmetic, comparisons, simple list work. Fast enough in plain
  web code, not worth sending anywhere else.

Some things are planned to run as fast compiled code on the desktop instead (Rust is the
likely choice, but it does not have to be):

- Heavy number-crunching: large tables and matrices, signal processing, that kind of thing.
- Simulations and anything that loops a huge number of times.
- The solver and sweep features (described in the backlog and dev notes): trying thousands
  of possibilities to hit a target or to map out a range of outcomes.
- The science and engineering reference libraries (steam tables and the like).

The browser version simply does not include this second list. If a graph needs it, that is a
desktop graph.

## The thing to be careful about: do not chat across the border too much

On the desktop, the screen part of the app and the fast-compiled part are two separate pieces
that have to pass messages back and forth. Every message across that border has a small fixed
cost. One big message is cheap. Ten thousand tiny ones are not, and the cost of all that
back-and-forth can wipe out the speed you gained by going to compiled code in the first place.

So the calculation engine cannot ask the fast side to compute one node at a time, one message
each. The right approach is to work out the whole chain of nodes that needs recalculating
(the engine already figures this out), then hand that whole chain over in a single message and
let the fast side run all of it at once. The light nodes still calculate on the spot in web
code, because sending a message across the border just to add two numbers is slower than just
adding them.

## The solver and sweep features are the main reason to go native

This is where compiled code earns its place. Things like Monte Carlo (run the same model
thousands of times with random inputs and look at the spread of results), Goal Seek (nudge an
input until an output hits a target), and Data Tables (sweep an input across a range and
tabulate the results) all do the same thing: run a chunk of the graph over and over, a huge
number of times. That is exactly the work that is painfully slow in plain web code and fast in
compiled code.

The clean way to build it is to hand that chunk of the graph to the fast side once, and let it
do all the repeats over there in one go, without messaging back and forth on every single
repeat. Designing this as a native feature from the start, rather than building it in web code
and trying to move it later, is the single most valuable decision in the engine plan.

## Reuse existing libraries, do not reinvent

A real advantage of going native: a lot of the hard math already exists as ready-made
libraries we can just use. Steam and water properties, refrigerants, linear algebra, signal
processing, and optimization all have mature, well-tested implementations available. We bind
to those rather than rebuilding them ourselves. The steam tables, for example, already have
solid existing implementations, so that pack is mostly wiring up something that exists, not
writing physics from scratch. This takes a big bite out of the "this is ambitious" worry.

## Passing big tables across the border

When a large table or matrix has to cross from one side to the other, doing it as plain text
is the slow way. There is a compact way to send raw data instead, and the engine should assume
that compact path from the start rather than building everything the slow way and trying to fix
it later. This mostly matters for the matrix and table packs.

## Where the fast code could live (decide later)

Three options, lightest to heaviest, only relevant once this work actually starts:

- **Inside the browser page, as sandboxed compiled code.** No border to cross, near-native
  speed, and it cannot touch your files (which is safe but also limiting). Good for a middle
  tier, but it cannot easily use the big existing C and C++ libraries, and it is capped on
  memory. Note: this is the only one of the three that could ever run in the browser version,
  and even then only for medium-weight work, never the heaviest.
- **As part of the desktop app, talking over the message border.** Full speed, can use any
  existing library, but you pay the messaging cost and you have to build a version for each
  operating system. This is the natural home for the heavy desktop packs.
- **As a separate helper program the app launches.** The heaviest option, but it keeps a crash
  in the math from taking down the whole app, and it is the natural fit if part of the engine
  is ever written in something other than Rust.

First-party packs do not force a choice here. A future add-on store made by other people would,
and that case lands on the sandboxed in-page option for safety reasons. See
[pack-architecture.md](pack-architecture.md) for the add-on store discussion.
