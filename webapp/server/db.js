// SQLite through Node's built-in node:sqlite (no native dependency). One connection, synchronous calls, WAL mode.
// Every table maps one-to-one to Postgres, so moving to Supabase later is a port of this file, not a redesign.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_VERSION = 1;

export const nowIso = () => new Date().toISOString();

export function openDb(file = path.join(config.dataDir, "app.db")) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(fs.readFileSync(path.join(here, "schema.sql"), "utf8"));
  migrate(db);
  const v = db.prepare("SELECT version FROM schema_version").get();
  if (!v) db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  seed(db);
  return wrap(db);
}

// columns added after a database was created (CREATE TABLE IF NOT EXISTS doesn't add them)
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has("sessions", "aal_at")) db.exec("ALTER TABLE sessions ADD COLUMN aal_at INTEGER");
}

// small helpers over the raw connection
function wrap(db) {
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  return {
    raw: db,
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    exec: (sql) => db.exec(sql),
    // run fn inside one transaction; nested calls join the outer one
    tx(fn) {
      if (this._inTx) return fn();
      this._inTx = true;
      db.exec("BEGIN IMMEDIATE");
      try { const r = fn(); db.exec("COMMIT"); return r; }
      catch (e) { try { db.exec("ROLLBACK"); } catch (_) {} throw e; }
      finally { this._inTx = false; }
    },
    getConfig(key) { const r = stmt("SELECT value FROM app_config WHERE key = ?").get(key); return r ? JSON.parse(r.value) : null; },
    setConfig(key, value, by) {
      stmt("INSERT INTO app_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
        .run(key, JSON.stringify(value), by || null, nowIso());
    },
    audit(actorId, action, target, before, after) {
      stmt("INSERT INTO audit_log (at, actor_id, action, target, before, after) VALUES (?, ?, ?, ?, ?, ?)")
        .run(nowIso(), actorId || null, action, target || null, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after));
    },
    logError(source, code, message, ctx = {}) {
      stmt("INSERT INTO error_log (at, source, code, message, user_id, ticker, context) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(nowIso(), source, code || null, String(message || "").slice(0, 2000), ctx.userId || null, ctx.ticker || null, JSON.stringify(ctx).slice(0, 4000));
    },
  };
}

// ---------- seed data: defaults that the admin area can change later ----------
export const PLAN_SEED = [
  // limits: null = unlimited. claude_* in US$ per period. Company loads count distinct tickers per period.
  ["owner", "Owner", { companies: null, saved_models: null, drafts: null, translations: null, guidance: null, segment_fills: null, exports: null, claude_soft_usd: 40, claude_hard_usd: 80, fmp_calls_day: null }, 0],
  ["comp", "Complimentary", { companies: 30, saved_models: 150, drafts: 6, translations: 6, guidance: 100, segment_fills: 4, exports: 100, claude_soft_usd: 10, claude_hard_usd: 15, fmp_calls_day: 1500 }, 1],
  ["free", "Free", { companies: 3, saved_models: 3, drafts: 0, translations: 0, guidance: 0, segment_fills: 0, exports: 5, claude_soft_usd: 0, claude_hard_usd: 0, fmp_calls_day: 200 }, 2],
  ["trial", "Trial", { companies: 8, saved_models: 20, drafts: 2, translations: 2, guidance: 20, segment_fills: 1, exports: 10, claude_soft_usd: 3, claude_hard_usd: 4, fmp_calls_day: 600 }, 3],
  ["plus", "Plus", { companies: 30, saved_models: 150, drafts: 6, translations: 6, guidance: 100, segment_fills: 4, exports: 100, claude_soft_usd: 10, claude_hard_usd: 15, fmp_calls_day: 1500 }, 4],
  ["pro", "Pro", { companies: 120, saved_models: 1000, drafts: 25, translations: 25, guidance: 400, segment_fills: 15, exports: 500, claude_soft_usd: 30, claude_hard_usd: 45, fmp_calls_day: 4000 }, 5],
];

export const MODEL_PRICE_SEED = [
  // per million tokens: input, output, 5-minute cache write, cache read (Anthropic price list)
  ["claude-opus-5-5", 4, 20, 5, 0.2],
  ["claude-sonnet-5-5", 2, 10, 2.5, 0.2],
  ["claude-haiku-4-5", 1, 5, 1.25, 0.1],
  ["claude-fable-5-1", 10, 50, 12.5, 0.25],
];

export const FLAG_SEED = [
  ["notes_drafting", "Claude drafts research notes from calls and filings", 1],
  ["notes_translation", "Claude translates an existing notes draft", 1],
  ["guidance", "Claude reads guidance from earnings releases and calls", 1],
  ["sec_segments", "Claude reads quarterly segment tables from SEC releases", 1],
  ["exports", "Excel and PDF downloads", 1],
  ["maintenance", "Maintenance mode: only the owner can use the app", 0],
];

// prompt sites: the page's own prompts are version 1; the admin area adds versions
export const PROMPT_SITES = [
  // site, constant in page.html (null = built in page code, not editable here), json, description, effort, max_tokens
  ["call.summary", "CALL_PROMPT", 1, "Summary of one earnings call transcript (cached per call)", "low", 16000],
  ["notes.system", "NOTES_SYSTEM", 0, "Notes draft: the research agent's role and rules", "medium", 64000],
  ["notes.prompt", "NOTES_PROMPT", 0, "Notes draft: sections and instructions", "medium", 64000],
  ["notes.translate", null, 0, "Translation of an existing draft (built in page code)", "low", 32000],
  ["sec.segments", "SEC_PROMPT", 1, "Segment tables from an 8-K earnings release", "low", 16000],
  ["guide.release", "GUIDE_PROMPT", 1, "Guidance from an 8-K earnings release", "low", 16000],
  ["guide.call", "GUIDE_CALL_PROMPT", 1, "Guidance from an earnings call transcript", "low", 16000],
];
export const DEFAULT_MODEL = "claude-opus-5-5";

function seed(db) {
  const now = nowIso();
  const has = (sql, ...p) => !!db.prepare(sql).get(...p);
  const setDefault = (key, value) => { if (!has("SELECT 1 FROM app_config WHERE key = ?", key)) db.prepare("INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)").run(key, JSON.stringify(value), now); };
  // licences gate everything that shows FMP or Edgar Tools data to anyone but the owner
  setDefault("licences", { fmp_display: null, edgar_tools_display: null, legal: null });
  setDefault("billing", { enabled: false, live: false });
  setDefault("signups", { open: false });
  setDefault("budgets", { global_claude_usd_day: 15 });
  for (const [key, description, enabled] of FLAG_SEED) {
    if (!has("SELECT 1 FROM feature_flags WHERE key = ?", key)) db.prepare("INSERT INTO feature_flags (key, description, enabled) VALUES (?, ?, ?)").run(key, description, enabled);
  }
  for (const [id, name, limits, sort] of PLAN_SEED) {
    if (!has("SELECT 1 FROM plans WHERE id = ?", id)) db.prepare("INSERT INTO plans (id, name, limits, sort) VALUES (?, ?, ?, ?)").run(id, name, JSON.stringify(limits), sort);
  }
  for (const [model, i, o, cw, cr] of MODEL_PRICE_SEED) {
    if (!has("SELECT 1 FROM model_prices WHERE model = ?", model)) db.prepare("INSERT INTO model_prices (model, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, effective_from) VALUES (?, ?, ?, ?, ?, ?)").run(model, i, o, cw, cr, "2026-01-01");
  }
  let defaults = {};
  try { defaults = JSON.parse(fs.readFileSync(path.join(here, "claude", "prompts.default.json"), "utf8")); } catch (e) { /* run `npm run build` first */ }
  for (const [site, constant, json, description, effort, maxTokens] of PROMPT_SITES) {
    if (!has("SELECT 1 FROM prompts WHERE site = ?", site)) db.prepare("INSERT INTO prompts (site, description, json_site) VALUES (?, ?, ?)").run(site, description, json);
    const body = constant ? defaults[constant] : "";
    if (constant && !body) continue;
    if (!has("SELECT 1 FROM prompt_versions WHERE site = ?", site)) {
      const r = db.prepare("INSERT INTO prompt_versions (site, version, body, model, effort, max_tokens, note, created_by, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)")
        .run(site, body || "", DEFAULT_MODEL, effort, maxTokens, "Version 1: the prompt as written in page.html", "build", now);
      db.prepare("UPDATE prompts SET active_version_id = ? WHERE site = ?").run(Number(r.lastInsertRowid), site);
    }
  }
}
