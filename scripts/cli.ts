// The `solenoid` command (`npm run build:cli` → dist-cli/solenoid.mjs, one Node file beside the engine's wasm): what
// an agent or a script needs to build and run a graph with only Node installed.
//   solenoid guide                               how a graph is written: the text form and the socket types
//   solenoid cards [--list | --card <words…>]   the cards: every one on a line, or the named ones in full
//   solenoid validate <graph> [--json]           check a text-form or JSON graph; --json prints it as the JSON save
//   solenoid run <graph> [--set name=value]… [--out name]… [--vault <path>] [--data <folder>] [--raw]
//   solenoid run --formula '<formula>' [--set name=number]…
import { readFileSync } from "node:fs";
import { loadWasmEngineSync, wasmUrl } from "../src/graph/engineWasm";
import { isEntry } from "./entry";
import { main as cards } from "./ai-grounding";
import { main as validate } from "./validate-graph";
import { main as run } from "./run-graph";

const USAGE = `solenoid: build and run Solenoid graphs without the app

  solenoid guide                         how a graph is written: one card per line, typed cables (start here)
  solenoid cards --list                  every card on a line: class, name, what it does
  solenoid cards --card join sort        those cards in full: sockets, settings and their choices
  solenoid validate model.txt            check a graph (text form or JSON); --json prints the JSON the app opens
  solenoid run model.txt --out Total     run it and print that card's outputs as JSON
      --set Name=value   type into an input card first      --vault <path>   an Obsidian vault for the vault cards
      --data <folder>    the folder Local File reads         --raw            the engine's own values
  solenoid run --formula 'PMT(rate / 12, 60, 10000)' --set rate=0.05`;

export async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") { console.log(USAGE); return; }
  // Every command builds cards, and a card needs the engine.
  loadWasmEngineSync(readFileSync(wasmUrl));
  if (command === "guide") cards(["--guide"]);
  else if (command === "cards") cards(rest);
  else if (command === "validate") validate(rest);
  else if (command === "run") await run(rest);
  // A bare graph file runs, as the bundle did when it was the runner alone.
  else await run(args);
}

if (isEntry("cli") || isEntry("solenoid")) {
  await main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
