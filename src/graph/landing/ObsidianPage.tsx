// [[D62]], [[C2]], [[C107]] obsidianPlugin
import { useEffect, useMemo } from "react";
import { Reveal, useRevealAnim, NoteImportScene, VaultTableScene, TaskNotesScene, LocalFileScene, buildReportPipeline } from "./LandingScenes";
import { LiveGraph } from "./LandingGraph";
import { ReportOverlay } from "../components/ReportOverlay";
import { SiteHeader, SiteFooter, Feature, DownloadLink, PLUGIN_URL } from "./siteNav";
import { PropertiesDemo } from "./PropertiesDemo";
import { TablePopup } from "../components/TablePopup";
import { CubePopup } from "../components/CubePopup";
import { SceneThread } from "./SceneThread";
import { forceDemoVault } from "../demoVault";
import { forceDemoTaskNotes } from "../demoTaskNotes";
import { siteChrome } from "../siteChrome";
import "./LandingPage.css";
import "./ObsidianPage.css";


function FlowScene() {
  return (
    <div className="obs-flow">
      <div className="obs-flow__node">
        <span className="obs-flow__name">Obsidian</span>
        <small>notes · tasks · Solenoid Properties</small>
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
  const anim = useRevealAnim();
  useEffect(() => {
    document.title = "Solenoid · The computation layer for your vault";
  }, []);
  // Forced during render, so the pin is in place before the scene children mount and read it; cleared on unmount.
  // The popup here is a read-only shop window: Export and Dock have nothing to act on off the app.
  useMemo(() => {
    forceDemoVault(true);
    forceDemoTaskNotes(true);
    siteChrome.set({ export: false, dock: false });
  }, []);
  useEffect(() => () => {
    forceDemoVault(false);
    forceDemoTaskNotes(false);
    siteChrome.reset();
  }, []);

  return (
    <div className={`sol-landing${anim ? " sol-landing--anim" : ""}`}>
      <div className="sol-landing__inner">
        <SceneThread />
        <SiteHeader current="/obsidian" />

        <main>
          <section className="sol-landing__hero">
            <div className="sol-landing__hero-copy">
              <Reveal>
                <span className="obs-eyebrow">For Obsidian &amp; TaskNotes</span>
                <h1>The computation layer for your vault.</h1>
              </Reveal>
              <Reveal delay={110}>
                <p>
                  Two parts that share one set of types. The Solenoid Properties plugin puts
                  lists, tables, frames and cubes into Obsidian&apos;s properties, edited in
                  Solenoid&apos;s own table editor. The Solenoid app brings spreadsheet math to
                  the vault: it reads and writes frontmatter properties, pulls tasks from{" "}
                  <a href="https://tasknotes.dev/" target="_blank" rel="noreferrer">
                    TaskNotes
                  </a>
                  , and writes computed values into your notes with{" "}
                  <a href="https://github.com/obsidianmd/knap" target="_blank" rel="noreferrer">
                    Knap
                  </a>{" "}
                  and Reports.
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
                  <a className="sol-landing__cta sol-landing__cta--primary" href={PLUGIN_URL} target="_blank" rel="noreferrer">
                    Get the plugin
                  </a>
                  <DownloadLink />
                  <a className="sol-landing__cta" href="/?landing">
                    What is Solenoid?
                  </a>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Solenoid Properties, the plugin</h2>
              <p className="sol-landing__lede">
                An Obsidian plugin that adds Solenoid&apos;s value types to your properties.
                Each one shows as a chip and opens Solenoid&apos;s editor, and the note
                underneath stays plain YAML.
              </p>
            </Reveal>
            <Reveal delay={100}>
              <PropertiesDemo />
              <p className="sol-landing__demo-note">
                The plugin&apos;s own chips and editor, over the demo vault&apos;s Property
                types note. Open one, change a cell and save; the YAML follows.
              </p>
            </Reveal>
          </section>

          <Feature
            title="The Solenoid look"
            flip
            scene={<img className="obs-shot" src="/obsidian-look.png" alt="An Obsidian vault in Solenoid's dark palette with the gold accent, showing a note's Solenoid properties" loading="lazy" />}
          >
            <p>
              Turn on the plugin&apos;s theme and the whole vault takes Solenoid&apos;s
              palette, with the accent you pick.
            </p>
          </Feature>

          <section className="sol-landing__section">
            <Reveal>
              <div className="obs-cards obs-cards--four">
                <div className="obs-card">
                  <h3>Thirteen property types</h3>
                  <p>
                    A list and a matrix for each of numbers, text, dates, complex numbers
                    and booleans, plus Frame, Cube and a Complex value.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Plain YAML underneath</h3>
                  <p>
                    A list saves as a sequence, a matrix as rows, a frame as rows of{" "}
                    <code>key: value</code>. Without the plugin, the note still reads.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>In Bases too</h3>
                  <p>
                    A Bases table shows the same chip, and opens the same editor.
                  </p>
                </div>
                <div className="obs-card">
                  <h3>Stays on your machine</h3>
                  <p>
                    No network access and no telemetry. Settings and column types live in
                    the plugin&apos;s own data file.
                  </p>
                </div>
              </div>
            </Reveal>
          </section>

          <section className="sol-landing__section">
            <Reveal>
              <h2>Solenoid, the app</h2>
              <p className="sol-landing__lede">
                The app reads the vault as tables, computes like a spreadsheet, and writes
                the answers back as properties, notes and tasks.
              </p>
            </Reveal>
          </section>

          <section className="sol-landing__demo">
            <Reveal>
              <LiveGraph build={buildReportPipeline} />
              <p className="sol-landing__demo-note">
                This graph is live. Edit an input and everything downstream recomputes, or
                open the report to read the note it writes.
              </p>
            </Reveal>
          </section>

          <section className="sol-landing__section obs-flow-section">
            <Reveal>
              <h2>Between your vault and Excel</h2>
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

          <Feature title="Import a note" flip scene={<NoteImportScene />}>
            <p>
              Pick a note from your vault and Solenoid shows it on the canvas, with every
              frontmatter property as a value you can use as an input. The plugin&apos;s
              types come through: a Frame arrives as a frame, with the column types you
              picked.
            </p>
          </Feature>

          <Feature title="TaskNotes API and .mdbase" scene={<TaskNotesScene />}>
            <p>
              Solenoid reads task and calendar data from the local TaskNotes HTTP API, and
              reads .mdbase schemas to type values where it can.
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
                    links come out right. With the plugin, a table written back opens as a
                    chip in the note.
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
                    <strong>Install Solenoid Properties.</strong> In Obsidian, open
                    Settings ▸ Community plugins, search for Solenoid Properties and turn
                    it on. It needs nothing else.
                  </div>
                </li>
                <li>
                  <span className="obs-step-n">2</span>
                  <div>
                    <strong>Get the desktop app.</strong> The integration reads and writes
                    your files, so it runs in the desktop build.
                  </div>
                </li>
                <li>
                  <span className="obs-step-n">3</span>
                  <div>
                    <strong>Point it at your vault.</strong> Under Settings ▸ Obsidian,
                    choose your vault folder. Every reader and writer defaults to it.
                  </div>
                </li>
                <li>
                  <span className="obs-step-n">4</span>
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
                <a className="sol-landing__cta sol-landing__cta--primary" href={PLUGIN_URL} target="_blank" rel="noreferrer">
                  Get the plugin
                </a>
                <DownloadLink />
                <a className="sol-landing__cta" href="/">Open Solenoid</a>
              </div>
            </Reveal>
          </section>
        </main>

        <SiteFooter />
      </div>
      {/* The live hero's Report chip opens its rendered note here (App mounts this for
          the main canvas; the standalone page mounts its own, as with TablePopup). */}
      <ReportOverlay />
      <TablePopup />
      <CubePopup />
    </div>
  );
}
