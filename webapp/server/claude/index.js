// POST /api/sample: the server side of the page's sample() and sample.json(). The page sends its own prompts; this
// route recognises which prompt site each request is (so it can't be used as a general-purpose Claude proxy), swaps
// in the admin's active prompt version, checks the plan, the budget and the feature flag, then streams Claude's
// answer back as server-sent events. Without ANTHROPIC_API_KEY it answers from a labelled stub.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { nowIso } from "../db.js";
import { ApiError, fail, rateLimit, errorBody } from "../http.js";
import { requireUser, licencedForOthers } from "../auth.js";
import { checkCounter, consumeCounter, checkClaudeBudget, addClaudeSpend, costOf, recordEvent, usageWarning } from "../meter.js";
import { stubAnswer } from "./stub.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let DEFAULTS = null;
const defaults = () => (DEFAULTS = DEFAULTS || JSON.parse(fs.readFileSync(path.join(here, "prompts.default.json"), "utf8")));

const TR_HEAD = "Translate these working notes on ";
const NOTES_SPLIT = "\n\nINSTRUCTIONS:\n";
// site -> what it costs against the plan, the flag that turns it off, and the largest input it accepts (characters)
export const SITES = {
  "call.summary": { flag: "notes_drafting", counter: "drafts", consume: false, maxChars: 70_000, json: true },
  "notes.prompt": { flag: "notes_drafting", counter: "drafts", consume: true, maxChars: 400_000 },
  "notes.translate": { flag: "notes_translation", counter: "translations", consume: true, maxChars: 80_000 },
  "sec.segments": { flag: "sec_segments", counter: "segment_fills", consume: "run", maxChars: 80_000, json: true },
  "guide.release": { flag: "guidance", counter: "guidance", consume: "run", maxChars: 80_000, json: true },
  "guide.call": { flag: "guidance", counter: "guidance", consume: "run", maxChars: 80_000, json: true },
};
const RUN_GROUP = { "sec.segments": ["sec.segments"], "guide.release": ["guide.release", "guide.call"], "guide.call": ["guide.release", "guide.call"] };
const RUN_WINDOW_MS = 30 * 60 * 1000;

// which prompt this is, from its opening words (the page's prompts are fixed at build time)
export function detectSite(content) {
  const d = defaults();
  if (content.startsWith(d.NOTES_SYSTEM)) return "notes.prompt";
  if (content.startsWith(d.GUIDE_CALL_PROMPT)) return "guide.call";
  if (content.startsWith(d.GUIDE_PROMPT)) return "guide.release";
  if (content.startsWith(d.CALL_PROMPT)) return "call.summary";
  if (content.startsWith(d.SEC_PROMPT)) return "sec.segments";
  if (content.startsWith(TR_HEAD)) return "notes.translate";
  return null;
}

const CONST_OF = { "call.summary": "CALL_PROMPT", "sec.segments": "SEC_PROMPT", "guide.release": "GUIDE_PROMPT", "guide.call": "GUIDE_CALL_PROMPT" };
function activeVersion(db, site) {
  return db.get("SELECT v.* FROM prompts p JOIN prompt_versions v ON v.id = p.active_version_id WHERE p.site = ?", site);
}
// replace the page's built-in prompt text with the admin's active version, where one differs
export function applyVersions(db, site, content) {
  const d = defaults();
  const v = activeVersion(db, site === "notes.prompt" ? "notes.prompt" : site);
  let out = content, versionIds = [];
  if (CONST_OF[site]) {
    if (v) { versionIds.push(v.id); if (v.body && v.body !== d[CONST_OF[site]]) out = v.body + content.slice(d[CONST_OF[site]].length); }
  } else if (site === "notes.prompt") {
    const sys = activeVersion(db, "notes.system");
    if (sys) { versionIds.push(sys.id); if (sys.body && sys.body !== d.NOTES_SYSTEM) out = sys.body + out.slice(d.NOTES_SYSTEM.length); }
    if (v) {
      versionIds.push(v.id);
      const at = out.lastIndexOf(NOTES_SPLIT + d.NOTES_PROMPT);
      if (v.body && v.body !== d.NOTES_PROMPT && at >= 0) out = out.slice(0, at) + NOTES_SPLIT + v.body + out.slice(at + NOTES_SPLIT.length + d.NOTES_PROMPT.length);
    }
  } else if (v) versionIds.push(v.id);
  const settings = v || { model: "claude-opus-5-5", effort: "low", max_tokens: 16000, id: null };
  return { content: out, settings, versionIds };
}

// pull the JSON object out of a reply (tolerates code fences and a sentence around it)
export function parseJsonReply(text) {
  const s = String(text || "").replace(/^```(?:json)?\s*|\s*```\s*$/g, "").trim();
  try { return JSON.parse(s); } catch (e) {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  return undefined;
}

// a feature used several times in one run (several releases in one segment fill) counts once
function consumeRun(db, user, site, ticker, counter) {
  const group = RUN_GROUP[site] || [site];
  const since = new Date(Date.now() - RUN_WINDOW_MS).toISOString();
  const recent = db.get(`SELECT 1 FROM usage_events WHERE user_id = ? AND feature = 'claude' AND ticker IS ? AND site IN (${group.map(() => "?").join(",")}) AND status = 'ok' AND at >= ? LIMIT 1`,
    user.id, ticker, ...group, since);
  if (!recent) consumeCounter(db, user, counter);
}

let client = null;
const anthropic = () => (client = client || new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2, timeout: 10 * 60 * 1000 }));

// one Claude call, streamed: onText gets each delta; returns {text, stopReason, usage, model}
async function runClaude(settings, content, onText, signal) {
  const params = {
    model: settings.model,
    max_tokens: settings.max_tokens,
    messages: [{ role: "user", content }],
  };
  // Opus/Sonnet 5.x take an effort setting and the server-side refusal fallback; Haiku 4.5 takes neither
  if (!/haiku/.test(settings.model)) {
    if (settings.effort) params.output_config = { effort: settings.effort };
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const stream = anthropic().beta.messages.stream(params, { signal });
  stream.on("text", (delta) => onText(delta));
  const msg = await stream.finalMessage();
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, stopReason: msg.stop_reason, usage: msg.usage, model: msg.model || settings.model };
}

export function sampleRoutes(db) {
  const r = new Hono();
  r.use("*", requireUser);

  r.post("/", async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => null)) || {};
    // ---------- validate before the stream opens, so errors come back as plain JSON ----------
    if (user.role !== "owner" && !licencedForOthers(db)) fail(403, "not_licensed", "Claude features aren't available to other accounts yet.");
    if (user.role !== "owner" && db.get("SELECT enabled FROM feature_flags WHERE key = 'maintenance'")?.enabled) fail(503, "maintenance", "The app is in maintenance. Try again later.");
    let messages = body.input;
    if (typeof messages === "string") messages = [{ role: "user", content: messages }];
    if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== "user" || typeof messages[0].content !== "string") fail(400, "bad_request", "Expected one user message.");
    const ticker = typeof body.ticker === "string" && /^[A-Z0-9.\-^]{1,12}$/.test(body.ticker.toUpperCase()) ? body.ticker.toUpperCase() : null;
    if (!ticker) fail(400, "bad_request", "Load a company first.");
    const raw = messages[0].content;
    const site = detectSite(raw);
    if (!site) fail(400, "unknown_prompt", "This request isn't one of the app's Claude features.");
    const S = SITES[site];
    if (raw.length > S.maxChars) fail(413, "too_large", "This request is too long for Claude here.");
    // feature off: a code the page doesn't read as "Claude is unavailable in this view"
    if (!db.get("SELECT enabled FROM feature_flags WHERE key = ?", S.flag)?.enabled) fail(403, "feature_disabled", "This feature is turned off for now.");
    rateLimit("claude:" + user.id, 10, 0.2, "Claude requests");
    checkCounter(db, user, S.counter);
    const { content, settings, versionIds } = applyVersions(db, site, raw);
    // rough pre-check: the input alone, at the model's input price
    checkClaudeBudget(db, user, costOf(db, settings.model, { input_tokens: Math.ceil(content.length / 4) }));
    const wantJson = !!body.json;
    const useCache = body.cache !== false && S.json;
    const cacheKey = crypto.createHash("sha256").update([site, versionIds.join(","), settings.model, content].join("\u0000")).digest("hex");

    // ---------- answer: cache, stub or Claude, as a stream ----------
    c.header("cache-control", "no-store");
    c.header("x-accel-buffering", "no");
    return streamSSE(c, async (sse) => {
      const send = (obj) => sse.writeSSE({ data: JSON.stringify(obj) });
      const t0 = Date.now();
      const beat = setInterval(() => { sse.write(": keep-alive\n\n").catch(() => {}); }, 15000);
      const ctrl = new AbortController();
      sse.onAbort(() => ctrl.abort());
      try {
        if (useCache) {
          const hit = db.get("SELECT response FROM claude_cache WHERE key = ? AND expires_at_ms > ?", cacheKey, Date.now());
          if (hit) {
            recordEvent(db, { userId: user.id, feature: "claude", site, provider: "anthropic", ticker, cacheHit: true, model: settings.model, promptVersionId: versionIds.at(-1), ms: 0 });
            const text = hit.response;
            await send({ type: "done", text, json: wantJson ? parseJsonReply(text) : undefined, truncated: false, cached: true });
            return;
          }
        }
        let result;
        if (config.claudeStub) {
          const text = stubAnswer(site, content);
          let acc = "";
          for (const part of text.match(/[\s\S]{1,400}/g) || []) { acc += part; await send({ type: "text", text: acc }); }
          result = { text, stopReason: "end_turn", usage: { input_tokens: Math.ceil(content.length / 4), output_tokens: Math.ceil(text.length / 4) }, model: "stub" };
        } else {
          let acc = "", last = 0;
          result = await runClaude(settings, content, (delta) => {
            acc += delta;
            // the page wants the whole text so far; send it at most every 250 ms
            if (Date.now() - last > 250) { last = Date.now(); send({ type: "text", text: acc }).catch(() => {}); }
          }, ctrl.signal);
        }
        const cost = result.model === "stub" ? 0 : costOf(db, settings.model, result.usage);
        if (cost) addClaudeSpend(db, user, cost);
        const refused = result.stopReason === "refusal";
        const truncated = result.stopReason === "max_tokens";
        recordEvent(db, { userId: user.id, feature: "claude", site, provider: result.model === "stub" ? "stub" : "anthropic", ticker, model: result.model,
          inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens, cacheRead: result.usage?.cache_read_input_tokens, cacheWrite: result.usage?.cache_creation_input_tokens,
          promptVersionId: versionIds.at(-1), costUsd: cost, status: refused ? "refused" : truncated ? "truncated" : "ok", ms: Date.now() - t0 });
        if (refused) { await send({ type: "error", code: "refused", message: "Claude declined this request." }); return; }
        const json = S.json || wantJson ? parseJsonReply(result.text) : undefined;
        if (wantJson && json === undefined && !truncated) { await send({ type: "error", code: "bad_json", message: "Claude's answer wasn't valid JSON." }); return; }
        // count the use once the answer is in hand
        if (!truncated) {
          if (S.consume === true) consumeCounter(db, user, S.counter);
          else if (S.consume === "run") consumeRun(db, user, site, ticker, S.counter);
        }
        if (useCache && json !== undefined && !truncated && result.model !== "stub") {
          db.run(`INSERT INTO claude_cache (key, site, prompt_version_id, ticker, user_id, response, input_tokens, output_tokens, created_at, expires_at_ms)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING`,
            cacheKey, site, versionIds.at(-1) ?? null, ticker, user.id, result.text, result.usage?.input_tokens ?? null, result.usage?.output_tokens ?? null, nowIso(), Date.now() + 90 * 864e5);
        }
        await send({ type: "done", text: result.text, json: wantJson ? json : undefined, truncated, stub: result.model === "stub" || undefined, warning: usageWarning(db, user) || undefined });
      } catch (e) {
        const { body: b } = errorBody(e instanceof ApiError ? e : apiErrorOf(e));
        if (!(e instanceof ApiError)) db.logError("claude", b.code, e?.message || String(e), { userId: user.id, ticker, site });
        await send({ type: "error", ...b }).catch(() => {});
      } finally { clearInterval(beat); }
    });
  });
  return r;
}

// SDK errors -> the page's error codes
function apiErrorOf(e) {
  const s = e?.status;
  if (s === 429 || s === 529) return new ApiError(503, "rate_limited", "Claude is busy. Try again in a minute.", { retryable: true, retryAfterMs: 20000 });
  if (s === 401 || s === 403) return new ApiError(503, "unavailable", "Claude isn't set up on this server.");
  if (e?.name === "AbortError" || /aborted/i.test(e?.message || "")) return new ApiError(499, "aborted", "Cancelled.");
  return new ApiError(502, "claude_error", "Claude couldn't answer right now. Try again.");
}
