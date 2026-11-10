// Prints the AI grounding spec (src/graph/aiGrounding.ts, which also feeds the palette's system prompt).
//   npm run ai-grounding [-- --out <file>]
//   npm run -s ai-grounding -- --guide           the text form's grammar and the socket types, without the cards
//   npm run -s ai-grounding -- --list            every card, one line each: its class, name and first sentence
//   npm run -s ai-grounding -- --card join sort  only the cards whose class or name holds one of those words

import { writeFileSync } from "node:fs";
import { isEntry } from "./entry";
import { buildGroundingSpec } from "../src/graph/aiGrounding";

export function main(args: string[]): void {
  const text = buildGroundingSpec();
  /** The words after a flag, up to the next flag. */
  const after = (flag: string): string[] | null => {
    const i = args.indexOf(flag);
    if (i === -1) return null;
    const end = args.findIndex((a, j) => j > i && a.startsWith("--"));
    return args.slice(i + 1, end === -1 ? undefined : end);
  };
  // A card's entry runs from its `#### ` heading to the next heading of any level.
  const cards = text.split(/\n(?=#### )/).slice(1).map((entry) => entry.split(/\n(?=###? )/)[0].trimEnd());
  const out = after("--out")?.[0];
  // `--card A B` and `--card A --card B` both name two cards.
  const wanted = args.includes("--card")
    ? args.flatMap((a, i) => (a === "--card" ? args.slice(i + 1, ((end) => (end === -1 ? undefined : end))(args.findIndex((b, j) => j > i && b.startsWith("--")))) : []))
    : null;

  if (args.includes("--guide")) {
    // The format alone: the text form's grammar, the socket types and the structured settings, without the cards.
    console.log(text.split(/\n(?=## Node classes)/)[0].trimEnd());
  } else if (args.includes("--list")) {
    for (const card of cards) {
      const [heading, ...body] = card.split("\n");
      const about = body.find((line) => line !== "" && !line.startsWith("- ")) ?? "";
      console.log(`${heading.slice(5)}${about ? `: ${about.split(/(?<=\.)\s/)[0]}` : ""}`);
    }
  } else if (wanted) {
    const hits = cards.filter((card) => wanted.some((word) => card.split("\n")[0].toLowerCase().includes(word.toLowerCase())));
    if (hits.length === 0) {
      // The cards whose heading holds every word of a guess: "GroupByNode" finds GroupByFrameNode.
      const words = (w: string) => w.split(/(?=[A-Z])|[\s_-]+/).map((x) => x.toLowerCase()).filter((x) => x !== "" && x !== "node");
      const near = cards
        .map((card) => card.split("\n")[0])
        .filter((head) => wanted.some((w) => words(w).length > 0 && words(w).every((x) => head.toLowerCase().includes(x))))
        .map((head) => /`(\w+)`/.exec(head)?.[1] ?? head.slice(5));
      const hint = near.length > 0 ? ` Did you mean ${near.slice(0, 6).join(", ")}?` : "";
      console.error(`No card's class or name holds ${wanted.map((w) => `"${w}"`).join(" or ")}.${hint} --list shows them all.`);
      process.exitCode = 1;
    } else console.log(hits.join("\n\n"));
  } else if (out) {
    writeFileSync(out, text);
    console.error(`wrote ${out} (${text.length} chars)`);
  } else {
    console.log(text);
  }
}

if (isEntry("ai-grounding")) main(process.argv.slice(2));
