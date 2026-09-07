import { useEffect, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import wordmark from "../../logo/solenoidwordmark.svg";
import pkg from "../../../package.json";
import { Reveal, Diagram, Cables, MNode } from "./LandingScenes";
import { SOCKET_COLORS } from "../sockets";
import "./LandingPage.css";
import "./ObsidianPage.css";

const C = SOCKET_COLORS;

// The /obsidian route: a standalone document on the landing page's design tokens,
// pitched at Obsidian users who have never opened Solenoid. It frames Solenoid as
// the computation layer for a vault, with the Obsidian <-> Solenoid <-> Excel round
// trip as the centerpiece. No live rete stage here; every vignette is static DOM+SVG.

const GITHUB_URL = "https://github.com/bubba8587/solenoid";

function ThemeToggle() {
  const mode = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.getMode);
  const dark = mode === "dark";
  return (
    <button
      className="sol-landing__theme"
      onClick={() => appThemeStore.toggleMode()}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="3.25" />
          <path d="M8 1.2v1.8 M8 13v1.8 M1.2 8h1.8 M13 8h1.8 M3.2 3.2l1.3 1.3 M11.5 11.5l1.3 1.3 M12.8 3.2l-1.3 1.3 M4.5 11.5l-1.3 1.3" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z" />
        </svg>
      )}
    </button>
  );
}

function Feature({
  title,
  flip,
  scene,
  children,
}: {
  title: string;
  flip?: boolean;
  scene: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`sol-landing__deep${flip ? " sol-landing__deep--flip" : ""}`}>
      <Reveal className="sol-landing__deep-copy">
        <h2>{title}</h2>
        {children}
      </Reveal>
      <Reveal className="sol-landing__deep-scene" delay={90}>
        {scene}
      </Reveal>
    </section>
  );
}

// The concrete showcase: an actual node chain on the canvas ground, so a cold
// visitor sees the product shape (cards + typed cables) before any prose. The cube
// socket (violet hexagon) is what every vault reader emits.
function PipelineScene() {
  const W = 660;
  const H = 220;
  const cube = { kind: "cube" as const, color: C.cube, tip: "Cube" };
  return (
    <Diagram w={W} h={H}>
      <Cables
        w={W}
        h={H}
        runs={[
          { from: [190, 100], to: [262, 100], color: C.cube },
          { from: [416, 100], to: [486, 100], color: C.cube },
        ]}
      />
      <MNode
        x={14}
        y={48}
        w={176}
        accent={C.cube}
        title="Vault Folder"
        socks={[{ cy: 52, side: "out", glyph: cube }]}
      >
        <span className="obs-node-chip">Notes/</span>
        <p className="sol-mnode__prose">One row per note, typed from the frontmatter.</p>
      </MNode>
      <MNode
        x={262}
        y={48}
        w={154}
        accent={C.cube}
        title="Filter"
        socks={[
          { cy: 52, side: "in", glyph: cube },
          { cy: 52, side: "out", glyph: cube },
        ]}
      >
        <pre className="sol-mnode__front">{"tags contains\n\"book\""}</pre>
      </MNode>
      <MNode
        x={486}
        y={48}
        w={162}
        accent={C.cube}
        title="Write Properties"
        socks={[{ cy: 52, side: "in", glyph: cube }]}
      >
        <p className="sol-mnode__prose">Writes a score back to each note.</p>
        <span className="obs-node-run">Run</span>
      </MNode>
    </Diagram>
  );
}

// The round trip: vault on the left, spreadsheets on the right, Solenoid computing
// in the middle, data moving both ways. The centerpiece of the page's framing.
function FlowScene() {
  return (
    <div className="obs-flow">
      <div className="obs-flow__node">
        <span className="obs-flow__name">Obsidian</span>
        <small>notes · tasks</small>
      </div>
      <div className="obs-flow__link">
        <span className="obs-flow__arrows" aria-hidden="true">⇄</span>
        <small>properties · markdown</small>
      </div>
      <div className="obs-flow__node obs-flow__node--hub">
        <span className="obs-flow__name">Solenoid</span>
        <small>compute</small>
      </div>
      <div className="obs-flow__link">
        <span className="obs-flow__arrows" aria-hidden="true">⇄</span>
        <small>CSV in · CSV out</small>
      </div>
      <div className="obs-flow__node">
        <span className="obs-flow__name">Excel</span>
        <small>spreadsheets</small>
      </div>
    </div>
  );
}

// A static "frontmatter in, columns out" vignette for the Vault Folder feature.
function VaultTableScene() {
  return (
    <div className="obs-illus">
      <pre className="obs-yaml">
{`---
title: Deep Work
tags: [book, focus]
rating: 4.5
finished: 2026-08-21
---`}
      </pre>
      <div className="obs-arrow" aria-hidden="true">→</div>
      <table className="obs-table">
        <thead>
          <tr><th>name</th><th>tags</th><th>rating</th><th>finished</th></tr>
        </thead>
        <tbody>
          <tr><td>Deep Work</td><td>book, focus</td><td>4.5</td><td>2026-08-21</td></tr>
          <tr><td>Spanish course</td><td>course</td><td>3.0</td><td></td></tr>
        </tbody>
      </table>
    </div>
  );
}

// The real Import Obsidian Note node: one note in, its frontmatter keys as typed
// output sockets plus a document output. Replaces the old made-up example node.
function NoteImportScene() {
  const W = 320;
  const H = 168;
  const num = { kind: "circle" as const, color: C.number, tip: "Numeric" };
  const doc = { kind: "document" as const, color: C.document, tip: "Document" };
  return (
    <Diagram w={W} h={H}>
      <MNode
        x={60}
        y={22}
        w={200}
        accent={C.number}
        title="assumptions.md"
        socks={[
          { cy: 52, side: "out", glyph: num },
          { cy: 70, side: "out", glyph: num },
          { cy: 92, side: "out", glyph: doc },
        ]}
      >
        <div className="sol-mnode__row"><span className="sol-mnode__label">rate</span><span className="sol-mnode__val">0.045</span></div>
        <div className="sol-mnode__row"><span className="sol-mnode__label">years</span><span className="sol-mnode__val">25</span></div>
        <div className="sol-mnode__row"><span className="sol-mnode__label">document</span><span className="sol-mnode__val obs-node-dim">note</span></div>
      </MNode>
    </Diagram>
  );
}

// The real TaskNotes node: three typed outputs off the plugin's API.
function TaskNotesNodeScene() {
  const W = 320;
  const H = 168;
  const cube = { kind: "cube" as const, color: C.cube, tip: "Cube" };
  const frame = { kind: "frame" as const, color: C.frame, tip: "Frame" };
  const num = { kind: "circle" as const, color: C.number, tip: "Numeric" };
  return (
    <Diagram w={W} h={H}>
      <MNode
        x={65}
        y={22}
        w={190}
        accent={C.cube}
        title="TaskNotes"
        socks={[
          { cy: 52, side: "out", glyph: cube },
          { cy: 70, side: "out", glyph: frame },
          { cy: 88, side: "out", glyph: num },
        ]}
      >
        <div className="sol-mnode__row"><span className="sol-mnode__label">Tasks</span><span className="sol-mnode__val obs-node-dim">cube</span></div>
        <div className="sol-mnode__row"><span className="sol-mnode__label">Calendar</span><span className="sol-mnode__val obs-node-dim">frame</span></div>
        <div className="sol-mnode__row"><span className="sol-mnode__label">Stats</span><span className="sol-mnode__val obs-node-dim">counts</span></div>
      </MNode>
    </Diagram>
  );
}

// The real Local File node: a CSV exported from Excel, read as a frame.
function LocalFileScene() {
  const W = 320;
  const H = 150;
  const frame = { kind: "frame" as const, color: C.frame, tip: "Frame" };
  return (
    <Diagram w={W} h={H}>
      <MNode
        x={60}
        y={26}
        w={200}
        accent={C.frame}
        title="sales.csv"
        socks={[{ cy: 52, side: "out", glyph: frame }]}
      >
        <div className="sol-mnode__row"><span className="sol-mnode__label">table</span><span className="sol-mnode__val obs-node-dim">frame</span></div>
        <p className="sol-mnode__prose">Read from your data folder, columns typed for you.</p>
      </MNode>
    </Diagram>
  );
}

// A static write "plan": the frame a writer emits before Run, one row per change.
function PlanScene() {
  return (
    <div className="obs-illus obs-illus--single">
      <table className="obs-table obs-table--wide">
        <caption>Plan</caption>
        <thead>
          <tr><th>path</th><th>key</th><th>action</th></tr>
        </thead>
        <tbody>
          <tr><td>Notes/Deep Work.md</td><td>rating</td><td><span className="obs-badge obs-badge--change">change</span></td></tr>
          <tr><td>Notes/Atlas.md</td><td>score</td><td><span className="obs-badge obs-badge--add">add</span></td></tr>
          <tr><td>Notes/Focus.md</td><td>rating</td><td><span className="obs-badge">unchanged</span></td></tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ObsidianPage() {
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAnim(true);
  }, []);
  useEffect(() => {
    document.title = "Solenoid · The computation layer for your vault";
  }, []);

  return (
    <div className={`sol-landing${anim ? " sol-landing--anim" : ""}`}>
      <div className="sol-landing__inner">
        <header className="sol-landing__top">
          <a href="/?landing" aria-label="Solenoid">
            <span
              className="sol-landing__wordmark"
              role="img"
              aria-label="Solenoid"
              style={{ WebkitMaskImage: `url("${wordmark}")`, maskImage: `url("${wordmark}")` }}
            />
          </a>
          <nav className="sol-landing__nav">
            <a href="/?landing">What is Solenoid?</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href="/">Open the app</a>
            <ThemeToggle />
          </nav>
        </header>

        <main>
          <section className="sol-landing__hero">
            <div className="sol-landing__hero-copy">
              <Reveal>
                <span className="obs-eyebrow">For Obsidian &amp; TaskNotes</span>
                <h1>The computation layer for your vault.</h1>
              </Reveal>
              <Reveal delay={110}>
                <p>
                  Your vault is already full of numbers: ratings in frontmatter,
                  estimates and due dates in TaskNotes, tables inside your notes.
                  Solenoid reads them, runs real spreadsheet math over them, and writes
                  the answers back. There is no plugin to install.
                </p>
              </Reveal>
              <Reveal delay={220}>
                <p className="obs-note">
                  New to Solenoid? It is a visual alternative to Excel. Values flow
                  through cards you can see, and every Excel function works by its own
                  name. This page is the Obsidian half of it.
                </p>
              </Reveal>
              <Reveal delay={300}>
                <div className="sol-landing__actions">
                  <a className="sol-landing__cta sol-landing__cta--primary" href={`${GITHUB_URL}/releases/latest`} target="_blank" rel="noreferrer">
                    Download for Windows
                  </a>
                  <a className="sol-landing__cta" href="/?landing">
                    What is Solenoid?
                  </a>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="sol-landing__demo">
            <Reveal>
              <PipelineScene />
              <p className="sol-landing__demo-note">
                A graph that reads a vault folder, keeps the notes tagged{" "}
                <code>book</code>, and writes a score back to their frontmatter. Every
                step is a card on a canvas, and the violet cable carries the whole table
                of notes from one to the next.
              </p>
            </Reveal>
          </section>

          <section className="sol-landing__section obs-flow-section">
            <Reveal>
              <h2>Everything stays where it lives</h2>
              <p className="sol-landing__lede">
                Notes and tasks come into Solenoid; results go back to the vault.
                Spreadsheets move the same way over CSV. Nothing is locked into a new
                format, and the vault stays the source of truth.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <FlowScene />
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Reading the vault</h2>
              <p className="sol-landing__lede">
                Solenoid reads the vault three ways: a whole folder as a table, a single
                note as a source, and a TaskNotes board through its API. Each one arrives
                as typed data you can compute on.
              </p>
            </Reveal>
          </section>

          <Feature title="Your vault as a table" scene={<VaultTableScene />}>
            <p>
              Vault Folder reads a folder of notes as one table. The built-in file
              columns come first (<code>path</code>, <code>name</code>,{" "}
              <code>tags</code>, <code>links</code>, <code>created</code>,{" "}
              <code>modified</code>), then every frontmatter key in first-seen order. A
              list property stays a list in its cell, and a table-shaped property stays a
              nested table.
            </p>
            <p>
              Types come from an mdbase schema when the folder has one, then from{" "}
              <code>.obsidian/types.json</code>, then a guesser. Filter, Sort and Distinct
              read it directly, so <em>notes tagged book, newest first</em> is two nodes.
            </p>
          </Feature>

          <Feature title="A single note as a source" flip scene={<NoteImportScene />}>
            <p>
              Import Obsidian Note picks one <code>.md</code> file as a read-only source.
              Its frontmatter keys become typed outputs and the body renders inline.
              Reload re-reads it from disk.
            </p>
            <p>
              Any note whose body opens with a YAML block is a typed record, so a plain
              note works without a schema. Keep a model&apos;s assumptions in the vault
              and the numbers follow when you edit them there.
            </p>
          </Feature>

          <Feature title="TaskNotes over its API" scene={<TaskNotesNodeScene />}>
            <p>
              The TaskNotes node reads the plugin through its local HTTP API, not the
              files, so recurrence expansion and time totals stay the plugin&apos;s own
              logic. Tasks gives every task as a row: status, priority, due, scheduled,
              estimate and tracked minutes, with projects, contexts, tags and blocked-by
              as lists and time entries as nested tables.
            </p>
            <p>
              Calendar gives the events between two dates, and Stats gives the counts.
              Turn the API on in the plugin&apos;s settings, then set the address and
              token.
            </p>
          </Feature>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Writing it back</h2>
              <p className="sol-landing__lede">
                When the math is done, three sinks put the results where you will read
                them. Each loads disarmed, previews before it touches a file, and writes
                only when you press Run.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <div className="obs-cards">
                <div className="obs-card">
                  <h3>Write Properties</h3>
                  <p>
                    Writes rows back into notes&apos; frontmatter, keyed by a{" "}
                    <code>path</code> column. Each column becomes a property in the form
                    its type asks for: dates unquoted, lists as blocks, note names as
                    links.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Write to Obsidian</h3>
                  <p>
                    Writes a note or report into the vault as portable markdown:
                    frontmatter, tables, mermaid, math, and rasterized chart images, under
                    a vault-relative subfolder.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Write Tasks</h3>
                  <p>
                    Creates or updates TaskNotes tasks from rows. A row with a{" "}
                    <code>path</code> updates that task; a row without one creates a task
                    from its title.
                  </p>
                </div>
              </div>
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>What you can build</h2>
              <p className="sol-landing__lede">
                A few jobs the readers and writers add up to, each a small graph of the
                cards above.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <div className="obs-recipes">
                <div className="obs-card">
                  <h3>Rank what to do next</h3>
                  <p>
                    Score each task by priority, due date and estimate, then write the
                    score back so a Bases view sorts your list by it.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Trend your daily notes</h3>
                  <p>
                    Read the Daily folder, where the file name becomes a date and mood,
                    sleep and weight become columns. Chart the trend and count streaks.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Roll up a folder</h3>
                  <p>
                    Sum budgets by status across a folder of project notes, count the open
                    tasks in each, and write the totals into a summary note.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Bring a spreadsheet in</h3>
                  <p>
                    Join a CSV of expenses against your project notes, then write a
                    per-project total back to each one.
                  </p>
                </div>
              </div>
            </Reveal>
          </section>

          <Feature title="Excel too, over CSV" flip scene={<LocalFileScene />}>
            <p>
              Export a sheet to CSV and Local File reads it as a table with columns typed
              for you. Write File sends a table back out as CSV for Excel to open. The
              functions you know come along: Solenoid keeps Excel&apos;s names and
              Excel&apos;s answers.
            </p>
            <p>
              So a number can start in a spreadsheet, get joined against your notes, and
              land back in a task, without leaving a trail of one-off exports behind it.
            </p>
          </Feature>

          <Feature title="Preview, then Run" scene={<PlanScene />}>
            <p>
              Every writer shows a plan before it writes. Preview reads the current notes
              or tasks and marks each row as add, change, or leave alone, and the status
              line summarizes it. Run applies only the resolved plan, through an atomic
              write.
            </p>
            <p>
              Property writes patch the YAML one line at a time and never re-serialize the
              note, and a value that fails its mdbase type is refused rather than written.
              Your notes change the way you would change them by hand.
            </p>
          </Feature>

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
              <p>
                Bases and Dataview query and display your notes. Solenoid is the piece
                that computes over them: joins across notes, a schedule from task
                dependencies, a simulation, a real formula, then the result written back.
                Your vault stays your database, and your spreadsheets are one CSV away.
              </p>
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Getting started</h2>
            </Reveal>
            <Reveal delay={90}>
              <ol className="obs-steps">
                <li>
                  <span className="obs-step-n">1</span>
                  <div>
                    <strong>Get the desktop app.</strong> The integration reads and writes
                    files, so it runs in the Solenoid desktop build. It is free and open
                    source.
                  </div>
                </li>
                <li>
                  <span className="obs-step-n">2</span>
                  <div>
                    <strong>Point it at your vault.</strong> Under Settings ▸ Obsidian,
                    choose your vault folder. Every reader and writer defaults to it.
                  </div>
                </li>
                <li>
                  <span className="obs-step-n">3</span>
                  <div>
                    <strong>For TaskNotes, turn on the HTTP API</strong> in the
                    plugin&apos;s settings, then set the address (localhost:8080 by
                    default) and paste the token onto the card.
                  </div>
                </li>
              </ol>
            </Reveal>
          </section>

          <section className="sol-landing__strip">
            <Reveal className="sol-landing__strip-in">
              <p>Free and open source. Point it at your vault and start computing.</p>
              <div className="sol-landing__actions">
                <a className="sol-landing__cta sol-landing__cta--primary" href={`${GITHUB_URL}/releases/latest`} target="_blank" rel="noreferrer">
                  Download for Windows
                </a>
                <a className="sol-landing__cta" href="/">Open Solenoid</a>
              </div>
            </Reveal>
          </section>
        </main>

        <footer className="sol-landing__footer">
          <span>Solenoid {pkg.version}</span>
          <span aria-hidden="true">·</span>
          <span>MIT license</span>
          <span aria-hidden="true">·</span>
          <a href="/?landing">What is Solenoid?</a>
          <span aria-hidden="true">·</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        </footer>
      </div>
    </div>
  );
}
