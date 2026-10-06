// POST /api/sample: the server side of the page's sample() and sample.json(). The page sends its own prompts; this
// route accepts a request only if it has exactly the shape the page builds (the prompt, the page's separators, and
// for a notes draft nothing after its instructions), swaps in the admin's active prompt version, checks the plan,
// the budget and the feature flag, then streams Claude's answer back as server-sent events. Data-extraction sites
// return JSON only. Budget and quota are reserved before the call and settled after it, so parallel requests can't
// overrun them. Without ANTHROPIC_API_KEY it answers from a labelled stub.
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
import { checkCounter, consumeCounter, refundCounter, checkClaudeBudget, addClaudeSpend, costOf, recordEvent, usageWarning, limitsFor, periodFor } from "../meter.js";
import { stubAnswer } from "./stub.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let DEFAULTS = null;
const defaults = () => (DEFAULTS = DEFAULTS || JSON.parse(fs.readFileSync(path.join(here, "prompts.default.json"), "utf8")));

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
// a notes draft reads up to 12 call summaries; allow that many per draft in the plan (and one draft's worth spare)
const CALLS_PER_DRAFT = 12;

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let SHAPES = null;
function shapes() {
  if (SHAPES) return SHAPES;
  const d = defaults();
  const langs = "(" + Object.values(d.LANG_NAME).map(reEsc).join("|") + ")";
  const tr = new RegExp("^" + reEsc(d.NOTES_TR_TEMPLATE).replace("\u0001NAME\u0001", "[^\\n]{1,200}?").replace("\u0001FROM\u0001", langs).replace("\u0001TO\u0001", langs).replace("\u0001TEXT\u0001", "[\\s\\S]*") + "$");
  const notesTails = ["", d.NOTES_LANG.ja, d.NOTES_LANG.zh].map((x) => NOTES_SPLIT + d.NOTES_PROMPT + x);
  return (SHAPES = { tr, notesTails, call: new RegExp("^" + reEsc(d.CALL_PROMPT) + "\\n\\nTranscript \\([^\\n()]{1,40}\\):\\n") });
}

// which prompt site this is, if the request has exactly the shape the page builds; otherwise null
export function detectSite(content) {
  const d = defaults(), S = shapes();
  if (content.startsWith(d.NOTES_SYSTEM + "\n\nDOCUMENTS FOR ") && S.notesTails.some((t) => content.endsWith(t))) return "notes.prompt";
  if (content.startsWith(d.GUIDE_CALL_PROMPT + "\n\nCONTEXT: ") && content.includes("\n\nTranscript:\n")) return "guide.call";
  if (content.startsWith(d.GUIDE_PROMPT + "\n\nRelease:\n")) return "guide.release";
  if (S.call.test(content)) return "call.summary";
  if (content.startsWith(d.SEC_PROMPT + "\n\nTables:\n")) return "sec.segments";
  if (S.tr.test(content)) return "notes.translate";
  return null;
}

// what a JSON site must return; anything else is treated as a failed answer
const JSON_SHAPE = {
  "call.summary": (j) => !!j && typeof j === "object" && !Array.isArray(j),
  "sec.segments": (j) => !!j && Array.isArray(j.periods),
  "guide.release": (j) => !!j && Array.isArray(j.periods),
  "guide.call": (j) => !!j && Array.isArray(j.periods),
};

const CONST_OF = { "call.summary": "CALL_PROMPT", "sec.segments": "SEC_PROMPT", "guide.release": "GUIDE_PROMPT", "guide.call": "GUIDE_CALL_PROMPT" };
function activeVersion(db, site) {
  return db.get("SELECT v.* FROM prompts p JOIN prompt_versions v ON v.id = p.active_version_id WHERE p.site = ?", site);
}
// replace the page's built-in prompt text with the admin's active version, where one differs
export function applyVersions(db, site, content) {
  const d = defaults();
  const v = activeVersion(db, site);
  let out = content, versionIds = [];
  if (CONST_OF[site]) {
    if (v) { versionIds.push(v.id); if (v.body && v.body !== d[CONST_OF[site]]) out = v.body + content.slice(d[CONST_OF[site]].length); }
  } else if (site === "notes.prompt") {
    const sys = activeVersion(db, "notes.system");
    if (sys) { versionIds.push(sys.id); if (sys.body && sys.body !== d.NOTES_SYSTEM) out = sys.body + out.slice(d.NOTES_SYSTEM.length); }
    if (v) {
      versionIds.push(v.id);
      // the instructions sit at the end, before the optional language line (detectSite checked the shape)
      const tail = shapes().notesTails.find((t) => out.endsWith(t));
      if (v.body && v.body !== d.NOTES_PROMPT && tail) out = out.slice(0, out.length - tail.length) + NOTES_SPLIT + v.body + tail.slice(NOTES_SPLIT.length + d.NOTES_PROMPT.length);
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

// a feature used several times in one run (several releases in one segment fill) counts once; true if it counted
function consumeRun(db, user, site, ticker, counter) {
  const group = RUN_GROUP[site] || [site];
  const since = new Date(Date.now() - RUN_WINDOW_MS).toISOString();
  const recent = db.get(`SELECT 1 FROM usage_events WHERE user_id = ? AND feature = 'claude' AND ticker IS ? AND site IN (${group.map(() => "?").join(",")}) AND status = 'ok' AND at >= ? LIMIT 1`,
    user.id, ticker, ...group, since);
  if (recent) return false;
  consumeCounter(db, user, counter);
  return true;
}

// call summaries are part of drafting: capped at CALLS_PER_DRAFT for every draft the plan includes
function checkCallSummaries(db, user) {
  const L = limitsFor(db, user), lim = L.limits.drafts;
  if (lim === null || lim === undefined) return;
  const since = periodFor(db, user, L).start;
  const n = db.get("SELECT COUNT(*) AS n FROM usage_events WHERE user_id = ? AND feature = 'claude' AND site = 'call.summary' AND cache_hit = 0 AND at >= ?", user.id, since).n;
  if (n >= (lim + 1) * CALLS_PER_DRAFT) fail(402, "quota_exceeded", "You've used this period's earnings-call summaries. They reset at the start of the next period.", { limit: "drafts" });
}

// requests in flight: at most MAX_INFLIGHT per user, with their estimated cost held against the budgets
const MAX_INFLIGHT = 2;
const inflight = new Map();
let pendingUsd = 0;
// what a request may cost: its input, and output up to a typical long answer (adaptive thinking included)
const estimateUsd = (db, settings, content) => costOf(db, settings.model, { input_tokens: Math.ceil(content.length / 4), output_tokens: Math.min(settings.max_tokens, 16000) });

let client = null;
const anthropic = () => (client = client || new Anthropic({ apiKey: config.anthropicApiKey, baseURL: config.claudeBaseUrl, maxRetries: 2, timeout: 10 * 60 * 1000 }));

// one Claude call, streamed: onText gets each delta; returns {text, stopReason, usage, model}. On failure the error
// carries the usage so far (a cut-off stream is still billed).
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
  try {
    const msg = await stream.finalMessage();
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, stopReason: msg.stop_reason, usage: msg.usage, model: msg.model || settings.model };
  } catch (e) {
    try { if (e && typeof e === "object") e.partialUsage = stream.currentMessage?.usage; } catch (_) {}
    throw e;
  }
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
    const S0 = Object.values(SITES).reduce((m, x) => Math.max(m, x.maxChars), 0);
    if (raw.length > S0) fail(413, "too_large", "This request is too long for Claude here.");
    const site = detectSite(raw);
    if (!site) fail(400, "unknown_prompt", "This request isn't one of the app's Claude features.");
    const S = SITES[site];
    if (raw.length > S.maxChars) fail(413, "too_large", "This request is too long for Claude here.");
    // feature off: a code the page doesn't read as "Claude is unavailable in this view"
    if (!db.get("SELECT enabled FROM feature_flags WHERE key = ?", S.flag)?.enabled) fail(403, "feature_disabled", "This feature is turned off for now.");
    // a notes draft is up to 12 call summaries and the draft; a segment fill reads up to 9 releases. Cost is held in
    // check by the in-flight cap and the reserved budget; this only stops runaway loops.
    rateLimit("claude:" + user.id, 40, 0.5, "Claude requests");
    checkCounter(db, user, S.counter);
    const { content, settings, versionIds } = applyVersions(db, site, raw);
    const json = !!S.json;
    const useCache = body.cache !== false && json;
    const cacheKey = crypto.createHash("sha256").update([site, versionIds.join(","), settings.model, content].join("\u0000")).digest("hex");
    c.header("cache-control", "no-store");
    c.header("x-accel-buffering", "no");

    // a cached answer: free, no reservation
    const hit = useCache ? db.get("SELECT response FROM claude_cache WHERE key = ? AND expires_at_ms > ?", cacheKey, Date.now()) : null;
    if (hit) {
      recordEvent(db, { userId: user.id, feature: "claude", site, provider: "anthropic", ticker, cacheHit: true, model: settings.model, promptVersionId: versionIds.at(-1), ms: 0 });
      return streamSSE(c, (sse) => sse.writeSSE({ data: JSON.stringify({ type: "done", text: hit.response, json: parseJsonReply(hit.response), truncated: false, cached: true }) }));
    }

    // reserve: a slot, the estimated cost against the budgets, and the plan's unit (refunded if the call fails)
    const mine = inflight.get(user.id) || { n: 0, usd: 0 };
    if (mine.n >= MAX_INFLIGHT) fail(429, "rate_limited", "Claude is already working on requests for you. Try again when they finish.", { retryable: true, retryAfterMs: 5000 });
    const est = estimateUsd(db, settings, content);
    checkClaudeBudget(db, user, mine.usd + est, pendingUsd + est);
    if (site === "call.summary") checkCallSummaries(db, user);
    let took = false;
    if (S.consume === true) { consumeCounter(db, user, S.counter); took = true; }
    else if (S.consume === "run") took = consumeRun(db, user, site, ticker, S.counter);
    mine.n++; mine.usd += est; pendingUsd += est; inflight.set(user.id, mine);
    const release = () => { mine.n--; mine.usd -= est; pendingUsd -= est; if (mine.n <= 0) inflight.delete(user.id); };

    // ---------- answer: stub or Claude, as a stream ----------
    return streamSSE(c, async (sse) => {
      const send = (obj) => sse.writeSSE({ data: JSON.stringify(obj) });
      const t0 = Date.now();
      const beat = setInterval(() => { sse.write(": keep-alive\n\n").catch(() => {}); }, 15000);
      const ctrl = new AbortController();
      sse.onAbort(() => ctrl.abort());
      let status = "error", usage = null, model = settings.model, provider = config.claudeStub ? "stub" : "anthropic";
      try {
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
            // the page wants the whole text so far; send it at most every 250 ms (JSON sites get only the result)
            if (!json && Date.now() - last > 250) { last = Date.now(); send({ type: "text", text: acc }).catch(() => {}); }
          }, ctrl.signal);
        }
        usage = result.usage; model = result.model;
        const refused = result.stopReason === "refusal";
        const truncated = result.stopReason === "max_tokens";
        const parsed = json && !refused ? parseJsonReply(result.text) : undefined;
        const badJson = json && !refused && !truncated && !JSON_SHAPE[site](parsed);
        status = refused ? "refused" : truncated ? "truncated" : badJson ? "bad_json" : "ok";
        if (refused) { await send({ type: "error", code: "refused", message: "Claude declined this request." }); return; }
        if (badJson) { await send({ type: "error", code: "bad_json", message: "Claude's answer wasn't the data this feature expects." }); return; }
        // JSON sites send back only the parsed data, nothing around it
        const text = json && parsed !== undefined ? JSON.stringify(parsed) : result.text;
        if (useCache && status === "ok" && provider !== "stub") {
          db.run(`INSERT INTO claude_cache (key, site, prompt_version_id, ticker, user_id, response, input_tokens, output_tokens, created_at, expires_at_ms)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING`,
            cacheKey, site, versionIds.at(-1) ?? null, ticker, user.id, text, usage?.input_tokens ?? null, usage?.output_tokens ?? null, nowIso(), Date.now() + 90 * 864e5);
        }
        await send({ type: "done", text, json: json ? parsed : undefined, truncated, stub: provider === "stub" || undefined, warning: usageWarning(db, user) || undefined });
      } catch (e) {
        if (e && e.partialUsage) usage = e.partialUsage;
        const err = e instanceof ApiError ? e : apiErrorOf(e);
        status = err.code === "aborted" ? "aborted" : "error";
        if (!(e instanceof ApiError) && err.code !== "aborted") db.logError("claude", err.code, e?.message || String(e), { userId: user.id, ticker, site });
        await send({ type: "error", ...errorBody(err).body }).catch(() => {});
      } finally {
        clearInterval(beat);
        release();
        // settle: every call that reached Claude is recorded with its cost, whatever happened after
        try {
          const cost = provider === "stub" || !usage ? 0 : costOf(db, settings.model, usage);
          if (cost) addClaudeSpend(db, user, cost);
          if (took && status !== "ok") refundCounter(db, user, S.counter);
          recordEvent(db, { userId: user.id, feature: "claude", site, provider, ticker, model,
            inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, cacheRead: usage?.cache_read_input_tokens, cacheWrite: usage?.cache_creation_input_tokens,
            promptVersionId: versionIds.at(-1), costUsd: cost, status, ms: Date.now() - t0 });
        } catch (e) { console.error("[claude] settling failed", e); }
      }
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
