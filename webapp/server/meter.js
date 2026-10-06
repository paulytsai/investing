// Plans, entitlements and metering. The server decides; the browser only shows what /api/me reports.
// Counters live in usage_period (one row per user per billing period); every upstream call and every Claude call is
// also written to usage_events with its cost, so the admin area can show cost against revenue per user.
import { nowIso } from "./db.js";
import { fail } from "./http.js";

const COUNTERS = new Set(["drafts", "translations", "guidance", "segment_fills", "exports"]);
const LIMIT_OF = { drafts: "drafts", translations: "translations", guidance: "guidance", segment_fills: "segment_fills", exports: "exports" };

export function billingEnabled(db) { return !!db.getConfig("billing")?.enabled; }

// active subscription states that grant the plan; past_due keeps access until grace_until.
// Only subscriptions from the mode billing runs in: leftover test-mode ones grant nothing once billing is live
function activeSubscription(db, userId) {
  const b = db.getConfig("billing") || {};
  const s = db.get("SELECT * FROM subscriptions WHERE user_id = ? AND livemode = ? AND status IN ('active', 'trialing', 'past_due') ORDER BY synced_at DESC LIMIT 1", userId, b.enabled && b.live ? 1 : 0);
  if (!s) return null;
  if (s.status === "past_due") {
    if (!s.grace_until || Date.parse(s.grace_until) < Date.now()) return null;
    // grace is for customers who have paid before; a trial whose first charge failed gets none
    if (!db.get("SELECT 1 FROM invoices WHERE subscription_id = ? AND status = 'paid' AND amount_paid > 0", s.id)) return null;
  }
  return s;
}
// for choosing between a complimentary plan and a subscription: the better one wins
const RANK = { free: 0, trial: 1, comp: 2, plus: 2, pro: 3 };

export function planFor(db, user) {
  if (user.role === "owner") return { planId: "owner", source: "owner" };
  const comp = db.get("SELECT plan_id FROM comps WHERE user_id = ? AND (until IS NULL OR until > ?) ORDER BY id DESC LIMIT 1", user.id, nowIso());
  const sub = billingEnabled(db) ? activeSubscription(db, user.id) : null;
  if (sub && sub.plan_id && (!comp || (RANK[sub.plan_id] ?? 0) >= (RANK[comp.plan_id] ?? 0))) return { planId: sub.plan_id, source: "subscription", subscription: sub };
  if (comp) return { planId: comp.plan_id, source: "comp" };
  // with billing off, invited users are complimentary; with billing on, they start on the free plan
  return { planId: billingEnabled(db) ? "free" : "comp", source: "default" };
}

export function limitsFor(db, user) {
  const p = planFor(db, user);
  const row = db.get("SELECT name, limits FROM plans WHERE id = ?", p.planId) || db.get("SELECT name, limits FROM plans WHERE id = 'free'");
  return { ...p, planName: row.name, limits: JSON.parse(row.limits) };
}

// billing period: the subscription's, otherwise the calendar month (UTC)
export function periodFor(db, user, plan = planFor(db, user)) {
  const s = plan.subscription;
  // the subscription's period while it's current; past its end (a renewal event missed), the calendar month
  if (s && s.current_period_start && s.current_period_end && Date.parse(s.current_period_end) > Date.now()) return { start: s.current_period_start, end: s.current_period_end };
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
  return { start, end };
}

function usageRow(db, user, period) {
  db.run("INSERT INTO usage_period (user_id, period_start, period_end) VALUES (?, ?, ?) ON CONFLICT (user_id, period_start) DO NOTHING", user.id, period.start, period.end);
  return db.get("SELECT * FROM usage_period WHERE user_id = ? AND period_start = ?", user.id, period.start);
}

export function usageFor(db, user) {
  const L = limitsFor(db, user), period = periodFor(db, user, L);
  const u = usageRow(db, user, period);
  return { plan: { id: L.planId, name: L.planName, source: L.source }, period, limits: L.limits, used: {
    companies: u.company_loads, drafts: u.drafts, translations: u.translations, guidance: u.guidance,
    segment_fills: u.segment_fills, exports: u.exports, claude_usd: Math.round(u.claude_usd * 10000) / 10000 } };
}

const over = (used, lim, add = 1) => lim !== null && lim !== undefined && used + add > lim;
const quota = (what, lim) => fail(402, "quota_exceeded", `Your plan includes ${lim} ${what} a month, and they're used up. They reset at the start of the next period.`, { limit: what });

// the page opens on MSFT for a first-time visitor, so that one is free: it mustn't use up a free plan's companies
export const DEMO_TICKER = "MSFT";

// before fetching: refuse a company that would go over the plan's limit (one already counted is fine)
export function checkCompany(db, user, ticker) {
  if (!ticker || ticker === DEMO_TICKER) return;
  const L = limitsFor(db, user), period = periodFor(db, user, L);
  if (db.get("SELECT 1 FROM period_tickers WHERE user_id = ? AND period_start = ? AND ticker = ?", user.id, period.start, ticker)) return;
  const u = usageRow(db, user, period);
  if (over(u.company_loads, L.limits.companies)) quota("companies", L.limits.companies);
}

// a company counts once per period, once it has loaded (a typo or a failed fetch doesn't count); reloading is free
export function registerCompany(db, user, ticker) {
  if (!ticker || ticker === DEMO_TICKER) return;
  return db.tx(() => {
    const L = limitsFor(db, user), period = periodFor(db, user, L);
    const seen = db.get("SELECT 1 FROM period_tickers WHERE user_id = ? AND period_start = ? AND ticker = ?", user.id, period.start, ticker);
    if (seen) return false;
    const u = usageRow(db, user, period);
    if (over(u.company_loads, L.limits.companies)) quota("companies", L.limits.companies);
    db.run("INSERT INTO period_tickers (user_id, period_start, ticker, first_at) VALUES (?, ?, ?, ?)", user.id, period.start, ticker, nowIso());
    db.run("UPDATE usage_period SET company_loads = company_loads + 1 WHERE user_id = ? AND period_start = ?", user.id, period.start);
    return true;
  });
}

// check (and optionally use) one unit of a counted feature
export function checkCounter(db, user, counter) {
  if (!COUNTERS.has(counter)) throw new Error("unknown counter " + counter);
  const L = limitsFor(db, user), u = usageRow(db, user, periodFor(db, user, L));
  const lim = L.limits[LIMIT_OF[counter]];
  if (over(u[counter], lim)) quota(counter.replace("_", " "), lim);
}
export function consumeCounter(db, user, counter, n = 1) {
  return db.tx(() => {
    checkCounter(db, user, counter);
    const L = limitsFor(db, user), period = periodFor(db, user, L);
    db.run(`UPDATE usage_period SET ${counter} = ${counter} + ? WHERE user_id = ? AND period_start = ?`, n, user.id, period.start);
  });
}

// give back a unit taken before a call that then failed
export function refundCounter(db, user, counter) {
  if (!COUNTERS.has(counter)) throw new Error("unknown counter " + counter);
  const period = periodFor(db, user);
  db.run(`UPDATE usage_period SET ${counter} = MAX(${counter} - 1, 0) WHERE user_id = ? AND period_start = ?`, user.id, period.start);
}

// Claude spend: a per-user hard cap per period, a soft cap that warns, and a global daily cap (owner exempt)
export function claudeBudget(db, user) {
  const L = limitsFor(db, user), u = usageRow(db, user, periodFor(db, user, L));
  return { used: u.claude_usd, soft: L.limits.claude_soft_usd, hard: L.limits.claude_hard_usd };
}
// estimateUsd: this request's estimate plus the user's other requests in flight; pendingGlobalUsd: everyone's in flight
export function checkClaudeBudget(db, user, estimateUsd = 0, pendingGlobalUsd = 0) {
  const b = claudeBudget(db, user);
  if (b.hard !== null && b.hard !== undefined && b.used + estimateUsd > b.hard) {
    fail(402, "quota_exceeded", b.hard === 0 ? "Claude features aren't included in your plan." : `You've reached this period's Claude budget ($${b.hard}).`, { limit: "claude_usd" });
  }
  if (user.role !== "owner") {
    const day = db.getConfig("budgets")?.global_claude_usd_day;
    if (day) {
      const since = new Date(); since.setUTCHours(0, 0, 0, 0);
      const spent = db.get("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_events WHERE provider = 'anthropic' AND at >= ?", since.toISOString()).s;
      if (spent + pendingGlobalUsd >= day) fail(503, "busy", "Claude features are paused for today. Try again tomorrow.", { retryable: false });
    }
  }
  return b;
}
export function addClaudeSpend(db, user, usd) {
  const period = periodFor(db, user);
  usageRow(db, user, period);
  db.run("UPDATE usage_period SET claude_usd = claude_usd + ? WHERE user_id = ? AND period_start = ?", usd, user.id, period.start);
}
// a soft-cap warning the shim shows as a notice
export function usageWarning(db, user) {
  const b = claudeBudget(db, user);
  if (b.soft && b.used >= b.soft) return "claude_soft_cap";
  return null;
}

// upstream data calls per user per day (scraping guard)
export function checkDailyCalls(db, user, providers) {
  const L = limitsFor(db, user), lim = L.limits.fmp_calls_day;
  if (lim === null || lim === undefined) return;
  const list = [].concat(providers);
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const n = db.get(`SELECT COUNT(*) AS n FROM usage_events WHERE user_id = ? AND provider IN (${list.map(() => "?").join(",")}) AND cache_hit = 0 AND at >= ?`, user.id, ...list, since.toISOString()).n;
  if (n >= lim) fail(402, "quota_exceeded", "You've reached today's data limit for your plan. It resets at midnight UTC.", { limit: "fmp_calls_day" });
}

export function costOf(db, model, usage) {
  const p = db.get("SELECT * FROM model_prices WHERE model = ? ORDER BY effective_from DESC LIMIT 1", model);
  if (!p || !usage) return 0;
  const inT = usage.input_tokens || 0, outT = usage.output_tokens || 0, cw = usage.cache_creation_input_tokens || 0, cr = usage.cache_read_input_tokens || 0;
  return (inT * p.input_per_mtok + outT * p.output_per_mtok + cw * p.cache_write_per_mtok + cr * p.cache_read_per_mtok) / 1e6;
}

export function recordEvent(db, ev) {
  db.run(`INSERT INTO usage_events (at, user_id, feature, site, provider, ticker, endpoint, cache_hit, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, model, prompt_version_id, cost_usd, status, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nowIso(), ev.userId || null, ev.feature, ev.site || null, ev.provider, ev.ticker || null, ev.endpoint || null, ev.cacheHit ? 1 : 0,
    ev.inputTokens ?? null, ev.outputTokens ?? null, ev.cacheRead ?? null, ev.cacheWrite ?? null, ev.model || null, ev.promptVersionId ?? null,
    ev.costUsd || 0, ev.status || "ok", ev.ms ?? null);
}
