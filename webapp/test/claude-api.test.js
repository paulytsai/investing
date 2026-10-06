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
    // a connection that drops mid-answer
    if (/BREAK/.test(content)) { res.write(ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "half" } })); setTimeout(() => res.destroy(), 20); return; }
    // a slow answer, to hold requests in flight
    if (/SLOW/.test(content)) return setTimeout(() => finish(), 400);
    finish();
    function finish() {
    for (const part of text.match(/[\s\S]{1,7}/g)) res.write(ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: part } }));
    res.write(ev("content_block_stop", { index: 0 }));
    res.write(ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 500 } }));
    res.write(ev("message_stop", {}));
    res.end();
    }
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
after(() => mock.close());
process.env.CLAUDE_STUB = "false";
process.env.ANTHROPIC_API_KEY = "sk-test";
process.env.CLAUDE_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
const { makeApp, signIn, sseEvents, req: R } = await import("./helpers.js");
const D = JSON.parse(fs.readFileSync(new URL("../server/claude/prompts.default.json", import.meta.url), "utf8"));

test("a notes draft streams from Claude with the site's model, effort and the refusal fallback", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, "owner@example.com");
  const r = await owner.req("POST", "/api/sample", { input: [{ role: "user", content: R.notes() }], ticker: "NKE" });
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
  const body = { input: [{ role: "user", content: R.call() }], json: true, ticker: "NKE" };
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
  const ref = (await sseEvents(await owner.req("POST", "/api/sample", { input: R.tr("REFUSE"), ticker: "NKE", cache: false }))).at(-1);
  assert.equal(ref.type, "error");
  assert.equal(ref.code, "refused");
  const cut = (await sseEvents(await owner.req("POST", "/api/sample", { input: R.tr("LONG"), ticker: "NKE", cache: false }))).at(-1);
  assert.equal(cut.type, "done");
  assert.equal(cut.truncated, true);
  assert.equal((await owner.json("GET", "/api/me")).body.usage.used.translations, 0);
});

test("at most two Claude requests in flight per user; the estimate is held against the budget", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, "owner@example.com");
  const go = () => owner.req("POST", "/api/sample", { input: R.tr("SLOW"), ticker: "NKE", cache: false });
  const [a, b, c3] = await Promise.all([go(), go(), go()]);
  const statuses = [a.status, b.status, c3.status].sort();
  assert.deepEqual(statuses, [200, 200, 429]);
  for (const r of [a, b, c3]) if (r.status === 200) assert.equal((await sseEvents(r)).at(-1).type, "done");
  // with $0.30 of an $80 cap left, a request whose estimate exceeds it is refused before it reaches Claude
  db.run("UPDATE usage_period SET claude_usd = 79.70 WHERE user_id = (SELECT id FROM profiles WHERE email = 'owner@example.com')");
  const n0 = seen.length;
  const r = await owner.json("POST", "/api/sample", { input: R.notes(), ticker: "NKE" });
  assert.equal(r.status, 402);
  assert.equal(seen.length, n0);
});

test("a stream cut off midway is still billed and recorded, and the unit is given back", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, "owner@example.com");
  const ev = await sseEvents(await owner.req("POST", "/api/sample", { input: R.tr("BREAK"), ticker: "NKE", cache: false }));
  assert.equal(ev.at(-1).type, "error");
  const e = db.get("SELECT * FROM usage_events WHERE feature = 'claude' ORDER BY id DESC LIMIT 1");
  assert.equal(e.status, "error");
  assert.equal(e.input_tokens, 1000);
  assert.ok(e.cost_usd > 0);
  const used = (await owner.json("GET", "/api/me")).body.usage.used;
  assert.equal(used.translations, 0);
  assert.ok(used.claude_usd > 0);
});
