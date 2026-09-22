// [[C107]] obsidianPlugin
// The rig as a phone (specs/obsidian-plugin.md § Verifying against real Obsidian): Obsidian's
// own mobile emulation, a phone-sized window, and a coarse pointer with touch events, which
// must all live in ONE CDP session, so this takes its steps in a row:
//
//   node scripts/obsidian-rig-mobile.mjs setup 412x915 look Orchard theme light \
//     note "Solenoid/Property types.md" shot note.png tap budget shot frame.png close teardown
//
// setup [WxH] | look <palette> | theme dark|light | note <path> | tap <property> | shot <out.png>
// | settings | close | eval '<js>' | teardown. Needs `npm run plugin:rig -- up` first.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith("app://"));
const cdp = await page.createCDPSession();
const args = process.argv.slice(2);
const out = [];
for (let i = 0; i < args.length; i++) {
  const step = args[i];
  if (step === "setup") {
    const [w, h] = (args[++i] ?? "412x915").split("x").map(Number);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
    await page.evaluate((w, h) => {
      try { window.electron.remote.getCurrentWindow().setBounds({ x: 0, y: 0, width: w, height: h }); } catch {}
      if (!window.app.isMobile) window.app.emulateMobile(true);
    }, w, h);
    await sleep(1500);
    out.push(await page.evaluate(() => ({ isMobile: window.app.isMobile, coarse: matchMedia("(pointer: coarse)").matches, inner: [innerWidth, innerHeight], body: [...document.body.classList].filter((c) => /mobile|phone|tablet|solenoid/.test(c)) })));
  } else if (step === "look") {
    const palette = args[++i] ?? "Default";
    out.push(await page.evaluate(async (palette) => { const app = window.app; app.customCss.setCssEnabledStatus("solenoid", false); const p = app.plugins.plugins["solenoid-properties"]; await p.setLook(true); await p.setPalette(palette); return "look " + palette; }, palette));
  } else if (step === "theme") {
    const t = args[++i];
    await page.evaluate((t) => window.app.changeTheme?.(t === "light" ? "moonstone" : "obsidian"), t);
    await sleep(500);
  } else if (step === "note") {
    const note = args[++i];
    await page.evaluate(async (note) => { const app = window.app; const f = app.vault.getAbstractFileByPath(note); await app.workspace.getLeaf(false).openFile(f, { state: { mode: "source", source: false } }); }, note);
    await sleep(1800);
  } else if (step === "tap") {
    const key = args[++i];
    const r = await page.evaluate((key) => {
      const row = [...document.querySelectorAll(".metadata-property")].find((el) => el.dataset.propertyKey === key);
      if (!row) return "no row " + key;
      const host = row.querySelector(".solenoid-property-chip");
      const btn = host?.shadowRoot?.querySelector("button") ?? row.querySelector("input, button");
      if (!btn) return "no target in " + key;
      const b = btn.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, tag: btn.tagName };
    }, key);
    if (typeof r === "string") { out.push(r); continue; }
    await page.touchscreen.tap(r.x, r.y);
    await sleep(1200);
    out.push(`tapped ${key} (${r.tag})`);
  } else if (step === "shot") {
    const file = args[++i];
    await page.screenshot({ path: file });
    out.push("wrote " + file);
  } else if (step === "settings") {
    await page.evaluate(() => { window.app.setting.open(); window.app.setting.openTabById("solenoid-properties"); });
    await sleep(1500);
  } else if (step === "close") {
    await page.evaluate(() => { window.app.setting.close(); });
    await page.keyboard.press("Escape");
    await sleep(500);
  } else if (step === "eval") {
    out.push(await page.evaluate((src) => Promise.resolve(eval(src)).then((v) => JSON.parse(JSON.stringify(v ?? null))), args[++i]));
  } else if (step === "teardown") {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
    await page.evaluate(() => { try { window.electron.remote.getCurrentWindow().setBounds({ x: 0, y: 0, width: 1480, height: 920 }); } catch {} });
    // Leaving the emulation reloads the app, which ends this session's context: last step.
    await page.evaluate(() => { if (window.app.isMobile) window.app.emulateMobile(false); }).catch(() => {});
    out.push("teardown");
  }
}
console.log(JSON.stringify(out, null, 1));
await browser.disconnect();
