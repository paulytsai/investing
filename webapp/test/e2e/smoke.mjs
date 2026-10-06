// Browser smoke test: starts the app on a spare port with a fresh database, signs in through the dev outbox, loads a
// company, drafts notes (stub Claude), downloads the Excel model, backs up, signs out, and checks the browser copy of
// the saved models is cleared. Needs Playwright with Chromium (npm i -D playwright, or a global install).
//   node test/e2e/smoke.mjs [TICKER]            uses FMP_FIXTURES if set, otherwise live FMP with FMP_API_KEY
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const T = (process.argv[2] || "NKE").toUpperCase();
const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const EMAIL = "owner@example.com";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-e2e-"));

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/index.js"], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASE_URL: BASE, DATA_DIR: dataDir, OWNER_EMAIL: EMAIL, REQUIRE_ADMIN_MFA: "false", CLAUDE_STUB: "true", DEV_MAIL: "true" }, stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const ok = (cond, what) => { if (!cond) throw new Error("FAILED: " + what); console.log("ok  " + what); };

let browser;
try {
  for (let i = 0; i < 50 && !/web app on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true, ignoreHTTPSErrors: !!process.env.IGNORE_HTTPS_ERRORS });
  const p = await ctx.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));

  await p.goto(BASE + "/");
  await p.waitForSelector("#cm-email");
  ok(true, "sign-in screen shown to a signed-out visitor");
  await p.fill("#cm-email", EMAIL); await p.click(".cm-btn"); await p.waitForSelector("#cm-code");
  const code = /code: (\d{6})/.exec(await (await ctx.request.get(BASE + "/dev/mail")).text())[1];
  await p.fill("#cm-code", code);
  await Promise.all([p.waitForNavigation(), p.click(".cm-btn")]);
  await p.waitForSelector("#cm-chip");
  ok((await p.innerText("#cm-chip")).includes(EMAIL), "signed in; account chip shows the email");

  await p.fill("#ticker", T); await p.press("#ticker", "Enter");
  await p.waitForFunction(() => document.querySelectorAll("#tbl tr").length > 50, null, { timeout: 90000 });
  ok(true, T + " model loaded (" + (await p.evaluate(() => document.querySelectorAll("#tbl tr").length)) + " rows)");

  await p.click("button[data-act=tab][data-v=notes]");
  await p.click("#notesDraft");
  await p.waitForFunction(() => /Stub mode/.test(document.getElementById("notesDraftText")?.value || ""), null, { timeout: 90000 });
  ok(true, "notes draft written (stub Claude)");

  if (await p.isVisible("#xlsx")) {
    const dl = p.waitForEvent("download", { timeout: 60000 }).catch(() => null);
    await p.click("#xlsx");
    const d = await dl;
    ok(d && /\.xlsx$/.test(d.suggestedFilename()), "Excel model downloaded" + (d ? "" : " — " + (await p.innerText("#notice"))));
  }

  const me = await (await ctx.request.get(BASE + "/api/me")).json();
  ok(me.usage.used.drafts === 1 && me.usage.used.companies >= 1, "usage metered: " + JSON.stringify(me.usage.used));
  ok(me.savedModels >= 1, "model saved to the account");
  ok((await p.evaluate(() => Object.keys(localStorage).filter((k) => /^tmpl\.inp\./.test(k)).length)) >= 1, "browser keeps a copy while signed in");

  await p.click("#cm-chip"); await p.click("[data-out]");
  await p.waitForSelector("#cm-email");
  ok((await p.evaluate(() => Object.keys(localStorage).filter((k) => /^tmpl\.(inp\.|sec\.|calls-)/.test(k)).length)) === 0, "signing out clears the browser copy");
  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  console.log("\nall good");
} catch (e) {
  console.error(e.message || e);
  console.error("--- server log ---\n" + log.slice(-3000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
