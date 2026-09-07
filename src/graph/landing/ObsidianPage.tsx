import { useEffect, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import wordmark from "../../logo/solenoidwordmark.svg";
import pkg from "../../../package.json";
import { Reveal, ObsidianScene } from "./LandingScenes";
import "./LandingPage.css";
import "./ObsidianPage.css";

// The /obsidian route: a standalone document on the landing page's design tokens,
// describing the Obsidian + TaskNotes integration. No live rete stage here; the one
// vignette (ObsidianScene) is static DOM+SVG, reused from the landing scenes.

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

// A static TaskNotes "Tasks" cube, one row per task.
function TasksScene() {
  return (
    <div className="obs-illus obs-illus--single">
      <table className="obs-table obs-table--wide">
        <caption>Tasks</caption>
        <thead>
          <tr><th>title</th><th>status</th><th>priority</th><th>due</th></tr>
        </thead>
        <tbody>
          <tr><td>Draft the invoice</td><td>open</td><td>high</td><td>2026-09-10</td></tr>
          <tr><td>Tile the backsplash</td><td>in-progress</td><td>normal</td><td>2026-09-14</td></tr>
          <tr><td>Call the plumber</td><td>done</td><td>low</td><td>2026-09-04</td></tr>
        </tbody>
      </table>
    </div>
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
    document.title = "Solenoid · Obsidian & TaskNotes";
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
            <a href="/?landing">Overview</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href="/">Open the app</a>
            <ThemeToggle />
          </nav>
        </header>

        <main>
          <section className="sol-landing__hero">
            <div className="sol-landing__hero-copy">
              <Reveal>
                <span className="obs-eyebrow">Obsidian &amp; TaskNotes</span>
                <h1>Your vault, both directions.</h1>
              </Reveal>
              <Reveal delay={110}>
                <p>
                  Point a node at a vault folder and it reads as a table: one row per
                  note, the file columns plus every frontmatter key, with lists and
                  nested tables kept in the cells. Read a TaskNotes board through its
                  local API the same way. Then write results back as note properties,
                  portable markdown, or tasks.
                </p>
              </Reveal>
              <Reveal delay={220}>
                <p className="obs-note">
                  There is no Obsidian plugin to install. Every touchpoint is a file, a
                  local HTTP port, or a link. The vault stays the home of the numbers,
                  and Solenoid computes over it. Desktop only.
                </p>
              </Reveal>
              <Reveal delay={300}>
                <div className="sol-landing__actions">
                  <a className="sol-landing__cta sol-landing__cta--primary" href={`${GITHUB_URL}/releases/latest`} target="_blank" rel="noreferrer">
                    Download for Windows
                  </a>
                  <a className="sol-landing__cta" href="/?landing">
                    Back to overview
                  </a>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Reading the vault</h2>
              <p className="sol-landing__lede">
                Three readers bring the vault onto the canvas as typed values: a whole
                folder as a table, a single note as a source, and a TaskNotes board
                through its API.
              </p>
            </Reveal>
          </section>

          <Feature title="Your vault as a table" scene={<VaultTableScene />}>
            <p>
              Vault Folder reads a folder of notes as one cube. The built-in file
              columns come first (<code>path</code>, <code>name</code>,{" "}
              <code>tags</code>, <code>links</code>, <code>created</code>,{" "}
              <code>modified</code>), then every frontmatter key in first-seen order. A
              list property stays a list in its cell, and a table-shaped property stays a
              nested table.
            </p>
            <p>
              Types come from an mdbase schema when the folder has one, then from{" "}
              <code>.obsidian/types.json</code>, then a guesser. Filter, Sort and Distinct
              take the cube directly, so <em>notes tagged book, newest first</em> is two
              nodes.
            </p>
          </Feature>

          <Feature title="A single note as a source" flip scene={<ObsidianScene />}>
            <p>
              Import Obsidian Note picks one <code>.md</code> file as a read-only Note. Its
              frontmatter keys become typed outputs and the body renders inline. Reload
              re-reads it from disk.
            </p>
            <p>
              Any note whose body opens with a YAML block is a typed record, so a plain
              note works without a schema. Keep a model&apos;s assumptions in the vault and
              the graph follows when you edit them there.
            </p>
          </Feature>

          <Feature title="TaskNotes over its API" scene={<TasksScene />}>
            <p>
              The TaskNotes node reads the plugin through its local HTTP API, not the
              files, so recurrence expansion and time totals stay the plugin&apos;s own
              logic. Tasks gives every task as a row: status, priority, due, scheduled,
              estimate and tracked minutes, with projects, contexts, tags and blocked-by
              as lists and time entries as nested tables.
            </p>
            <p>
              Calendar gives the events between two dates as a frame, and Stats gives the
              counts. Turn the API on in the plugin&apos;s settings, then set the address
              and token.
            </p>
          </Feature>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Writing it back</h2>
              <p className="sol-landing__lede">
                Three sinks write results into the vault. Each loads disarmed, previews
                before it touches a file, and writes only when you press Run.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <div className="obs-cards">
                <div className="obs-card">
                  <h3>Write Properties</h3>
                  <p>
                    Writes a cube of rows back into notes&apos; frontmatter, keyed by a{" "}
                    <code>path</code> column. Each column becomes a property in the form
                    its type asks for: dates unquoted, lists as blocks, note names as
                    links.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Write to Obsidian</h3>
                  <p>
                    Writes a Note or Report into the vault as portable markdown:
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

          <Feature title="Preview, then Run" flip scene={<PlanScene />}>
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
                The vault is your database and TaskNotes is its tracker. Solenoid computes
                over them and writes results back as properties, markdown, or tasks. It
                does not store your data, track your time, or draw a kanban. Obsidian
                already does that.
              </p>
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Setup</h2>
            </Reveal>
            <Reveal delay={90}>
              <ol className="obs-steps">
                <li>
                  <span className="obs-step-n">1</span>
                  <div>
                    <strong>Run the desktop app.</strong> The integration reads and writes
                    files, so it runs in the Solenoid desktop build, not the browser.
                  </div>
                </li>
                <li>
                  <span className="obs-step-n">2</span>
                  <div>
                    <strong>Set the vault.</strong> Under Settings ▸ Obsidian, point at
                    your vault folder. Every reader and writer defaults to it.
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
              <p>Free and open source. The Obsidian integration ships in the Windows desktop app.</p>
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
          <a href="/?landing">Overview</a>
          <span aria-hidden="true">·</span>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        </footer>
      </div>
    </div>
  );
}
