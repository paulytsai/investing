// The real Claude path (not the stub), against a local stand-in for the Messages API: request shape, streaming to the
// page, cost metering, refusals and cut-short answers.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

const seen = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const j = JSON.parse(body);
    seen.push({ url: req.url, headers: req.headers, body: j });
    const content = j.messages[0].content;
    const stop = /REFUSE/.test(content) ? "refusal" : /LONG/.test(content) ? "max_tokens" : "end_turn";
    const text = /^Summarise this earnings call/.test(content) ? '```json\n{"call":"Q1 FY2026","topics":["demand"]}\n```' : "THE STORY\nA neutral briefing.";
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_test" });
    res.write(ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } }));
    res.write(ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
    for (const part of text.match(/[\s\S]{1,7}/g)) res.write(ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: part } }));
    res.write(ev("content_block_stop", { index: 0 }));
    res.write(ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 500 } }));
    res.write(ev("message_stop", {}));
    res.end();
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
after(() => mock.close());
process.env.CLAUDE_STUB = "false";
process.env.ANTHROPIC_API_KEY = "sk-test";
process.env.CLAUDE_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
const { makeApp, signIn, sseEvents } = await import("./helpers.js");
const D = JSON.parse(fs.readFileSync(new URL("../server/claude/prompts.default.json", import.meta.url), "utf8"));

test("a notes draft streams from Claude with the site's model, effort and the refusal fallback", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, "owner@example.com");
  const r = await owner.req("POST", "/api/sample", { input: [{ role: "user", content: D.NOTES_SYSTEM + "\n\nDOCS\n\nINSTRUCTIONS:\n" + D.NOTES_PROMPT }], ticker: "NKE" });
  const ev = await sseEvents(r);
  const done = ev.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.text, "THE STORY\nA neutral briefing.");
  assert.equal(done.truncated, false);
  const sent = seen.at(-1);
  assert.equal(sent.url, "/v1/messages?beta=true");
  assert.equal(sent.headers["x-api-key"], "sk-test");
  assert.match(sent.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.model, "claude-opus-5-5");
  assert.equal(sent.body.fallbacks, "default");
  assert.deepEqual(sent.body.output_config, { effort: "medium" });
  assert.equal(sent.body.max_tokens, 64000);
  assert.equal(sent.body.stream, true);
  // metered at the model's price: 1,000 input and 500 output tokens at $4 / $20 per million
  const e = db.get("SELECT * FROM usage_events WHERE feature = 'claude' ORDER BY id DESC LIMIT 1");
  assert.equal(e.provider, "anthropic");
  assert.equal(e.input_tokens, 1000);
  assert.equal(e.output_tokens, 500);
  assert.ok(Math.abs(e.cost_usd - 0.014) < 1e-9);
  assert.ok(Math.abs((await owner.json("GET", "/api/me")).body.usage.used.claude_usd - 0.014) < 1e-6);
});

test("JSON answers are parsed and cached; a cached answer costs nothing", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, "owner@example.com");
  const body = { input: [{ role: "user", content: D.CALL_PROMPT + "\n\nTranscript (2026Q1):\nhello" }], json: true, ticker: "NKE" };
  const n0 = seen.length;
  const a = (await sseEvents(await owner.req("POST", "/api/sample", body))).at(-1);
  assert.deepEqual(a.json, { call: "Q1 FY2026", topics: ["demand"] });
  const b = (await sseEvents(await owner.req("POST", "/api/sample", body))).at(-1);
  assert.equal(b.cached, true);
  assert.deepEqual(b.json, a.json);
  assert.equal(seen.length, n0 + 1, "second request answered from the cache");
});

test("refusals and cut-short answers are reported, not counted as uses", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, "owner@example.com");
  const ref = (await sseEvents(await owner.req("POST", "/api/sample", { input: "Translate these working notes on X from English into Japanese.\nNOTES:\nREFUSE", ticker: "NKE", cache: false }))).at(-1);
  assert.equal(ref.type, "error");
  assert.equal(ref.code, "refused");
  const cut = (await sseEvents(await owner.req("POST", "/api/sample", { input: "Translate these working notes on X from English into Japanese.\nNOTES:\nLONG", ticker: "NKE", cache: false }))).at(-1);
  assert.equal(cut.type, "done");
  assert.equal(cut.truncated, true);
  assert.equal((await owner.json("GET", "/api/me")).body.usage.used.translations, 0);
});
