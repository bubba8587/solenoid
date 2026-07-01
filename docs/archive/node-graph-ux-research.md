# Solenoid — Node Graph UX Research

What people love and hate about node-based software, synthesized from user feedback, forums, and design discussions across the major tools. Organized by theme rather than by tool, since the same problems and wins appear across all of them.

---

## The tools surveyed
- **Blender** (shader, geometry, and compositor node editors)
- **Houdini** (SideFX - procedural 3D, widely considered the gold standard for node graph design)
- **Nuke** (Foundry - compositing, vertical graph orientation)
- **TouchDesigner** (Derivative - realtime visuals, very similar philosophy to Solenoid)
- **Unreal Engine Blueprints** (visual scripting)
- **n8n** (workflow automation, most direct node graph competitor)
- **Max/MSP and Pure Data** (audio/visual programming, oldest lineage)

---

## What people universally love

### The composability feeling
Across all tools, the thing users describe most positively is the feeling of "snapping things together." When a connection clicks into place and the output updates instantly, it feels like thinking made visible. This is the core emotional loop that makes node graphs compelling and it's almost impossible to replicate in a spreadsheet or code editor.

### Non-destructive exploration
Houdini in particular is praised for letting you branch off and try something without destroying what you had. You can wire a test path off an existing node, see what happens, and delete it if it doesn't work. This exploratory quality is highly valued - users describe it as "thinking out loud in the graph."

### Seeing data flow
When nodes preview their output inline (Houdini, Nuke, TouchDesigner all do this well), users report much less debugging time. You can see exactly where in the graph something goes wrong. The graph becomes a diagnostic tool not just an authoring tool.

### Node groups / collapsing subgraphs
Universally praised when well implemented. The ability to select a cluster of nodes, collapse them into a single named node with inputs and outputs, and reuse or share that group is the feature users reach for as graphs grow. Unreal Engine calls these "collapsed nodes," Blender calls them "node groups," Houdini calls them "subnetworks." The concept is identical and considered essential.

### Right-click context menu for adding nodes
Almost every tool does this: right-click on the canvas, type to search, press enter. It's fast, keyboard-driven, and doesn't require navigating a menu hierarchy. Users who come from tools without this (or where it's poorly implemented) cite it as a major productivity difference.

---

## What people universally hate

### Spaghetti wires
The single most common complaint across every tool. As graphs grow, wire crossings make the graph unreadable. This is so well-known it has a name. Solutions that work:
- **Reroute nodes** (Blender, Houdini): a tiny dot node you can use to route wires around other nodes, giving you control over the wire path
- **Dot nodes** (Substance Designer, some others): similar concept, sometimes with the ability to branch a wire into multiple destinations from one dot
- **Wire hiding**: the ability to hide specific wires that aren't relevant to what you're working on right now
- **Automatic layout**: some tools can auto-arrange the graph which helps but rarely produces a result as readable as a manually organized one

Solenoid implication: build reroute/dot nodes in from the start, not as an afterthought.

### Accidental connections
Moving nodes around a cluttered graph and accidentally connecting to a wire you didn't intend to is a consistent complaint. Particularly in Houdini where nodes snap to wires on drop. Users want a way to move nodes without risk of forming unintended connections.

### No inline value display
When a node doesn't show you its current output value, debugging requires either adding an explicit output node or mousing over pins. Users strongly prefer inline value display - the wire itself or the socket shows the current value when you hover or at all times.

Solenoid implication: for a data tool where the values ARE the point, showing current values inline on sockets or nodes should be a default, not a debug mode.

### Error handling is cryptic
n8n users complain about this consistently - error messages at the node level are hard to parse, and tracing which node in a large graph caused a downstream failure is tedious. Unreal Blueprints has the same problem.

Solenoid implication: when a source node fails to fetch, or a computation node receives a type mismatch, the error should be visible on the node itself with plain language, not a console log.

### Large graphs are hard to navigate
Once a graph exceeds roughly 15-20 nodes, navigating it becomes a spatial memory problem. Solutions that work well:
- **Minimap** (most tools have this) - a small overview of the entire graph in a corner
- **Bookmarks / named views** - save a particular zoom/pan state and jump back to it
- **Comment boxes / frame nodes** - colored overlay boxes that let you label regions of the graph (Blender calls these "frame nodes," Unreal calls them "comment nodes"). Highly praised, heavily used by anyone with a large graph.

Solenoid implication: comment/frame nodes and a minimap should be in Phase 1.

### No undo on connections
Several tools have incomplete undo history - you can undo node moves but not always connection changes. Infuriating when you accidentally disconnect something. Full undo/redo history including connections is table stakes.

---

## Tool-specific lessons

### Blender
**What works**: Node groups are excellent. The search-to-add menu is fast. Socket color coding by type is clear and intuitive. Default values on unconnected sockets (you can see and edit the fallback value directly on the node) is extremely well-liked.

**What doesn't**: The overall aesthetic is dense and intimidating to newcomers. Wire routing is left-to-right which some users find less natural than top-to-bottom for certain workflows. The node editor is one of many editors in a complex application so it inherits a lot of Blender's general UI complexity.

**Lesson for Solenoid**: Steal socket color coding and default-value-on-socket. Avoid the density.

### Houdini
**What works**: Widely considered the best-designed node graph of any tool. The "dot node" for wire routing is simple and powerful. Subnetworks (node groups) are very capable. The graph orientation is top-to-bottom which many users find more natural for data flow. Inline node previews are excellent.

**What doesn't**: Steep learning curve for newcomers. The tool is designed for professional VFX artists and shows.

**Lesson for Solenoid**: Top-to-bottom data flow orientation may be worth considering over left-to-right. The dot node is the right model for wire routing.

### Nuke
**What works**: Compositors who use Nuke professionally strongly prefer its top-to-bottom orientation. The graph is very clean visually. Node grouping is well implemented.

**What doesn't**: Expensive, niche, not relevant as a direct model.

**Lesson for Solenoid**: More validation that top-to-bottom is preferred by practitioners for data flow graphs.

### TouchDesigner
**What works**: Real-time output preview everywhere - every node shows its current output state as a thumbnail. This is extremely powerful for understanding what's happening in the graph at a glance. The operator family system (different colored node types for different data types) is very readable.

**What doesn't**: Steep learning curve. The operator type system (TOPs, CHOPs, SOPs, DATs, etc.) is powerful but initially confusing. Free for non-commercial but paid for commercial use.

**Lesson for Solenoid**: The "every node shows its current state" model is the gold standard for data flow visibility. For Solenoid, where nodes have scalar values and small charts, showing the current output value on the node face (not just on hover) is the right call. The operator family color coding is worth adapting.

### Unreal Engine Blueprints
**What works**: Right-click context menu is fast and well-designed. The "promote to variable" feature (right-click a socket, turn its value into a named variable you can reuse) is very useful. Collapsed nodes (node groups) work well for tidying.

**What doesn't**: Large Blueprints become very hard to read - the "Blueprint spaghetti" problem is well documented. No built-in auto-layout. The distinction between execution flow (white wires) and data flow (colored wires) is powerful but initially confusing.

**Lesson for Solenoid**: Solenoid is pure data flow with no execution flow concept (no "when does this run" wire), which actually removes a major source of Blueprints confusion. This simplification is valuable and worth preserving.

### n8n
**What works**: Clean modern UI. Good integration library. Active community.

**What doesn't**: Users consistently report that it "feels too technical when you just want to do something simple." Error messages are unclear. Complex workflows become brittle and hard to debug. The JSON-everywhere data model leaks through to the user even in the visual layer.

**Lesson for Solenoid**: The typed socket system is the right antidote to "JSON leaking through." If connections are typed and the graph only allows valid connections, users never encounter type mismatch errors at runtime. Preventing the error beats handling it.

---

## Graph orientation: left-to-right vs top-to-bottom

This is a genuine debate in the node graph community. Blender uses left-to-right. Houdini and Nuke use top-to-bottom. Max/MSP is more freeform.

The evidence slightly favors top-to-bottom for data flow graphs (as opposed to signal processing or shader graphs). The reasoning:
- Reading direction: people read top-to-bottom more naturally for "this flows from input to output"
- Screen real estate: widescreen monitors have more horizontal space, which makes left-to-right graphs run off the right edge faster, but top-to-bottom graphs run into the same problem vertically on laptops
- Source nodes naturally "feed down" into computation nodes which feed down into output nodes

React Flow supports both orientations and the direction can be set globally or per-graph. Worth deciding early and committing rather than leaving it flexible, since it affects everything about how users mentally model their graphs.

**Resolved (see `plan.md`): Solenoid commits to left-to-right.** Top-down workflows are supported via in-canvas routing tools — angled Conduit / passthrough nodes (15° increments, Solenoid's name for reroute/dot nodes) and a staircase node shape option — rather than by flipping the global orientation. This keeps source-on-left / output-on-right as a stable mental model while still letting users build vertical flows where it makes sense.

---

## Key UX features to build (prioritized)

**Must have in Phase 1:**
- Socket type system with color coding
- Default values displayed and editable on unconnected sockets
- Current output value displayed on node face (not just on hover)
- Right-click canvas to add nodes with search
- Full undo/redo including connections
- Comment/frame nodes for labeling graph regions
- Minimap
- Conduit / dot nodes for wire routing (Solenoid's name for reroute nodes)

**Should have before public release:**
- Node groups (collapse subgraph to single node)
- Clear error state on nodes with plain language messages
- Auto-layout option (even if imperfect)
- Keyboard shortcuts matching at least one well-known tool (Blender is the most likely common reference for Solenoid's audience)

**Nice to have:**
- Named bookmarks/saved views for large graphs
- Wire hiding for specific connections
- "Promote to input" equivalent - turn a hardcoded value into a named input node

---

## Round 2: Onboarding, discoverability, power user patterns, and the non-technical user problem

---

## The blank canvas problem

This is one of the most documented failure modes across all node graph tools. A new user opens the app, sees an empty canvas, and has no idea what to do. Unlike a spreadsheet (which has a familiar grid) or a word processor (which is just a page), a blank node canvas provides no affordances or starting points. Several tools handle this badly by shipping with nothing, and users report feeling lost or assuming the app is broken.

Solutions that work across different tools:

**Starter template on first launch** - ship with a pre-built example graph that demonstrates the core interaction. Not a tutorial overlay, an actual working graph they can pull apart and modify. ComfyUI does this well - it opens with a working default workflow so the user immediately sees nodes connected, values flowing, and output displayed. This is the single highest-leverage onboarding decision.

**Filtered node menu when dragging from a socket** - when you drag from an output socket and release on empty canvas, the add-node menu should pre-filter to only show nodes that accept that socket's type. Graphite (open source vector editor) raised this as a specific improvement request after observing that users drag from sockets and then get overwhelmed by a list of mostly-incompatible options. ComfyUI already does this and users cite it as a major discoverability improvement.

**Double-click canvas to add node** - the spacebar shortcut for adding nodes is well-known to power users but completely invisible to newcomers. Double-clicking empty canvas to open the add-node menu is more discoverable and is becoming a convention across newer tools.

Solenoid implication: ship with a pre-built FEC donation example graph. User opens the app and immediately sees a working example of exactly the use case it was built for. They can tear it apart and rebuild it as their own.

---

## Node discoverability and the add-node menu

How users find and add nodes is a surprisingly deep UX problem. Every tool has iterated on this extensively.

**What works:**
- Spacebar or double-click opens a searchable list, ranked by relevance or recent use
- When a socket is selected, the list pre-filters to compatible types only
- Nodes are categorized visually (color coding, icons, groupings) not just listed alphabetically
- Favorites or recently used nodes surface at the top

**What doesn't:**
- Flat alphabetical lists of all nodes with no categorization (early ComfyUI had this problem)
- Menu hierarchies that require navigating multiple levels to find a node
- No search - requiring users to browse visually through dozens of options

ComfyUI's community specifically raised the need for icons on nodes to aid recognition at a glance rather than requiring users to read every node name. This is especially relevant for Solenoid where the node set is small and well-defined - each node type could have a distinct icon that makes it immediately recognizable.

Substance Designer's approach is worth noting: Spacebar opens the node menu, and if you have an existing node or link selected, the menu automatically filters to only show compatible nodes. This context-sensitivity significantly reduces the cognitive load of building a graph.

---

## ComfyUI as a case study

ComfyUI (the AI image generation node graph) has become one of the most widely used node graph tools outside of professional 3D/VFX, and is relevant because its user base skews non-technical - artists and creators, not engineers. This makes it the closest analogue to Solenoid's intended audience.

**What the ComfyUI community loves:**
- Workflows are JSON files you can share by sending a single file - exact same model as Solenoid's graph sharing approach, and users love it
- Partial execution - only re-runs nodes that have changed between runs, not the whole graph. Highly praised for speed
- The custom node ecosystem (2000+ community nodes installable in one click) - though this is scope far beyond Solenoid v1
- Being able to see exactly where in the pipeline something went wrong

**What ComfyUI users consistently complain about:**
- Intimidating for beginners - "dense web of text" is a common description
- No icons on nodes, everything is text labels, hard to visually distinguish node types at a glance
- Version and dependency management when installing custom nodes is a nightmare (not relevant for Solenoid)
- The default graph that ships with it is functional but not well-explained - users want guided examples not just a working graph

**Key lesson for Solenoid:** ComfyUI proves that a non-technical audience will embrace a node graph if the entry point is low enough and the payoff is immediate. The gap between "intimidating" and "clicks for the first time" is mostly about the first 60 seconds of the experience.

---

## Power user keyboard shortcuts - cross-tool conventions

After surveying Blender, Substance Designer, Node-RED, Mari (Foundry), and several workflow automation tools, a set of conventions emerges that experienced node graph users expect by muscle memory:

**Nearly universal:**
- `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` - undo/redo
- `Ctrl/Cmd + C/V` - copy/paste nodes
- `Ctrl/Cmd + D` or `Shift + D` - duplicate selected
- `Delete` / `Backspace` - delete selected
- `Ctrl/Cmd + A` - select all
- Mouse wheel - zoom
- Middle mouse drag - pan canvas
- `F` - fit selected nodes to view
- `A` - fit entire graph to view

**Common but not universal:**
- `Spacebar` or double-click - open add node menu
- `Ctrl + X` (Blender) / `Delete and relink` - delete node but keep connections intact (very useful, under-implemented)
- `H` (Blender) - collapse/hide node inputs
- Arrow keys - navigate between connected nodes
- `Ctrl + G` - group selected nodes into a node group

**Substance Designer specific (worth stealing):**
- `Delete` breaks connections; `Backspace` deletes and relinks - the distinction between these two delete behaviors is highly praised by power users

**Node-RED specific (worth stealing):**
- `Ctrl + Delete` - delete node and reconnect upstream/downstream automatically. This is the same as Substance Designer's "delete and relink" and is repeatedly praised across tools. When you remove a node from the middle of a chain, you almost always want the chain to stay connected.

Solenoid implication: implement "delete and relink" as the default delete behavior, not just "delete and break." Breaking a chain silently is one of the most frustrating experiences in node graph tools.

---

## The "too technical" trap and how to avoid it

n8n users, ComfyUI beginners, and Blender newcomers all describe the same experience: the tool feels too technical even when doing simple things. The root causes are consistent across tools:

**Type leakage** - when the underlying data type system becomes visible to the user (n8n's JSON everywhere, type mismatch error messages with technical jargon). Fix: hide types behind color coding and plain-language connection validation messages.

**Too many nodes at once** - presenting 50+ node options to a new user causes decision paralysis. Fix: start with the minimum viable node set (Solenoid has this by design) and let the library grow.

**No inline values** - when you can't see what's flowing through the graph, building it feels like writing code blindfolded. Fix: always show current output values on nodes.

**Unclear errors** - "type mismatch on input 2" means nothing to a non-technical user. Fix: "this node expects a number but is receiving a percentage - add a conversion node" is the right error message pattern.

**Spatial disorientation** - large graphs without landmarks feel like a maze. Fix: comment/frame nodes, minimap, named bookmarks.

The Medium article synthesized it well: node graphs occupy a sweet spot between traditional GUIs (too limited) and code (too technical). The tools that fail are the ones that slide back toward "too technical" as complexity grows. Keeping Solenoid's node set intentionally small and well-typed is the main defense against this.

---

## Partial execution - a significant performance pattern

ComfyUI's partial execution feature (only re-runs nodes that have changed, not the whole graph) is worth flagging for Solenoid's graph execution engine design. For a data graph polling live sources, the equivalent would be: only re-evaluate nodes downstream of a source that just updated, not the entire graph on every poll cycle.

This is relevant to the Rust execution engine design - building the evaluator to be aware of which nodes have "dirty" inputs (new data) vs which are unchanged would make the graph feel snappy even as it grows in complexity.

---

## Summary additions to the Phase 1 priority list

Based on this round of research, these should be added or elevated:

**Elevate to must-have:**
- Ship with a working example graph (FEC donation example) - this is the single most impactful onboarding decision
- Double-click canvas to open add-node menu (more discoverable than spacebar alone)
- "Delete and relink" as a distinct delete behavior from "delete and break"
- Filtered add-node menu when dragging from a socket (show only compatible types)

**Add to should-have:**
- Icons on each node type for visual recognition at a glance
- Partial graph execution in the Rust engine (only re-evaluate dirty subgraphs)
- Named graph bookmarks for navigation in larger graphs
- Customizable keyboard shortcuts (users expect this, gets asked for in every tool)

---

## Rounds 3-5: Wire routing deep dive, bypass/mute, visual design, copy/paste, performance, and Houdini as gold standard

---

## Wire routing: the full picture

Spaghetti wires are the most universal complaint in node graph software, and the community has developed a layered toolkit of solutions. Every tool that's been around long enough has iterated on this. Here's the complete picture:

**Layer 1: Reroute nodes**
A tiny invisible node you insert along a wire to bend its path. Double-clicking a wire to insert a reroute inline (Unreal Engine's method) is considered the most ergonomic approach. You can then drag the reroute point to route the wire cleanly around other nodes. Universally praised when implemented well. The Unreal community specifically notes that `Ctrl + double-click` on a wire to add a reroute node is a power-user essential.

**Layer 2: Named reroute nodes / portals**
The next level above plain reroute nodes. You name a reroute node (e.g. "Total Donations"), and then place any number of receiver nodes anywhere in the graph that reference the same name. The wire between them is hidden entirely - data flows "wirelessly" through the graph. Unreal Engine introduced this in UE4.27 and it was immediately hailed as a major quality-of-life improvement. Substance Designer calls these "portal dot nodes." The pattern is identical: transmitter node + receiver node(s) with a shared name, zero visible wire.

This is particularly powerful for values that feed into many different places in a graph - instead of a single wire fan-out to 8 destinations creating a spider web, you have one named transmitter and 8 tiny named receivers sitting right next to each consumer node.

**Solenoid implication**: Named portals are extremely relevant here. A source node (e.g. "Total Donations Raised") might feed into multiple computation nodes - a ratio node, an average node, a display node, a threshold alert node. Without portals this becomes spaghetti almost immediately. Build portal support in from the start, not as a later addition.

**Layer 3: Comment/frame nodes with color coding**
Colored labeled boxes that visually group related nodes. Users use these to divide the graph into labeled regions ("My budget inputs", "FEC data feeds", "Output displays"). Moving a frame node moves all contained nodes with it. The Houdini community specifically recommends numbered labels (step 1, step 2, step 3) along the top to create a readable left-to-right or top-to-bottom narrative flow that anyone can follow without already knowing what the graph does.

**Layer 4: Wire style options**
Some tools offer straight orthogonal wires (90-degree angles, circuit board style) vs. bezier curves. The community is genuinely divided. Orthogonal wires ("Electronic Nodes" plugin for Unreal) look cleaner in many graphs but require wider node spacing to work well. Bezier curves are more flexible but create the classic spaghetti look when crossing. The consensus is that orthogonal works better for data flow graphs (left-to-right or top-to-bottom) and bezier works better for free-form canvas layouts. Since Solenoid is a data flow graph, orthogonal wires are worth strongly considering as the default.

**Layer 5: Auto-layout**
Press a key (`L` in Houdini, `Ctrl+L` in Dynamo) to automatically rearrange the graph into a clean layout. Users describe this as useful but never perfect - it reorganizes the whole graph without respecting the semantic groupings you've set up manually. Best thought of as a starting point after initial graph construction, not something to rely on for ongoing maintenance.

---

## Bypass/mute: the overlooked essential

This feature appears in every mature node graph tool and is consistently requested in those that don't have it. The concept: temporarily disable a node so it passes its input straight through to its output (bypass mode), or blocks entirely (mute mode), without deleting it or rewiring the graph.

**Why it matters:**
- Before/after comparison: mute a node to instantly see the graph output without it
- Performance during editing: disable expensive nodes while working on other parts of the graph
- Debugging: isolate which node is causing unexpected output
- Non-destructive experimentation: try removing a node from the chain without committing to the deletion

**Implementation across tools:**
- Blender: `M` key toggles mute, muted nodes shown with a visual indicator (dashed outline or greyed out)
- DaVinci Resolve: `Cmd+D` toggles individual node, `Opt+D` bypasses ALL nodes at once (extremely useful for before/after)
- Houdini: dedicated bypass button directly on every node's UI (one of four small buttons on the node face), no shortcut needed
- n8n/Flowise: widely requested, under-implemented, causing real user frustration when debugging complex flows

**The distinction between bypass and mute:**
- **Bypass**: node is skipped, input passes through to output unchanged. Graph stays connected.
- **Mute**: node blocks data flow entirely, downstream nodes receive nothing or a null value.

Bypass is almost always what users want. Mute is occasionally useful for testing "what if this data didn't exist" scenarios.

**Solenoid implication**: Node bypass is essential for a data flow tool where users will want to experiment with and without specific computation nodes. The Houdini approach of a persistent small bypass button directly on the node face (no shortcut needed) is the most accessible implementation. Keyboard shortcut (`M` or similar) for power users on top of that.

---

## Houdini's node UI as the gold standard: specific details

Multiple forum discussions across Fusion, Blender, and VFX communities explicitly cite Houdini's Network Editor as the best node graph UX. One experienced user summarized: "I have used several node-based applications over many, many years, and Houdini's Network Editor is hands-down the finest node experience out there, by a long shot. I'm not talking about how visually pleasing they are, but how many usability features they offer that can make dealing with complex networks a lot easier."

**Specifically what Houdini does that others don't:**

Four dedicated buttons on every node face (visible at all times, no hover required):
1. Bypass toggle
2. Lock (prevents parameter changes)
3. Template (marks node for display without making it the active output)
4. Display/render flag (which node's output you're previewing)

These make the most common operations on a node accessible without any menu navigation or shortcut memory. The buttons are small and unobtrusive but always there.

**Shift + click to move upstream/downstream nodes together**: if you select a node and shift-drag, all nodes connected above it move with it. Ctrl+drag moves all nodes below. This makes graph reorganization far less painful than selecting and moving individual nodes.

**`L` for auto-layout, `A` for "align in direction"**: Houdini's align tool lets you click and drag in any direction to align selected nodes along that axis. More nuanced than full auto-layout.

**Network boxes**: Houdini's equivalent of comment/frame nodes, but they also serve as proper containers for subnetworks. Color-coded, named, moveable with contents.

**Sticky notes**: free-form text annotations separate from network boxes, for leaving notes to yourself or teammates inside the graph.

---

## Copy, paste, and cross-graph sharing

This is a more nuanced area than it initially appears.

**Within a graph:**
Copy/paste of nodes with `Ctrl+C/V` is universal and expected. The key subtlety is what happens to connections: a pasted node should preserve its internal configuration (values, labels) but typically not its external connections (since the connected nodes aren't in the clipboard). Most tools handle this correctly.

**Duplicate (`Ctrl+D` or `Shift+D`)**: creates a copy of the selected node(s) in place, with a small offset. Faster than copy/paste for quick iteration on a single node. Universally expected.

**Across graphs:**
ComfyUI users specifically complain that you can copy a subgraph within one workflow but cannot copy-paste it into a different workflow file. This is a real pain point for reusing patterns across graphs. The JSON file sharing model partially addresses this (share the whole graph) but doesn't solve the "I just want this cluster of 6 nodes from my other graph" case.

**Linked clones**: a feature request appearing in ComfyUI and other tools. Create a linked copy of a subgraph - when you change a parameter in the original, all linked copies update. This is essentially the spreadsheet's "shared formula" concept applied to node graphs. Not implemented anywhere cleanly yet, but heavily requested.

**Solenoid implication**: since graph state is a JSON file, copy/paste between graphs can be implemented as "open both graphs, copy nodes from one, paste into the other" fairly naturally. The linked clone concept is worth noting for later - if users have a recurring "FEC candidate comparison" pattern they use in multiple graphs, being able to maintain one canonical version is genuinely useful.

---

## Visual design: dark themes, color systems, and density

**Dark theme is the default for every professional node graph tool.** Blender, Houdini, Nuke, TouchDesigner, Unreal Engine Blueprints, ComfyUI - all default to dark. The practical reason is that node graphs involve a lot of screen time and the dark background reduces visual fatigue during long sessions. There's also an aesthetic expectation in the professional tools community that "serious" tools are dark.

The Blender developer forums include ongoing discussions about making socket and wire colors (called "noodle colors" in Blender's terminology) themeable rather than hard-coded. Users want full color customization but this is rarely implemented properly.

**Socket color coding conventions across tools:**
Different tools use different colors but the principle is universal - socket type determines color, and this is the primary visual affordance that teaches users the type system without documentation.

Blender's conventions as reference:
- Gray: general/any type
- Yellow: number/float
- Green: vector
- Purple: RGBA color
- Blue-gray: geometry
- Orange: shader

The specific colors matter less than consistency and distinctiveness. For Solenoid's small type set (number, percentage, weighted-list) three clearly distinguishable colors is all that's needed.

**Node density and information vs. whitespace:**
Houdini nodes are criticized for being too information-dense - same color for all nodes, text labels only, the distinguishing icon is small. ComfyUI community specifically requested icons on nodes to aid recognition at a glance. The opposite failure is nodes that are too minimal and don't show enough context.

The ideal is probably "a distinct icon + a short label + the current output value" as the standard node face. That's enough to understand what a node is and what it's currently doing without opening it or hovering.

**Node sizing:**
Fixed-size nodes are simpler but limit how much information you can show. Resizable nodes (like React Flow supports) let users expand complex nodes to show more detail and collapse simple ones to save space. Blender has a collapse shortcut (`H`) that hides the node's sockets and shows only the label - useful for cleaning up sections of the graph you understand well.

---

## Undo/redo: more complex than it looks

Proper undo/redo in a node graph needs to cover more than just node positions:
- Node addition/deletion
- Connection creation/deletion  
- Parameter value changes
- Node moves/repositions
- Node group creation/dissolution
- Comment/frame creation and editing

Several tools have partial undo where some of these operations are included and others aren't. Incomplete undo is consistently reported as more frustrating than no undo at all, because users rely on it and then discover it doesn't cover a specific action.

The cleanest implementation uses an immutable state model - each action creates a new state snapshot, and undo/redo navigates the snapshot history. This is expensive in memory for very large graphs but is the only approach that guarantees complete coverage. React Flow's state management with Zustand or similar is a natural fit for this pattern.

**React Flow specific note**: React Flow does not handle undo/redo natively. It must be implemented on top of its state model. This is a known gap that developers building on React Flow regularly have to address. Libraries like `use-undoable` or custom history stacks are the typical solutions.

---

## Performance: React Flow specifics

React Flow handles graphs of hundreds to thousands of nodes without issues using its built-in virtualization (`onlyRenderVisibleElements` prop). The main performance pitfalls are:

- **Unnecessary re-renders**: custom node components must be wrapped in `React.memo` or declared outside the parent component to prevent new component references on every render
- **Memoize everything passed as props**: `useCallback` for functions, `useMemo` for arrays and objects like `defaultEdgeOptions` - React Flow is sensitive to reference equality
- **Complex CSS on nodes**: animations, shadows, and gradients on node components have an outsized performance impact compared to simpler styles. Keep node styles lean.
- **State management at scale**: as graphs grow, putting all node/edge state in a single React state object causes whole-graph re-renders on any change. Zustand or similar external state managers that enable fine-grained subscriptions are the correct architecture for non-trivial graphs.

For Solenoid specifically, where graphs are expected to be moderate in size (10-30 nodes typical, maybe 50-100 for power users), these concerns are manageable but worth designing around from the start rather than retrofitting.

---

## Node-RED as a data flow inspiration

Node-RED is worth specific attention because it's the closest existing tool to Solenoid's intended purpose - it's a data flow tool for connecting inputs to outputs, running locally, with a node-based graph UI. It's just aimed at IoT/automation rather than personal financial reasoning.

**What Node-RED does well:**
- Status indicators directly on nodes: each node shows a small colored dot and status message below it (e.g. "connected", "error", "4 msgs/sec"). This is a lightweight way to show node health and activity without opening the node.
- Deployment model: you build the graph then "deploy" it, which starts the live execution. The separation between "editing mode" and "running mode" is clear.
- The community has built inline chart preview nodes (`node-red-contrib-data-view`) that render a small sparkline directly inside the node face in the editor - exactly the pattern Solenoid's sparkline output nodes should follow.

**What Node-RED does badly:**
- No typed socket system - all data is JavaScript objects, type errors surface at runtime not at connection time
- The graph becomes very hard to read as flows grow
- Error messages are technical and unhelpful to non-developers
- No inline value display on wires or nodes by default - you have to add debug nodes explicitly

**Key lesson**: Node-RED's status indicator pattern (small colored dot + text below the node) is a lightweight and clean way to show node state without cluttering the node face. For Solenoid this translates to: each source node should show "updated 2h ago" or "fetch error" directly below the node label at all times, not just on hover.

---

## Summary: complete feature priority list (all rounds)

### Must have in Phase 1
- Socket type system with color coding (3 colors: number, percentage, weighted-list)
- Default values displayed and editable on unconnected sockets
- Current output value displayed on node face (not just on hover)
- Status indicator below source nodes ("updated X ago" / "error")
- Right-click canvas OR double-click canvas to add nodes with search
- Filtered add-node menu when dragging from a typed socket
- Full undo/redo including connections (immutable state model recommended)
- Comment/frame nodes with colors and labels
- Minimap
- Conduit nodes (Solenoid's reroute/dot nodes — double-click a wire to insert inline)
- Bypass toggle on each node (persistent button on node face, not just keyboard shortcut)
- "Delete and relink" as distinct from "delete and break"
- Dark theme default
- Ship with a working example graph (FEC donation use case)

### Should have before public release
- Named portals / wireless named Conduits
- Node groups (collapse subgraph to single named node)
- Auto-layout (`L` key)
- Icons on node types for visual recognition
- Node collapse/expand (`H` key equivalent)
- Clear error state on nodes with plain language messages
- Orthogonal wire style option
- Keyboard shortcuts reference panel discoverable in app
- Customizable keyboard shortcuts
- Partial graph execution in Rust engine (dirty-input tracking)

### Nice to have / Phase 3+
- Named graph bookmarks for navigation
- Wire hiding for specific connections
- Linked clone node groups
- Cross-graph copy/paste of node clusters
- Node-level bypass-all keyboard shortcut (bypass entire graph for before/after comparison)
- Align-in-direction tool (Houdini `A` key equivalent)
- Sticky notes (free-form text annotations separate from frame nodes)

---

## Rounds 6-9: React Flow gotchas, trackpad/input handling, color accessibility, error UX, and the limits of node graphs

---

## React Flow: production gotchas and known rough edges

React Flow is the right choice but it has specific failure modes worth knowing before building, not discovering mid-project.

### Edge routing is the hardest unsolved problem

React Flow's default edges take the shortest path between two nodes. In a dense graph they cut through other nodes, overlap each other, and become completely unreadable. The library does not have built-in obstacle-avoiding routing. Building genuinely good edge routing (edges that navigate around nodes like circuit traces) is a 2-4 week engineering project on its own and is consistently cited as the most underestimated piece of any React Flow build. The main options:

- **ELK (Eclipse Layout Kernel)**: a Java-based layout engine accessible via WebAssembly that provides high-quality orthogonal routing. Well-regarded but the React Flow integration is described by practitioners as "underdocumented and fragile." Nearly 50% of teams building production React Flow apps had to implement ELK.
- **Dagre**: simpler, less powerful, faster to integrate. Good for auto-layout of DAGs but not as capable as ELK for edge routing.
- **Smart edge library** (`react-flow-smart-edge`): community plugin that does basic obstacle avoidance. Lighter lift than ELK but less robust.

For Solenoid's graph scale (10-50 nodes typical) the spaghetti problem is manageable but the named portal system (wireless connections) is the right architectural response - reducing the number of actual wires in the graph is better than routing wires around each other.

### Controlled vs uncontrolled state: pick one and commit

React Flow has two modes - controlled (you manage node/edge state externally) and uncontrolled (React Flow manages it internally). The docs recommend controlled for any non-trivial app. The gotcha is that switching between modes mid-project is painful. The decision interacts with undo/redo architecture (which requires controlled state) and with Zustand/Redux integration.

The recommendation for Solenoid: use controlled state with Zustand from day one. The graph state needs to be serializable to JSON for save/load, needs to feed into the Rust execution engine, and needs a proper undo/redo history. All of this requires controlled state.

### The `applyNodeChanges` re-render bug

A confirmed issue (as of React Flow 12.3.6, may be patched): when using Zustand for state management, `applyNodeChanges` causes all nodes to re-render whenever any single node moves, even with `React.memo` on custom node components. This makes node dragging feel sluggish as graph complexity grows. The workaround is to use React Flow's built-in `useState`-based state hooks for position tracking and Zustand only for application-level data. Worth knowing about before hitting it in production.

### Edges disappearing silently

A common beginner/intermediate trap: edges don't render and there's no error. Common causes:
- Forgot to import `@xyflow/react/dist/style.css`
- Custom node component doesn't include a `<Handle>` component - React Flow requires handles to exist for edges to connect
- External CSS (Tailwind, Bulma) is overriding `.react-flow__edges` with `overflow: hidden`

All three are silent failures. The stylesheet import should be the first thing checked when edges go missing.

### Node IDs must be stable

React Flow requires every node and edge to have a stable unique ID. IDs generated dynamically (like `Date.now()` or `Math.random()`) that change on re-renders cause subtle, hard-to-diagnose rendering bugs. Use UUIDs or a deterministic ID scheme from the start.

### Performance cliff at 200+ nodes / 4000+ edges

React Flow's maintainers have acknowledged the library isn't designed for very large graphs. A real case in late 2025 reported browser lockup at 200+ nodes with 4000+ edges. For Solenoid's expected graph sizes this is not a concern - the performance cliff is well above typical usage. But it's a hard ceiling to know about if Solenoid ever needs to display very large publisher widget catalogs or complex pre-built graphs.

### The `panOnScroll` trackpad behavior needs explicit configuration

By default React Flow uses "slippy map" controls - drag to pan, scroll to zoom. On macOS trackpads this means two-finger scroll zooms rather than pans, which most users find counterintuitive. Setting `panOnScroll={true}` makes two-finger scroll pan the canvas (Figma-style), with pinch-to-zoom still working via the `ctrlKey` flag browsers set on pinch gestures. This should be the default configuration for Solenoid - it matches what macOS users expect from every other canvas app.

### Undo/redo requires custom implementation

React Flow does not provide undo/redo. It must be built on top of its state model. The clean implementation is an immutable history stack where each user action creates a new state snapshot. Libraries like `use-undoable` wrap this pattern but for a graph with complex interdependencies, a custom implementation gives more control. The key is ensuring every graph mutation (add node, delete node, connect, disconnect, move, resize, bypass toggle, parameter change) pushes to the history stack atomically.

---

## Trackpad and input device handling

This is a persistent source of frustration across every canvas-based application, and React Flow is no exception. The underlying cause is a browser/OS ambiguity: when macOS sends a two-finger scroll event, it's sent as a `WheelEvent`, identical to a mouse wheel scroll. The only way to distinguish trackpad scroll from mouse wheel scroll is the `ctrlKey` flag, which browsers set to `true` on pinch-to-zoom gestures (but not on scroll).

**The standard pattern that works** (used by Figma, Excalidraw, tldraw):
```
if (e.ctrlKey || e.metaKey) {
  handleZoom(e);       // pinch gesture or Ctrl+scroll
} else {
  handlePan(e);        // two-finger scroll
}
```

React Flow implements this via the `panOnScroll` prop. Setting it to `true` enables Figma-style trackpad behavior.

**The additional gotcha**: trackpad pinch events send very small `deltaY` values (0.5-3) while mouse scroll wheels send larger values (100-120). Without normalization, zoom feels "twitchy" on a trackpad and "sluggish" on a mouse wheel. Clamping `deltaY` to a sensible range per event (e.g. max ±10) normalizes the experience across input devices.

**The Tauri-specific consideration**: since Solenoid is a desktop app, it uses the OS native webview (WKWebView on macOS, WebView2 on Windows). Gesture handling in Tauri should behave consistently with other macOS apps rather than needing browser-specific workarounds, but the `panOnScroll` React Flow configuration is still the right call.

**The "momentum zoom" problem**: macOS trackpad scroll events include inertia (the scroll continues briefly after you lift your fingers). In canvas applications this can cause unintentional zoom past the intended level. The fix is to add a brief cooldown after the last scroll event before committing the zoom, or to use a dampening factor on the zoom delta.

---

## Color accessibility and socket type color system

### Why this matters specifically for node graphs

Socket color coding is the primary visual affordance teaching users the type system without documentation. If the colors are not distinguishable for colorblind users, the type system becomes meaningless for ~8% of male users and ~0.5% of female users (red-green colorblindness being the most common form).

### The dangerous combinations to avoid

The color pairs most commonly confused by colorblind users:
- Red / green (affects ~8% of males with deuteranopia/protanopia)
- Green / brown
- Blue / purple
- Green / blue
- Light green / yellow

Most node graph tools use some variant of these problematic pairs. Blender uses yellow for floats and green for vectors - these are reasonably distinguishable, but purple for RGBA and blue-gray for geometry are close enough to cause confusion for some users.

### The solution: Okabe-Ito palette

The Okabe-Ito palette (also called the Wong palette) is the scientific standard for colorblind-safe categorical color. It was developed explicitly to be distinguishable across all major types of color vision deficiency. The 8 colors with hex codes:

- Orange: `#E69F00`
- Sky Blue: `#56B4E9`
- Bluish Green: `#009E73`
- Yellow: `#F0E442`
- Blue: `#0072B2`
- Vermillion (red-orange): `#D55E00`
- Reddish Purple: `#CC79A7`
- Black: `#000000`

For Solenoid's three socket types, a subset of Okabe-Ito works perfectly:
- **Number**: `#E69F00` (orange) - warm, "active", numeric feel
- **Percentage**: `#56B4E9` (sky blue) - cool, distinct from orange
- **Weighted-list**: `#009E73` (bluish green) - clearly different from both

These three are distinguishable in all common forms of color blindness including full red-green blindness. They also look excellent on a dark canvas background.

### Don't rely on color alone

Even with a good palette, color should not be the only differentiator. The socket shape can also carry type information - a circle for number, a diamond for percentage, a square for weighted-list, for example. This multi-channel encoding (color + shape) ensures the type system is accessible even in grayscale or for users with full achromatopsia (complete color blindness, rare but real).

---

## Error UX for node graphs specifically

Generic error UX advice (be clear, be constructive, show recovery path) applies but node graphs have specific failure modes that need specific treatments.

### The three categories of node-level errors

**Fetch errors** (source nodes only): the widget data couldn't be retrieved. Could be a network issue, an expired API key, FEC API being down, Google Sheets permissions changing. The right treatment:
- Red border or warning icon on the node face, persistent (not just on hover)
- Status text below the node: "Last fetch failed · 14m ago" with a manual retry button
- The node should show stale data (last successful fetch) rather than going blank - blank is more disorienting than stale

**Type mismatch errors** (computation nodes): an incoming connection carries a type the node can't accept. In a well-implemented typed socket system this should be prevented at connection time, not discovered at evaluation time. But if it somehow occurs (e.g. a publisher changes a widget's output type), the right treatment:
- The incoming wire should visually indicate the error (red wire or dashed wire)
- The computation node shows an error state with: "Expected number, received percentage - add a conversion node"
- The rest of the graph continues evaluating what it can; one broken node shouldn't black out everything downstream

**Evaluation errors** (computation nodes): a mathematical error occurs during evaluation (division by zero, etc.). Treatment:
- Node shows the error value inline (e.g. "∞" or "Error")
- Error message on hover or in a side panel: "Division by zero - check that your denominator input isn't zero"

### The principle: errors should be local, not global

A single failed source node should not cascade to make the entire graph appear broken. Each node should independently show its own state. Downstream nodes from an errored node should show a "upstream error" state (slightly different visual from a "my own error" state) rather than silently showing wrong values or going blank.

### Plain language error messages: concrete examples

Wrong (technical): "TypeError: Cannot convert undefined to number at node_42 input_0"
Right (plain): "This node needs a number to work with, but the connection isn't providing one yet"

Wrong: "API fetch failed: 429 Too Many Requests"
Right: "FEC data is temporarily unavailable - showing data from 3 hours ago"

Wrong: "Circular dependency detected in graph"
Right: "Two nodes are connected in a loop - a graph can't flow back to where it started. Disconnect one of the highlighted connections."

---

## What node graphs can't do well: knowing the limits

This matters for Solenoid's design because it clarifies what should stay out of scope and why. The core critique of visual programming (from practitioners who've hit the walls):

**Conditional logic at scale**: basic if/then branching is fine as a node type. But complex nested conditionals become exponentially harder to read and manage visually than in code. For Solenoid this is irrelevant - the computation nodes are arithmetic operations not conditional logic. No loops, no branching needed.

**Reusability**: the "linked clone" problem. Node graphs have no mature equivalent of functions or libraries - you can collapse a subgraph into a node group but changing one instance doesn't update others. This is a known gap that affects every node graph tool. For Solenoid it means graph templates shared as JSON files are the right reuse mechanism, not something fancier.

**The 50-node cognitive limit**: research and practitioners converge on roughly 50 visible nodes as the point where spatial navigation becomes the primary cognitive burden. Above that, users spend more time finding their way around the graph than understanding it. For Solenoid this is actually a feature - the small fixed node set and personal-scale use case naturally keeps graphs well under this limit.

**Dynamic/conditional graphs**: a node graph where nodes appear and disappear conditionally at runtime is very hard to reason about. Solenoid's graphs are static - the same nodes are always present, just updating their values. This is the right constraint.

The Temporal.io article "The Fallacy of the Graph" makes a strong case against node graphs for agentic/workflow automation (complex control flow, error handling, dynamic state). These critiques don't apply to Solenoid - it's a pure data flow computation graph, not a workflow engine. The cases where node graphs fail are exactly the cases Solenoid is not trying to solve. This is a feature, not a limitation.

---

## Why users abandon node graph tools: the real reasons

Beyond individual UX complaints, the patterns of actual tool abandonment:

**The complexity cliff**: tools that work perfectly for simple graphs but fail badly past ~20 nodes. Users invest time learning the tool, build something moderately complex, hit the complexity cliff, and leave. The cliff is usually a combination of spaghetti wires making the graph unreadable AND no good tools (portals, groups, comments) for managing that complexity. Solenoid's portal system and small fixed node set directly address this.

**"I can do this faster in a spreadsheet"**: the moment building the graph requires more effort than just doing the calculation manually, users leave. This is the core failure mode of tools with too much friction to add/connect nodes. For Solenoid, the add-node-and-connect experience needs to feel as fast as typing a formula.

**Trust collapse**: when a graph produces an obviously wrong output and the user can't figure out why (no inline values, unhelpful error messages, silent failures), trust in the tool collapses. Users would rather do the calculation themselves than trust an opaque system. Inline value display and clear error states directly prevent this.

**No feedback loop**: tools where you build the graph and then "run" it as a batch operation, rather than seeing values update live. The immediacy of seeing output change as you adjust inputs is what makes node graphs feel powerful. Solenoid's source nodes polling live data means the graph is always "running" - there's nothing to manually execute.

**The onboarding gap**: users open the app, see a blank canvas, have no idea what to do, and close it. Addressed by shipping with a working example graph.

---

## Final comprehensive feature list (all rounds synthesized)

### Must have in Phase 1 (non-negotiable)
- Controlled state with Zustand from day one
- Stable UUID-based node IDs
- Import `@xyflow/react/dist/style.css` (obvious but a silent failure if forgotten)
- `panOnScroll={true}` for Figma-style trackpad behavior
- Zoom delta normalization for trackpad vs mouse wheel consistency
- Socket type system: number / percentage / weighted-list
- Okabe-Ito color palette for socket types: orange `#E69F00` / sky blue `#56B4E9` / bluish green `#009E73`
- Shape encoding alongside color (circle / diamond / square)
- Current output value displayed on node face always (not hover)
- Status indicator below source nodes ("updated Xm ago" / "fetch failed")
- Right-click OR double-click canvas to add node (filtered by dragged socket type)
- Full undo/redo as immutable history stack covering all graph mutations
- Comment/frame nodes with colors and labels
- Minimap
- Conduit nodes (Solenoid's reroute/dot nodes — double-click wire to insert inline)
- Named portal nodes (wireless named connections - critical for Solenoid's fan-out data feeds)
- Bypass toggle persistent button on each node face
- "Delete and relink" as default delete
- Dark theme, Okabe-Ito colors, node face shows value always
- Ship with working FEC donation example graph

### Should have before public release
- Node groups (collapse subgraph)
- Auto-layout (ELK or Dagre integration - start with Dagre, upgrade to ELK if needed)
- Icons on each node type
- Node collapse/expand
- Plain-language error messages for all three error categories
- Orthogonal wire style option
- Keyboard shortcuts panel discoverable in app
- Partial graph execution in Rust (dirty-node tracking)
- Cross-graph copy/paste of node clusters

### Nice to have / Phase 3+
- Named graph bookmarks
- ELK obstacle-avoiding edge routing
- Linked clone node groups
- Zoom momentum dampening tuning
- Customizable keyboard shortcuts
- Sticky notes
- Align-in-direction tool
