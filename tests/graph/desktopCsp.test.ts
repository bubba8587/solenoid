// [[C130]] rustCore
// The desktop webview fetches the core's .wasm from the app's own origin, so the CSP's connect-src must allow 'self';
// without it the core never loads and nothing computes.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

it("lets the desktop webview fetch the core's module", () => {
  const conf = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
  const csp: string = conf.app.security.csp;
  const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src")) ?? "";
  expect(connect.split(/\s+/)).toContain("'self'");
  const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
  expect(script).toMatch(/'(wasm-)?unsafe-eval'/);
});
