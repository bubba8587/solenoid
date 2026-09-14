import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import wordmark from "../../logo/solenoidwordmark.svg";
import pkg from "../../../package.json";
import { Reveal, Diagram, MNode, NoteImportScene, VaultTableScene, LocalFileScene, buildReportPipeline } from "./LandingScenes";
import { LiveGraph } from "./LandingGraph";
import { ReportOverlay } from "../components/ReportOverlay";
import { SOCKET_COLORS } from "../sockets";
import { forceVaultRoot, forceCsvFolder, DEMO_VAULT_ROOT } from "../demoVault";
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
  // Apply the reveal gate BEFORE the first paint (layout effect, not passive), so the
  // hidden state paints once and the IntersectionObserver's reveal a frame later has a
  // committed frame to transition FROM. A passive effect flips it after paint, so above-
  // the-fold reveals collapse straight to visible with no animation on reload.
  useLayoutEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAnim(true);
  }, []);
  useEffect(() => {
    document.title = "Solenoid · The computation layer for your vault";
  }, []);
  // The whole page demonstrates the vault integration against the bundled demo vault,
  // so every reader scene resolves to it regardless of the user's setting (never
  // persisted). Set during render so it is in place before the scene children mount
  // and read it; cleared on unmount. Plain-anchor navigation to the app reloads anyway.
  useMemo(() => {
    forceVaultRoot(DEMO_VAULT_ROOT);
    forceCsvFolder(`${DEMO_VAULT_ROOT}/Data`);
  }, []);
  useEffect(() => () => { forceVaultRoot(null); forceCsvFolder(null); }, []);

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
                  Solenoid turbocharges your Obsidian notes with real spreadsheet
                  capabilities. You can manage frontmatter properties, read{" "}
                  <a href="https://tasknotes.dev/" target="_blank" rel="noreferrer">
                    TaskNotes
                  </a>{" "}
                  data, and insert values into your notes via{" "}
                  <a href="https://github.com/obsidianmd/knap" target="_blank" rel="noreferrer">
                    Knap
                  </a>{" "}
                  + Reports.
                </p>
              </Reveal>
              <Reveal delay={220}>
                <p className="obs-note">
                  New to Solenoid? It is a visual alternative to Excel: values flow
                  through cards on a canvas, and every Excel function works by its own
                  name. This page covers the Obsidian side.
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
              <LiveGraph build={buildReportPipeline} />
              <p className="sol-landing__demo-note">
                This graph is live. Edit an input, or open the report to read the note it
                writes — everything downstream recomputes.
              </p>
            </Reveal>
          </section>

          <section className="sol-landing__section obs-flow-section">
            <Reveal>
              <h2>A knowledge management system bridge</h2>
            </Reveal>
            <Reveal delay={100}>
              <FlowScene />
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Reading the vault</h2>
            </Reveal>
          </section>

          <Feature title="Your vault as a table" scene={<VaultTableScene />}>
            <p>A folder of notes, read as one table.</p>
          </Feature>

          <Feature title="Import a Note" flip scene={<NoteImportScene />}>
            <p>
              Selecting a note from your vault not only renders it in your Solenoid graph
              but also exposes all of its frontmatter properties as values you can use as
              inputs.
            </p>
          </Feature>

          <Feature title="TaskNotes API and .mdbase" scene={<TaskNotesNodeScene />}>
            <p>
              Solenoid connects to the local TaskNotes HTTP API for advanced task and
              calendar data. Solenoid also uses .mdbase schema to determine value types
              where possible.
            </p>
          </Feature>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Writing it back</h2>
            </Reveal>
            <Reveal delay={100}>
              <div className="obs-cards">
                <div className="obs-card">
                  <h3>Update note properties</h3>
                  <p>
                    Each column becomes a properly typed property, so dates, lists and
                    links come out right.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Create notes and reports</h3>
                  <p>
                    As portable markdown, with frontmatter, tables, diagrams, math and
                    chart images baked in.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Create and update tasks</h3>
                  <p>
                    From a table: a row matched to an existing task updates it, a new row
                    creates one.
                  </p>
                </div>
              </div>
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Examples</h2>
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
              Export a sheet to CSV and Solenoid reads it as a table with columns typed
              for you, then sends a table back out as CSV for Excel to open. The
              functions you know come along: Solenoid keeps Excel&apos;s names and
              Excel&apos;s answers.
            </p>
          </Feature>

          <Feature title="Preview every change" scene={<PlanScene />}>
            <p>
              Every writer shows you a plan before it touches a file. Nothing is written
              until you approve it.
            </p>
            <p>
              Your notes change the way you would change them by hand, and a value that
              does not fit its type is refused rather than written.
            </p>
          </Feature>

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
                    default) and paste the token into Solenoid.
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
      {/* The live hero's Report chip opens its rendered note here (App mounts this for
          the main canvas; the standalone page mounts its own, as with TablePopup). */}
      <ReportOverlay />
    </div>
  );
}
