// The AI palette's service layer (aiInScope/aiWholeDocRewrite). The cage rule: nothing here touches the
// document — a validated rewrite only ever reaches the palette's approval diff.

import Anthropic from "@anthropic-ai/sdk";
import { getAiKey } from "./aiKey";
import { DEMO_KEY, makeDemoFetch } from "./aiDemo";
import { groundingSpec } from "./aiGrounding";
import { validateText, formatIssues, hardIssues } from "./graphValidate";
import { writeTextForm, readTextForm } from "./textForm";

export const AI_MODEL = "claude-opus-5";
/** Repair rounds after the first attempt — each feeds the validator's issues back. */
const MAX_REPAIRS = 2;

export type AiOutcome =
  | { kind: "answer"; text: string }
  /** A validated rewrite; `newText` is CANONICAL (round-tripped through the
   *  reader/writer) so the apply diff never shows formatting-only noise. */
  | { kind: "edit"; newText: string; warnings: string[] }
  | { kind: "error"; message: string };

const FENCE_RE = /```solenoid\n([\s\S]*?)```/;

function systemPrompt(): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    {
      type: "text",
      text:
        `You are the AI assistant inside Solenoid, a node-graph alternative to Excel ` +
        `for data tables. The user's document is given as its text form; the spec below ` +
        `is the complete authoring vocabulary.\n\n` +
        `Respond in exactly one of two ways:\n` +
        `1. A question about the document or about Solenoid: answer in plain prose. ` +
        `Keep it short and concrete; no headings.\n` +
        `2. A request to create or change the document: reply with the FULL replacement ` +
        `text form (every node line plus the sidecar, not a fragment) inside a fenced ` +
        `block starting \`\`\`solenoid. One sentence before the fence saying what changed ` +
        `is welcome; nothing after it.\n\n` +
        `Rewrite rules:\n` +
        `- Keep every node the user did not ask to change, byte-identical where possible ` +
        `(names, init fields, literals, wiring).\n` +
        `- Preserve the sidecar of kept nodes exactly (positions, sizes, standoffs, pins, ` +
        `comments). New nodes may omit positions; place them near related nodes when you ` +
        `do position them.\n` +
        `- Use only node types, socket keys, init fields, and ops from the spec. Respect ` +
        `the socket lattice; insert a Cast where families differ.\n` +
        `- If the request cannot be done with the available nodes, say so in prose ` +
        `instead of guessing.`,
    },
    {
      type: "text",
      text: groundingSpec(),
      // The spec is byte-identical every call by construction — the cacheable prefix.
      cache_control: { type: "ephemeral" },
    },
  ];
}

function userTurn(prompt: string, currentText: string): string {
  return (
    `Current document (text form):\n\`\`\`solenoid\n${currentText}\`\`\`\n\n` +
    `Request: ${prompt}`
  );
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Run one palette prompt against the model; `fetch` is injectable for tests. */
export async function runAiPrompt(
  prompt: string,
  currentText: string,
  opts?: { fetch?: typeof globalThis.fetch },
): Promise<AiOutcome> {
  const apiKey = getAiKey();
  if (!apiKey) return { kind: "error", message: "No AI key is stored. Add one in Settings." };

  // The demo key swaps only the transport — validator, repair rounds and
  // canonicalization still run for real.
  const fetchImpl = opts?.fetch ?? (apiKey === DEMO_KEY ? makeDemoFetch() : undefined);
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true, // the key is the user's own, stored on this device
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: userTurn(prompt, currentText) },
  ];

  try {
    for (let attempt = 0; ; attempt++) {
      const response = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: 16000,
        system: systemPrompt(),
        messages,
        // A classifier decline re-runs server-side on the recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (response.stop_reason === "refusal") {
        return { kind: "error", message: "The model declined this request." };
      }
      const text = textOf(response);
      if (response.stop_reason === "max_tokens") {
        return { kind: "error", message: "The reply was cut off at the length limit. Try a narrower request." };
      }

      const fence = FENCE_RE.exec(text);
      if (!fence) {
        const answer = text.trim();
        if (!answer) return { kind: "error", message: "The model sent an empty reply. Try again." };
        return { kind: "answer", text: answer };
      }

      const candidate = fence[1];
      const { issues, graph } = validateText(candidate);
      const hard = hardIssues(issues);
      if (hard.length === 0 && graph) {
        // Canonicalize through the real writer: semantic diffs only, byte-stable apply.
        const canonical = writeTextForm(readTextForm(candidate));
        return {
          kind: "edit",
          newText: canonical,
          warnings: issues.filter((i) => i.severity === "warning").map((i) => i.message),
        };
      }

      if (attempt >= MAX_REPAIRS) {
        return {
          kind: "error",
          message:
            `The rewrite still fails validation after ${MAX_REPAIRS + 1} attempts:\n` +
            formatIssues(hard),
        };
      }

      messages.push(
        { role: "assistant", content: response.content },
        {
          role: "user",
          content:
            `The strict validator rejected that document:\n${formatIssues(hard)}\n\n` +
            `Send the corrected FULL text form in a \`\`\`solenoid fence.`,
        },
      );
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { kind: "error", message: "The API key was rejected. Check it in Settings." };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { kind: "error", message: "Rate limited. Wait a moment and try again." };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return { kind: "error", message: "Couldn't reach the AI service. Check your connection." };
    }
    if (e instanceof Anthropic.APIError) {
      return { kind: "error", message: `The AI service returned an error: ${e.message}` };
    }
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
