// A function record on disk (tree/specs/computation/function-records.md § What a record holds).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Case { formula: string; env: string[]; excel: string; ours: string; expect: string; truth: string; verdict: string; cite: string }
export interface Group { group: string; axis: string; cite: string[]; cases: Case[] }

export const RECORDS = "fixtures/functions";

/** A case's identity: its formula without the spaces between tokens, which mean nothing in the shared syntax (it has
 *  no space operator), and its bindings in order. */
export const keyOf = (formula: string, env: readonly string[]) =>
  JSON.stringify([formula.replace(/"[^"]*"|\s+/g, (s) => (s.startsWith('"') ? s : "")), [...env].sort()]);

export function readRecord(root: string, fn: string): Group[] | null {
  const p = join(root, RECORDS, `${fn}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Group[]) : null;
}

/** A record as text, one case to a line, so a diff names the cases that changed. */
export function recordText(record: Group[]): string {
  const groups = record.map((g) => {
    const head = JSON.stringify({ group: g.group, axis: g.axis, cite: g.cite }).slice(0, -1);
    return `${head}, "cases": [\n${g.cases.map((c) => `  ${JSON.stringify(c)}`).join(",\n")}\n]}`;
  });
  return `[\n${groups.join(",\n")}\n]\n`;
}
