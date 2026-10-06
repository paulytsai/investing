// Admin API, mounted at /api/admin (the data-quality routes under /dq belong to dq/index.js). Admins can read
// everything here and run the day-to-day actions; changes that shape the business (roles, admin invites, maintenance,
// prompt activation, settings, plans) are the owner's. Every change writes an audit row. Admins see counts, usage
// and cost per user, never the contents of anyone's documents.
import { Hono } from "hono";
import { config } from "../config.js";
import { nowIso, PLAN_SEED, PROMPT_SITES } from "../db.js";
import { fail } from "../http.js";
import { requireAdmin, licencedForOthers } from "../auth.js";
import { limitsFor, usageFor } from "../meter.js";

const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();
const dayStart = (ms = Date.now()) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const monthStart = (ms = Date.now()) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TICKER = /^[A-Z0-9.\-^]{1,12}$/;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const LIMIT_KEYS = Object.keys(PLAN_SEED[0][2]);
const LICENCES = ["fmp_display", "edgar_tools_display", "legal"];
const ROLES = ["user", "admin"];
const STATUSES = ["active", "disabled"];
// never select totp_secret or anything else private into an admin response
const PROFILE_COLS = "id, email, role, status, locale, trial_used, totp_enrolled, created_at, last_seen_at";

async function body(c) {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) fail(400, "bad_request", "Expected a JSON object.");
  return b;
}
const intParam = (v, d, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const ownerOnly = (c) => { if (c.get("user").role !== "owner") fail(403, "forbidden", "Only the owner can change this."); };
const parseJson = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch (e) { return s; } };
const text = (v, max, what) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > max) fail(400, "bad_request", `${what} must be text of at most ${max} characters.`);
  return v.trim() || null;
};
// a YYYY-MM-DD that is a real calendar date (Date.parse rolls 02-30 over into March)
const isDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && iso(t).slice(0, 10) === s;
};
const likeEsc = (s) => "%" + s.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
const round = (x, dp = 6) => Math.round((x || 0) * 10 ** dp) / 10 ** dp;
const emailOf = (db, id) => (id ? db.get("SELECT email FROM profiles WHERE id = ?", id)?.email || id : null);

// a CSV cell: quoted when needed, and a leading = + - @ neutralised so a spreadsheet doesn't run it as a formula
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// usage_events folded into one row per UTC day (missing days filled with zeros, so a chart has no gaps)
function dailyUsage(db, days) {
  const from = dayStart() - (days - 1) * DAY;
  const out = new Map();
  for (let t = from; t <= dayStart(); t += DAY) {
    out.set(iso(t).slice(0, 10), { day: iso(t).slice(0, 10), claude_cost_usd: 0, claude_calls: 0, claude_cached: 0, claude_stub: 0, claude_sites: {},
      fmp_calls: 0, fmp_hits: 0, fmp_errors: 0, sec_calls: 0, sec_hits: 0, exports: 0, active_users: 0 });
  }
  const rows = db.all(`SELECT substr(at, 1, 10) AS day, feature, provider, COALESCE(site, '') AS site, cache_hit, status, COUNT(*) AS n, SUM(cost_usd) AS cost
    FROM usage_events WHERE at >= ? GROUP BY day, feature, provider, site, cache_hit, status`, iso(from));
  for (const r of rows) {
    const d = out.get(r.day);
    if (!d) continue;
    if (r.feature === "claude") {
      d.claude_cost_usd += r.cost || 0;
      if (r.cache_hit) d.claude_cached += r.n;
      else { d.claude_calls += r.n; d.claude_sites[r.site || "?"] = (d.claude_sites[r.site || "?"] || 0) + r.n; if (r.provider === "stub") d.claude_stub += r.n; }
    } else if (r.provider === "fmp") { d.fmp_calls += r.n; if (r.cache_hit) d.fmp_hits += r.n; if (r.status === "error") d.fmp_errors += r.n; }
    else if (r.feature === "sec") { d.sec_calls += r.n; if (r.cache_hit) d.sec_hits += r.n; }
    else if (r.feature === "export") d.exports += r.n;
  }
  for (const r of db.all("SELECT substr(at, 1, 10) AS day, COUNT(DISTINCT user_id) AS n FROM usage_events WHERE at >= ? AND user_id IS NOT NULL GROUP BY day", iso(from))) {
    if (out.has(r.day)) out.get(r.day).active_users = r.n;
  }
  const list = [...out.values()];
  for (const d of list) d.claude_cost_usd = round(d.claude_cost_usd);
  return { from: iso(from), days: list };
}

export function adminRoutes(db) {
  const r = new Hono();

  // ---------- who am I (admin view) ----------
  // Registered before the requireAdmin middleware on purpose: the page needs it to decide between the TOTP setup and
  // verify steps, which is exactly when requireAdmin would refuse.
  r.get("/me-admin", (c) => {
    const u = c.get("user");
    if (!u) fail(401, "not_signed_in", "Sign in to continue.");
    if (u.role !== "owner" && u.role !== "admin") fail(403, "forbidden", "Admins only.");
    c.header("cache-control", "private, no-store");
    return c.json({ id: u.id, email: u.email, role: u.role, mfa: { required: config.requireAdminMfa, enrolled: !!u.totp_enrolled, aal2: (c.get("session")?.aal || 1) >= 2 } });
  });

  r.use("*", requireAdmin);
  r.use("*", async (c, next) => { await next(); c.header("cache-control", "private, no-store"); });

  // ---------- overview ----------
  r.get("/overview", (c) => {
    const now = Date.now(), today = iso(dayStart(now)), month = iso(monthStart(now));
    const users = db.get(`SELECT COUNT(*) AS total, COALESCE(SUM(last_seen_at >= ?), 0) AS active7, COALESCE(SUM(last_seen_at >= ?), 0) AS active30,
      COALESCE(SUM(status = 'disabled'), 0) AS disabled, COALESCE(SUM(role IN ('owner', 'admin')), 0) AS admins, COALESCE(SUM(created_at >= ?), 0) AS new30 FROM profiles`,
      iso(now - 7 * DAY), iso(now - 30 * DAY), iso(now - 30 * DAY));
    const claude = (since) => {
      const x = db.get("SELECT COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(cache_hit = 0), 0) AS calls, COALESCE(SUM(cache_hit), 0) AS cached FROM usage_events WHERE feature = 'claude' AND provider = 'anthropic' AND at >= ?", since);
      return { cost_usd: round(x.cost), calls: x.calls, cached: x.cached };
    };
    const upstream = (where) => {
      const x = db.get(`SELECT COUNT(*) AS calls, COALESCE(SUM(cache_hit), 0) AS hits, COALESCE(SUM(status = 'error'), 0) AS errors FROM usage_events WHERE ${where} AND at >= ?`, today);
      return { ...x, hit_rate: x.calls ? round(x.hits / x.calls, 4) : null };
    };
    const billing = db.getConfig("billing") || {};
    const budgets = db.getConfig("budgets") || {};
    const licences = db.getConfig("licences") || {};
    // MRR from the subscriptions that grant a plan, in the mode billing runs in; yearly prices count a twelfth
    const subs = db.all("SELECT plan_id, status, LOWER(COALESCE(currency, 'usd')) AS currency, interval, unit_amount FROM subscriptions WHERE status IN ('active', 'trialing', 'past_due') AND livemode = ?", billing.live ? 1 : 0);
    const mrr = {}, byPlan = {};
    let paying = 0, trialing = 0;
    for (const s of subs) {
      if (s.status === "trialing") { trialing++; continue; }
      paying++;
      const m = (s.unit_amount || 0) / (s.interval === "year" ? 12 : 1);
      mrr[s.currency] = (mrr[s.currency] || 0) + m;
      const k = (s.plan_id || "?") + "|" + s.currency;
      byPlan[k] = byPlan[k] || { plan_id: s.plan_id, currency: s.currency, count: 0, mrr: 0 };
      byPlan[k].count++; byPlan[k].mrr += m;
    }
    for (const k of Object.keys(mrr)) mrr[k] = Math.round(mrr[k]);
    return c.json({
      at: iso(now),
      users,
      claude: { today: claude(today), month: claude(month), stub: config.claudeStub, budget_day_usd: budgets.global_claude_usd_day ?? null },
      fmp: upstream("provider = 'fmp'"),
      sec: upstream("feature = 'sec'"),
      exports_today: db.get("SELECT COUNT(*) AS n FROM usage_events WHERE feature = 'export' AND at >= ?", today).n,
      dq_open: db.get("SELECT COUNT(*) AS n FROM dq_flags WHERE status = 'open'").n,
      errors_24h: db.get("SELECT COUNT(*) AS n FROM error_log WHERE at >= ?", iso(now - DAY)).n,
      errors_by_source: db.all("SELECT source, COUNT(*) AS n FROM error_log WHERE at >= ? GROUP BY source ORDER BY n DESC", iso(now - DAY)),
      revenue_month: db.all("SELECT LOWER(COALESCE(currency, 'usd')) AS currency, SUM(amount_paid) AS amount, COUNT(*) AS invoices FROM invoices WHERE created_at >= ? AND amount_paid > 0 GROUP BY 1 ORDER BY 2 DESC", month),
      mrr: { by_currency: mrr, by_plan: Object.values(byPlan).map((x) => ({ ...x, mrr: Math.round(x.mrr) })), paying, trialing, livemode: !!billing.live },
      state: {
        licensed_for_others: licencedForOthers(db),
        licences: Object.fromEntries(LICENCES.map((k) => [k, licences[k]?.signed_at || null])),
        billing: { enabled: !!billing.enabled, live: !!billing.live },
        signups: { open: !!db.getConfig("signups")?.open },
        maintenance: !!db.get("SELECT enabled FROM feature_flags WHERE key = 'maintenance'")?.enabled,
        allowlist_pending: db.get("SELECT COUNT(*) AS n FROM allowlist WHERE accepted_at IS NULL AND role != 'owner'").n,
      },
    });
  });

  // ---------- users ----------
  const profileOr404 = (id) => db.get(`SELECT ${PROFILE_COLS} FROM profiles WHERE id = ?`, id) || fail(404, "not_found", "No such user.");
  const userSummary = (p) => {
    const u = usageFor(db, p);
    return { id: p.id, email: p.email, role: p.role, status: p.status, mfa: !!p.totp_enrolled, created_at: p.created_at, last_seen_at: p.last_seen_at,
      plan: u.plan, period: u.period, limits: u.limits, used: u.used,
      saved_models: db.get("SELECT COUNT(*) AS n FROM user_docs WHERE user_id = ? AND kind = 'model'", p.id).n };
  };

  r.get("/users", (c) => {
    const q = String(c.req.query("q") || "").trim().toLowerCase().slice(0, 100);
    const role = c.req.query("role"), status = c.req.query("status");
    const limit = intParam(c.req.query("limit"), 100, 1, 200), offset = intParam(c.req.query("offset"), 0, 0, 1e7);
    const where = [], params = [];
    if (q) { where.push("email LIKE ? ESCAPE '\\'"); params.push(likeEsc(q)); }
    if (role && ["owner", ...ROLES].includes(role)) { where.push("role = ?"); params.push(role); }
    if (status && STATUSES.includes(status)) { where.push("status = ?"); params.push(status); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = db.get(`SELECT COUNT(*) AS n FROM profiles ${w}`, ...params).n;
    const rows = db.all(`SELECT ${PROFILE_COLS} FROM profiles ${w} ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    return c.json({ total, limit, offset, users: rows.map(userSummary) });
  });

  r.get("/users/:id", (c) => {
    const p = profileOr404(c.req.param("id"));
    const s = userSummary(p);
    const L = limitsFor(db, p);
    const since = iso(dayStart() - 29 * DAY);
    const history = db.all(`SELECT substr(at, 1, 10) AS day,
        COALESCE(SUM(CASE WHEN provider = 'anthropic' THEN cost_usd END), 0) AS claude_cost_usd,
        COALESCE(SUM(feature = 'claude' AND cache_hit = 0), 0) AS claude_calls,
        COALESCE(SUM(provider = 'fmp'), 0) AS fmp_calls, COALESCE(SUM(provider = 'fmp' AND cache_hit = 1), 0) AS fmp_hits,
        COALESCE(SUM(feature = 'sec'), 0) AS sec_calls, COALESCE(SUM(feature = 'export'), 0) AS exports,
        COUNT(DISTINCT ticker) AS tickers
      FROM usage_events WHERE user_id = ? AND at >= ? GROUP BY day ORDER BY day DESC`, p.id, since);
    const claudePeriod = db.get("SELECT COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls FROM usage_events WHERE user_id = ? AND provider = 'anthropic' AND at >= ? AND at < ?", p.id, s.period.start, s.period.end);
    const now = nowIso();
    return c.json({
      user: { ...s, plan_name: L.planName, locale: p.locale, trial_used: !!p.trial_used },
      claude_period: { cost_usd: round(claudePeriod.cost), calls: claudePeriod.calls },
      history: history.map((h) => ({ ...h, claude_cost_usd: round(h.claude_cost_usd) })),
      by_site: db.all("SELECT COALESCE(site, '?') AS site, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost_usd FROM usage_events WHERE user_id = ? AND feature = 'claude' AND at >= ? AND at < ? GROUP BY 1 ORDER BY 3 DESC", p.id, s.period.start, s.period.end),
      comps: db.all("SELECT c.id, c.plan_id, pl.name AS plan_name, c.until, c.note, c.created_at, COALESCE(g.email, c.granted_by) AS granted_by FROM comps c LEFT JOIN plans pl ON pl.id = c.plan_id LEFT JOIN profiles g ON g.id = c.granted_by WHERE c.user_id = ? ORDER BY c.id DESC", p.id)
        .map((x) => ({ ...x, active: !x.until || x.until > now })),
      subscriptions: db.all("SELECT id, status, plan_id, price_id, currency, interval, unit_amount, current_period_start, current_period_end, trial_end, cancel_at_period_end, canceled_at, grace_until, livemode, synced_at FROM subscriptions WHERE user_id = ? ORDER BY synced_at DESC", p.id),
      invoices: db.all("SELECT id, status, currency, amount_due, amount_paid, tax, created_at, hosted_invoice_url FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 24", p.id),
      sessions: db.get("SELECT COUNT(*) AS n, MAX(last_seen_at) AS last_seen_at, COALESCE(SUM(aal >= 2), 0) AS aal2 FROM sessions WHERE user_id = ? AND expires_at_ms > ?", p.id, Date.now()),
      docs: db.all("SELECT kind, COUNT(*) AS n, SUM(bytes) AS bytes, MAX(updated_at) AS updated_at FROM user_docs WHERE user_id = ? GROUP BY kind ORDER BY kind", p.id),
      allowlist: db.get("SELECT email, role, invited_at, accepted_at, note FROM allowlist WHERE email = ?", p.email) || null,
      activity: db.all("SELECT a.id, a.at, a.action, a.target, COALESCE(x.email, a.actor_id) AS actor FROM audit_log a LEFT JOIN profiles x ON x.id = a.actor_id WHERE a.target = ? OR a.actor_id = ? ORDER BY a.id DESC LIMIT 30", p.email, p.id),
    });
  });

  r.post("/users/:id", async (c) => {
    const me = c.get("user"), b = await body(c);
    const p = profileOr404(c.req.param("id"));
    if (b.role === undefined && b.status === undefined) fail(400, "bad_request", "Send role or status.");
    if (p.role === "owner") fail(409, "owner_protected", "The owner's role and status can't be changed.");
    if (b.role !== undefined) {
      ownerOnly(c);
      if (!ROLES.includes(b.role)) fail(400, "bad_role", "Role must be user or admin.");
    }
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) fail(400, "bad_status", "Status must be active or disabled.");
      if (p.id === me.id) fail(409, "self", "You can't change your own status.");
      if (p.role === "admin" && me.role !== "owner") fail(403, "forbidden", "Only the owner can suspend or reactivate an admin.");
    }
    const next = { role: b.role ?? p.role, status: b.status ?? p.status };
    let signedOut = 0;
    db.tx(() => {
      db.run("UPDATE profiles SET role = ?, status = ? WHERE id = ?", next.role, next.status, p.id);
      if (next.role !== p.role) {
        // keep the invite in step, so the allowlist doesn't show a role the account no longer has
        db.run("UPDATE allowlist SET role = ? WHERE email = ? AND role != 'owner'", next.role, p.email);
        db.audit(me.id, "user.role", p.email, { role: p.role }, { role: next.role });
      }
      if (next.status !== p.status) {
        // a suspension takes effect now, not when the session cookie expires
        if (next.status === "disabled") signedOut = Number(db.run("DELETE FROM sessions WHERE user_id = ?", p.id).changes);
        db.audit(me.id, next.status === "disabled" ? "user.suspended" : "user.reactivated", p.email, { status: p.status }, { status: next.status, sessions_ended: signedOut });
      }
    });
    return c.json({ ok: true, user: userSummary(profileOr404(p.id)), sessions_ended: signedOut });
  });

  r.post("/users/:id/comp", async (c) => {
    const me = c.get("user"), b = await body(c);
    const p = profileOr404(c.req.param("id"));
    if (p.role === "owner") fail(409, "owner_protected", "The owner's plan is fixed.");
    const plan = db.get("SELECT id, name FROM plans WHERE id = ?", String(b.plan_id || "")) || fail(400, "bad_plan", "Choose a plan.");
    if (plan.id === "owner") fail(400, "bad_plan", "The owner plan can't be granted.");
    let until = null;
    if (b.until) {
      if (!isDate(b.until)) fail(400, "bad_date", "Until must be a date (YYYY-MM-DD).");
      until = b.until + "T23:59:59.999Z"; // through the end of that day, UTC
      if (until <= nowIso()) fail(400, "bad_date", "That date has already passed.");
    }
    const note = text(b.note, 500, "Note");
    const id = Number(db.run("INSERT INTO comps (user_id, plan_id, until, granted_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", p.id, plan.id, until, me.id, note, nowIso()).lastInsertRowid);
    db.audit(me.id, "user.comp_granted", p.email, null, { comp_id: id, plan_id: plan.id, until, note });
    return c.json({ ok: true, id, user: userSummary(p) });
  });

  // ends the active comps (rows stay as history; planFor only reads unexpired ones)
  r.delete("/users/:id/comp", (c) => {
    const me = c.get("user"), p = profileOr404(c.req.param("id")), now = nowIso();
    const active = db.all("SELECT id, plan_id, until FROM comps WHERE user_id = ? AND (until IS NULL OR until > ?)", p.id, now);
    if (!active.length) fail(404, "no_comp", "This user has no active comp.");
    db.run("UPDATE comps SET until = ? WHERE user_id = ? AND (until IS NULL OR until > ?)", now, p.id, now);
    db.audit(me.id, "user.comp_ended", p.email, active, { until: now });
    return c.json({ ok: true, ended: active.length, user: userSummary(p) });
  });

  r.post("/users/:id/signout", (c) => {
    const me = c.get("user"), p = profileOr404(c.req.param("id"));
    if (p.role === "owner" && me.role !== "owner") fail(403, "forbidden", "Only the owner can sign the owner out.");
    const n = Number(db.run("DELETE FROM sessions WHERE user_id = ?", p.id).changes);
    db.audit(me.id, "user.signed_out", p.email, null, { sessions_ended: n });
    return c.json({ ok: true, sessions_ended: n });
  });

  // ---------- allowlist ----------
  r.get("/allowlist", (c) => {
    const rows = db.all(`SELECT a.email, a.role, a.invited_at, a.accepted_at, a.note, COALESCE(i.email, a.invited_by) AS invited_by,
        p.id AS user_id, p.role AS account_role, p.status AS account_status, p.last_seen_at
      FROM allowlist a LEFT JOIN profiles i ON i.id = a.invited_by LEFT JOIN profiles p ON p.email = a.email
      ORDER BY a.role = 'owner' DESC, a.invited_at DESC`);
    return c.json({ rows, licensed: licencedForOthers(db), signups: { open: !!db.getConfig("signups")?.open } });
  });

  r.post("/allowlist", async (c) => {
    const me = c.get("user"), b = await body(c);
    const email = String(b.email || "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) fail(400, "bad_email", "Enter a valid email address.");
    const role = b.role === undefined ? "user" : b.role;
    if (!ROLES.includes(role)) fail(400, "bad_role", "Role must be user or admin.");
    const note = text(b.note, 500, "Note");
    const cur = db.get("SELECT email, role, note FROM allowlist WHERE email = ?", email);
    if (cur?.role === "owner") fail(409, "owner_protected", "This is the owner's address.");
    // inviting (or touching the invite of) an admin is the owner's call
    if (role === "admin" || cur?.role === "admin") ownerOnly(c);
    if (cur) {
      db.run("UPDATE allowlist SET role = ?, note = ? WHERE email = ?", role, note, email);
      db.audit(me.id, "allowlist.updated", email, { role: cur.role, note: cur.note }, { role, note });
    } else {
      db.run("INSERT INTO allowlist (email, role, invited_by, invited_at, note) VALUES (?, ?, ?, ?, ?)", email, role, me.id, nowIso(), note);
      db.audit(me.id, "allowlist.added", email, null, { role, note });
    }
    const licensed = licencedForOthers(db);
    return c.json({ ok: true, email, role, licensed, ...(licensed ? {} : { warning: "Saved. This person can't sign in until the FMP display licence is recorded in Settings." }) });
  });

  r.delete("/allowlist/:email", (c) => {
    const me = c.get("user"), email = String(c.req.param("email") || "").trim().toLowerCase();
    const cur = db.get("SELECT email, role, note, invited_at, accepted_at FROM allowlist WHERE email = ?", email) || fail(404, "not_found", "That email isn't on the allowlist.");
    if (cur.role === "owner") fail(409, "owner_protected", "The owner's address stays on the allowlist.");
    if (cur.role === "admin") ownerOnly(c);
    db.run("DELETE FROM allowlist WHERE email = ?", email);
    db.audit(me.id, "allowlist.removed", email, cur, null);
    // an existing account keeps signing in on its profile; say so, so nobody mistakes this for a suspension
    const account = db.get("SELECT id, status FROM profiles WHERE email = ?", email);
    return c.json({ ok: true, account: account ? { id: account.id, status: account.status } : null });
  });

  // ---------- usage and cost ----------
  const usageWindow = (c) => intParam(c.req.query("days"), 30, 1, 366);

  r.get("/usage", (c) => {
    const days = usageWindow(c);
    const daily = dailyUsage(db, days);
    const from = daily.from;
    const totals = daily.days.reduce((t, d) => {
      for (const k of ["claude_cost_usd", "claude_calls", "claude_cached", "claude_stub", "fmp_calls", "fmp_hits", "fmp_errors", "sec_calls", "sec_hits", "exports"]) t[k] = (t[k] || 0) + d[k];
      return t;
    }, {});
    totals.claude_cost_usd = round(totals.claude_cost_usd);
    const spenders = db.all(`SELECT e.user_id, p.email, p.role,
        COALESCE(SUM(e.cost_usd), 0) AS claude_cost_usd, COALESCE(SUM(e.feature = 'claude' AND e.cache_hit = 0), 0) AS claude_calls,
        COALESCE(SUM(e.provider = 'fmp' AND e.cache_hit = 0), 0) AS fmp_calls, COALESCE(SUM(e.feature = 'sec'), 0) AS sec_calls,
        COALESCE(SUM(e.feature = 'export'), 0) AS exports, COUNT(DISTINCT e.ticker) AS tickers
      FROM usage_events e LEFT JOIN profiles p ON p.id = e.user_id WHERE e.at >= ? AND e.user_id IS NOT NULL
      GROUP BY e.user_id ORDER BY claude_cost_usd DESC, fmp_calls DESC LIMIT 25`, from);
    // revenue next to cost, per user, over the same window (minor units by currency)
    const paid = new Map();
    for (const x of db.all("SELECT user_id, LOWER(COALESCE(currency, 'usd')) AS currency, SUM(amount_paid) AS amount FROM invoices WHERE created_at >= ? AND amount_paid > 0 GROUP BY 1, 2", from)) {
      if (!paid.has(x.user_id)) paid.set(x.user_id, {});
      paid.get(x.user_id)[x.currency] = x.amount;
    }
    const sites = db.all(`SELECT COALESCE(site, '?') AS site, COALESCE(SUM(cache_hit = 0), 0) AS calls, COALESCE(SUM(cache_hit), 0) AS cached,
        COALESCE(SUM(cost_usd), 0) AS cost_usd, AVG(CASE WHEN cache_hit = 0 THEN input_tokens END) AS avg_input_tokens,
        AVG(CASE WHEN cache_hit = 0 THEN output_tokens END) AS avg_output_tokens, COALESCE(SUM(status != 'ok'), 0) AS problems,
        COALESCE(SUM(provider = 'stub'), 0) AS stub
      FROM usage_events WHERE feature = 'claude' AND at >= ? GROUP BY 1 ORDER BY cost_usd DESC, calls DESC`, from);
    return c.json({
      days, from, daily: daily.days, totals,
      spenders: spenders.map((s) => {
        const p = db.get(`SELECT ${PROFILE_COLS} FROM profiles WHERE id = ?`, s.user_id);
        const plan = p ? limitsFor(db, p) : null;
        return { ...s, claude_cost_usd: round(s.claude_cost_usd), plan: plan ? { id: plan.planId, name: plan.planName, source: plan.source } : null, paid: paid.get(s.user_id) || {} };
      }),
      sites: sites.map((s) => ({ ...s, cost_usd: round(s.cost_usd), avg_input_tokens: s.avg_input_tokens == null ? null : Math.round(s.avg_input_tokens), avg_output_tokens: s.avg_output_tokens == null ? null : Math.round(s.avg_output_tokens) })),
    });
  });

  r.get("/usage/export.csv", (c) => {
    const days = usageWindow(c);
    const daily = dailyUsage(db, days).days;
    const siteNames = PROMPT_SITES.map((s) => s[0]);
    const extra = [...new Set(daily.flatMap((d) => Object.keys(d.claude_sites)))].filter((s) => !siteNames.includes(s));
    const sites = [...siteNames, ...extra];
    const head = ["day", "claude_cost_usd", "claude_calls", "claude_cached", "claude_stub", ...sites.map((s) => "claude_calls:" + s), "fmp_calls", "fmp_cache_hits", "fmp_errors", "sec_calls", "sec_cache_hits", "exports", "active_users"];
    const lines = [head.map(csvCell).join(",")];
    for (const d of daily) {
      lines.push([d.day, d.claude_cost_usd.toFixed(6), d.claude_calls, d.claude_cached, d.claude_stub, ...sites.map((s) => d.claude_sites[s] || 0),
        d.fmp_calls, d.fmp_hits, d.fmp_errors, d.sec_calls, d.sec_hits, d.exports, d.active_users].map(csvCell).join(","));
    }
    c.header("content-type", "text/csv; charset=utf-8");
    c.header("content-disposition", `attachment; filename="usage-${iso(Date.now()).slice(0, 10)}-${days}d.csv"`);
    return c.body(lines.join("\r\n") + "\r\n");
  });

  // ---------- caches ----------
  r.get("/cache", (c) => {
    const now = Date.now();
    const sel = "COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(hits), 0) AS hits, MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest, COALESCE(SUM(expires_at_ms < ?), 0) AS expired";
    return c.json({
      fmp: {
        total: db.get(`SELECT ${sel}, COUNT(DISTINCT ticker) AS tickers FROM fmp_cache`, now),
        by_path: db.all(`SELECT path, ${sel} FROM fmp_cache GROUP BY path ORDER BY bytes DESC`, now),
        by_ticker: db.all(`SELECT ticker, ${sel} FROM fmp_cache GROUP BY ticker ORDER BY bytes DESC LIMIT 200`, now),
      },
      claude: db.all("SELECT site, COUNT(*) AS count, COALESCE(SUM(LENGTH(CAST(response AS BLOB))), 0) AS bytes, MIN(created_at) AS oldest, MAX(created_at) AS newest, COALESCE(SUM(expires_at_ms < ?), 0) AS expired FROM claude_cache GROUP BY site ORDER BY bytes DESC", now),
      sec: db.all("SELECT kind, COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes, MIN(fetched_at) AS oldest FROM sec_cache GROUP BY kind ORDER BY bytes DESC"),
    });
  });

  r.post("/cache/purge", async (c) => {
    const me = c.get("user"), b = await body(c);
    let n;
    if (b.all === true) {
      n = Number(db.run("DELETE FROM fmp_cache").changes);
    } else {
      const where = [], params = [];
      if (b.ticker !== undefined && b.ticker !== null && b.ticker !== "") {
        const t = String(b.ticker).trim().toUpperCase();
        if (!TICKER.test(t)) fail(400, "bad_ticker", "That isn't a ticker.");
        where.push("ticker = ?"); params.push(t);
      }
      if (b.path !== undefined && b.path !== null && b.path !== "") {
        if (typeof b.path !== "string" || !/^[a-z0-9\-/]{1,100}$/i.test(b.path)) fail(400, "bad_path", "That isn't an FMP path.");
        where.push("path = ?"); params.push(b.path);
      }
      if (!where.length) fail(400, "bad_request", "Send ticker, path, or all: true.");
      n = Number(db.run(`DELETE FROM fmp_cache WHERE ${where.join(" AND ")}`, ...params).changes);
    }
    db.audit(me.id, "cache.purged", "fmp_cache", null, { ticker: b.ticker || null, path: b.path || null, all: b.all === true, deleted: n });
    return c.json({ ok: true, deleted: n });
  });

  r.post("/cache/purge-claude", async (c) => {
    const me = c.get("user"), b = await body(c);
    let n;
    if (b.site) {
      if (!db.get("SELECT 1 FROM prompts WHERE site = ?", String(b.site))) fail(400, "bad_site", "No such prompt site.");
      n = Number(db.run("DELETE FROM claude_cache WHERE site = ?", String(b.site)).changes);
    } else n = Number(db.run("DELETE FROM claude_cache").changes);
    db.audit(me.id, "cache.purged", "claude_cache", null, { site: b.site || null, deleted: n });
    return c.json({ ok: true, deleted: n });
  });

  // ---------- prompts ----------
  // What a version changes on each site (see applyVersions in claude/index.js): the body replaces the page's prompt
  // text where the site has one; model, effort and max_tokens come from the site's own version, except that a notes
  // draft takes them from notes.prompt (notes.system contributes only its text).
  const SITE_META = Object.fromEntries(PROMPT_SITES.map(([site, constant]) => [site, { body: !!constant, settings: site !== "notes.system" }]));
  const siteOr404 = (site) => db.get("SELECT site, description, json_site, active_version_id FROM prompts WHERE site = ?", site) || fail(404, "not_found", "No such prompt site.");
  const versionCols = "v.id, v.site, v.version, v.model, v.effort, v.max_tokens, v.note, v.created_at, COALESCE(p.email, v.created_by) AS created_by, LENGTH(v.body) AS chars";

  r.get("/prompts", (c) => {
    const order = PROMPT_SITES.map((s) => s[0]);
    const sites = db.all("SELECT site, description, json_site, active_version_id FROM prompts").sort((a, b) => order.indexOf(a.site) - order.indexOf(b.site));
    const versions = db.all(`SELECT ${versionCols} FROM prompt_versions v LEFT JOIN profiles p ON p.id = v.created_by ORDER BY v.site, v.version DESC`);
    return c.json({
      sites: sites.map((s) => ({ ...s, json_site: !!s.json_site, applies: SITE_META[s.site] || { body: true, settings: true },
        versions: versions.filter((v) => v.site === s.site).map((v) => ({ ...v, active: v.id === s.active_version_id })) })),
      models: db.all("SELECT model, MAX(effective_from) AS effective_from, input_per_mtok, output_per_mtok FROM model_prices GROUP BY model ORDER BY model"),
      efforts: EFFORTS, max_tokens: { min: 1000, max: 128000 },
    });
  });

  r.get("/prompts/:site/versions/:id", (c) => {
    const s = siteOr404(c.req.param("site"));
    const v = db.get(`SELECT ${versionCols}, v.body FROM prompt_versions v LEFT JOIN profiles p ON p.id = v.created_by WHERE v.id = ? AND v.site = ?`, intParam(c.req.param("id"), 0, 0, 1e12), s.site)
      || fail(404, "not_found", "No such version.");
    return c.json({ ...v, active: v.id === s.active_version_id, json_site: !!s.json_site });
  });

  r.post("/prompts/:site/versions", async (c) => {
    const me = c.get("user"), b = await body(c);
    const s = siteOr404(c.req.param("site"));
    const meta = SITE_META[s.site] || { body: true, settings: true };
    const promptBody = b.body === undefined || b.body === null ? "" : b.body;
    if (typeof promptBody !== "string" || promptBody.length > 200_000) fail(400, "bad_body", "The prompt must be text of at most 200,000 characters.");
    if (meta.body && !promptBody.trim()) fail(400, "bad_body", "The prompt can't be empty.");
    if (typeof b.model !== "string" || !db.get("SELECT 1 FROM model_prices WHERE model = ?", b.model)) fail(400, "bad_model", "Choose a model that has a price in model_prices.");
    if (!EFFORTS.includes(b.effort)) fail(400, "bad_effort", "Effort must be one of " + EFFORTS.join(", ") + ".");
    const maxTokens = Number(b.max_tokens);
    if (!Number.isInteger(maxTokens) || maxTokens < 1000 || maxTokens > 128000) fail(400, "bad_max_tokens", "max_tokens must be a whole number from 1,000 to 128,000.");
    const note = text(b.note, 500, "Note");
    const v = db.tx(() => {
      const n = (db.get("SELECT MAX(version) AS n FROM prompt_versions WHERE site = ?", s.site).n || 0) + 1;
      const id = Number(db.run("INSERT INTO prompt_versions (site, version, body, model, effort, max_tokens, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        s.site, n, promptBody, b.model, b.effort, maxTokens, note, me.id, nowIso()).lastInsertRowid);
      return { id, version: n };
    });
    db.audit(me.id, "prompt.version_created", s.site, null, { ...v, model: b.model, effort: b.effort, max_tokens: maxTokens, note, chars: promptBody.length });
    // JSON sites parse the reply as JSON; a version that stops asking for it breaks the feature (warned, not refused)
    const warnings = s.json_site && meta.body && !/\bjson\b/i.test(promptBody) ? ["This site's reply is parsed as JSON, but the prompt no longer mentions JSON."] : [];
    return c.json({ ok: true, ...v, active: false, warnings });
  });

  r.post("/prompts/:site/activate", async (c) => {
    ownerOnly(c);
    const me = c.get("user"), b = await body(c);
    const s = siteOr404(c.req.param("site"));
    if (!Number.isInteger(b.version_id)) fail(400, "bad_request", "Send version_id.");
    const v = db.get("SELECT id, version, model, effort, max_tokens FROM prompt_versions WHERE id = ? AND site = ?", b.version_id, s.site) || fail(404, "not_found", "No such version for this site.");
    const before = s.active_version_id ? db.get("SELECT id, version, model, effort, max_tokens FROM prompt_versions WHERE id = ?", s.active_version_id) : null;
    db.run("UPDATE prompts SET active_version_id = ? WHERE site = ?", v.id, s.site);
    db.audit(me.id, "prompt.activated", s.site, before, v);
    return c.json({ ok: true, site: s.site, active_version_id: v.id, version: v.version });
  });

  // ---------- feature flags ----------
  r.get("/flags", (c) => c.json({
    flags: db.all("SELECT f.key, f.description, f.enabled, (SELECT COUNT(*) FROM user_flags u WHERE u.key = f.key) AS user_overrides FROM feature_flags f ORDER BY f.key = 'maintenance', f.key")
      .map((f) => ({ ...f, enabled: !!f.enabled, owner_only: f.key === "maintenance" })),
  }));

  r.post("/flags/:key", async (c) => {
    const me = c.get("user"), b = await body(c), key = c.req.param("key");
    const f = db.get("SELECT key, enabled FROM feature_flags WHERE key = ?", key) || fail(404, "not_found", "No such flag.");
    if (key === "maintenance") ownerOnly(c);
    if (typeof b.enabled !== "boolean") fail(400, "bad_request", "enabled must be true or false.");
    db.run("UPDATE feature_flags SET enabled = ? WHERE key = ?", b.enabled ? 1 : 0, key);
    db.audit(me.id, "flag.set", key, { enabled: !!f.enabled }, { enabled: b.enabled });
    return c.json({ ok: true, key, enabled: b.enabled });
  });

  // ---------- logs (newest first; `before` is the id to page back from) ----------
  r.get("/audit", (c) => {
    const limit = intParam(c.req.query("limit"), 100, 1, 500), before = intParam(c.req.query("before"), 0, 0, Number.MAX_SAFE_INTEGER);
    const action = String(c.req.query("action") || "").slice(0, 60), q = String(c.req.query("q") || "").trim().toLowerCase().slice(0, 100);
    const where = [], params = [];
    if (before) { where.push("a.id < ?"); params.push(before); }
    if (action) { where.push("a.action LIKE ? ESCAPE '\\'"); params.push(action.replace(/[\\%_]/g, (m) => "\\" + m) + "%"); }
    if (q) { where.push("(LOWER(a.target) LIKE ? ESCAPE '\\' OR LOWER(x.email) LIKE ? ESCAPE '\\')"); params.push(likeEsc(q), likeEsc(q)); }
    const rows = db.all(`SELECT a.id, a.at, a.actor_id, x.email AS actor_email, a.action, a.target, a.before, a.after FROM audit_log a LEFT JOIN profiles x ON x.id = a.actor_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.id DESC LIMIT ?`, ...params, limit);
    return c.json({ rows: rows.map((x) => ({ ...x, before: parseJson(x.before), after: parseJson(x.after) })), next: rows.length === limit ? rows.at(-1).id : null });
  });

  r.get("/errors", (c) => {
    const limit = intParam(c.req.query("limit"), 100, 1, 500), before = intParam(c.req.query("before"), 0, 0, Number.MAX_SAFE_INTEGER);
    const source = String(c.req.query("source") || "").slice(0, 40);
    const where = [], params = [];
    if (before) { where.push("e.id < ?"); params.push(before); }
    if (source) { where.push("e.source = ?"); params.push(source); }
    const rows = db.all(`SELECT e.id, e.at, e.source, e.code, e.message, e.user_id, p.email AS user_email, e.ticker, e.context FROM error_log e LEFT JOIN profiles p ON p.id = e.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY e.id DESC LIMIT ?`, ...params, limit);
    return c.json({
      rows: rows.map((x) => ({ ...x, context: parseJson(x.context) })), next: rows.length === limit ? rows.at(-1).id : null,
      sources: db.all("SELECT source, COUNT(*) AS n, MAX(at) AS last_at FROM error_log GROUP BY source ORDER BY n DESC"),
    });
  });

  // ---------- settings ----------
  const settingsView = () => {
    const meta = Object.fromEntries(db.all("SELECT key, updated_by, updated_at FROM app_config WHERE key IN ('licences', 'billing', 'signups', 'budgets')").map((x) => [x.key, { by: emailOf(db, x.updated_by), at: x.updated_at }]));
    const licences = db.getConfig("licences") || {};
    for (const k of LICENCES) if (licences[k]?.recorded_by) licences[k] = { ...licences[k], recorded_by: emailOf(db, licences[k].recorded_by) };
    const key = config.stripeSecretKey;
    return {
      licences: Object.fromEntries(LICENCES.map((k) => [k, licences[k] || null])),
      billing: db.getConfig("billing") || { enabled: false, live: false },
      signups: db.getConfig("signups") || { open: false },
      budgets: db.getConfig("budgets") || {},
      licensed_for_others: licencedForOthers(db),
      updated: meta,
      // what the server was started with: presence and mode only, never the values
      env: {
        stripe: { configured: !!key, mode: key ? (/^(sk|rk)_live_/.test(key) ? "live" : "test") : null, webhook: !!config.stripeWebhookSecret },
        claude: { stub: config.claudeStub, key: !!config.anthropicApiKey },
        fmp: { key: !!config.fmpApiKey, fixtures: !!config.fmpFixtures },
        mail: config.resendApiKey ? "resend" : "dev outbox",
        require_admin_mfa: config.requireAdminMfa,
        owner_email: config.ownerEmail || null,
      },
    };
  };
  r.get("/settings", (c) => c.json(settingsView()));

  r.post("/settings/licences", async (c) => {
    ownerOnly(c);
    const me = c.get("user"), b = await body(c);
    if (!LICENCES.includes(b.which)) fail(400, "bad_request", "which must be one of " + LICENCES.join(", ") + ".");
    const cur = db.getConfig("licences") || {};
    let value;
    if (b.clear === true) {
      // billing runs on these two; turning billing off first keeps the two settings consistent
      if ((b.which === "fmp_display" || b.which === "legal") && db.getConfig("billing")?.enabled) fail(409, "billing_enabled", "Turn billing off before clearing this licence.");
      value = null;
    } else {
      if (!isDate(b.signed_at)) fail(400, "bad_date", "signed_at must be a date (YYYY-MM-DD).");
      if (b.signed_at > iso(Date.now() + DAY).slice(0, 10)) fail(400, "bad_date", "signed_at can't be in the future.");
      value = { signed_at: b.signed_at, reference: text(b.reference, 200, "Reference"), note: text(b.note, 1000, "Note"), recorded_by: me.id, recorded_at: nowIso() };
    }
    const next = { ...cur, [b.which]: value };
    db.setConfig("licences", next, me.id);
    db.audit(me.id, value ? "settings.licence_recorded" : "settings.licence_cleared", "licences." + b.which, cur[b.which] || null, value);
    return c.json({ ok: true, settings: settingsView() });
  });

  r.post("/settings/signups", async (c) => {
    ownerOnly(c);
    const me = c.get("user"), b = await body(c);
    if (typeof b.open !== "boolean") fail(400, "bad_request", "open must be true or false.");
    const cur = db.getConfig("signups") || {};
    db.setConfig("signups", { ...cur, open: b.open }, me.id);
    db.audit(me.id, "settings.signups", "signups", cur, { ...cur, open: b.open });
    return c.json({ ok: true, settings: settingsView() });
  });

  r.post("/settings/budgets", async (c) => {
    ownerOnly(c);
    const me = c.get("user"), b = await body(c);
    const v = b.global_claude_usd_day;
    // meter.js treats 0 as "no cap", so 0 is refused rather than silently meaning the opposite of what it looks like
    if (v !== null && !(typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100000)) fail(400, "bad_budget", "Enter a daily cap above $0 (or null for no cap). To pause Claude, use the feature flags.");
    const cur = db.getConfig("budgets") || {};
    const next = { ...cur, global_claude_usd_day: v === null ? null : Math.round(v * 100) / 100 };
    db.setConfig("budgets", next, me.id);
    db.audit(me.id, "settings.budgets", "budgets", cur, next);
    return c.json({ ok: true, settings: settingsView() });
  });

  r.post("/settings/billing", async (c) => {
    ownerOnly(c);
    const me = c.get("user"), b = await body(c);
    if (b.enabled !== undefined && typeof b.enabled !== "boolean") fail(400, "bad_request", "enabled must be true or false.");
    if (b.live !== undefined && typeof b.live !== "boolean") fail(400, "bad_request", "live must be true or false.");
    const cur = db.getConfig("billing") || { enabled: false, live: false };
    const next = { ...cur, ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.live !== undefined ? { live: b.live } : {}) };
    if (!next.enabled) next.live = false;
    if (next.enabled) {
      const lic = db.getConfig("licences") || {};
      if (!lic.fmp_display?.signed_at || !lic.legal?.signed_at) fail(409, "licence_required", "Record the FMP display licence and the legal review before turning billing on.");
    }
    if (next.live) {
      if (!config.stripeSecretKey) fail(409, "stripe_not_configured", "Set STRIPE_SECRET_KEY on the server before going live.");
    }
    db.setConfig("billing", next, me.id);
    db.audit(me.id, "settings.billing", "billing", cur, next);
    return c.json({ ok: true, settings: settingsView() });
  });

  // ---------- plans ----------
  r.get("/plans", (c) => {
    const now = nowIso();
    const prices = db.all("SELECT id, plan_id, interval, lookup_key, currency_options, active FROM plan_prices ORDER BY plan_id, interval");
    const subs = Object.fromEntries(db.all("SELECT plan_id, COUNT(*) AS n FROM subscriptions WHERE status IN ('active', 'trialing', 'past_due') GROUP BY plan_id").map((x) => [x.plan_id, x.n]));
    const comps = Object.fromEntries(db.all("SELECT plan_id, COUNT(DISTINCT user_id) AS n FROM comps WHERE until IS NULL OR until > ? GROUP BY plan_id", now).map((x) => [x.plan_id, x.n]));
    return c.json({
      limit_keys: LIMIT_KEYS,
      plans: db.all("SELECT id, name, active, limits, sort FROM plans ORDER BY sort, id").map((p) => ({
        ...p, active: !!p.active, limits: parseJson(p.limits), subscribers: subs[p.id] || 0, comps: comps[p.id] || 0,
        prices: prices.filter((x) => x.plan_id === p.id).map((x) => ({ ...x, active: !!x.active, currency_options: parseJson(x.currency_options) })),
      })),
    });
  });

  r.post("/plans/:id", async (c) => {
    ownerOnly(c);
    const me = c.get("user"), b = await body(c);
    const p = db.get("SELECT id, name, active, limits FROM plans WHERE id = ?", c.req.param("id")) || fail(404, "not_found", "No such plan.");
    const cur = { name: p.name, active: !!p.active, limits: JSON.parse(p.limits) };
    const next = { ...cur, limits: { ...cur.limits } };
    if (b.name !== undefined) {
      if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 60) fail(400, "bad_name", "Name must be 1 to 60 characters.");
      next.name = b.name.trim();
    }
    if (b.active !== undefined) {
      if (typeof b.active !== "boolean") fail(400, "bad_request", "active must be true or false.");
      if (p.id === "owner" && !b.active) fail(400, "bad_request", "The owner plan stays active.");
      next.active = b.active;
    }
    if (b.limits !== undefined) {
      if (!b.limits || typeof b.limits !== "object" || Array.isArray(b.limits)) fail(400, "bad_limits", "limits must be an object.");
      for (const [k, v] of Object.entries(b.limits)) {
        if (!LIMIT_KEYS.includes(k)) fail(400, "bad_limits", `Unknown limit ${k}.`);
        // null = unlimited; counts are whole numbers, Claude budgets are dollars
        const money = k.startsWith("claude_");
        if (v !== null && !(typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e7 && (money || Number.isInteger(v)))) fail(400, "bad_limits", `${k} must be ${money ? "a dollar amount" : "a whole number"} of 0 or more, or null for no limit.`);
        next.limits[k] = v === null ? null : money ? Math.round(v * 100) / 100 : v;
      }
      if (next.limits.claude_soft_usd != null && next.limits.claude_hard_usd != null && next.limits.claude_soft_usd > next.limits.claude_hard_usd) fail(400, "bad_limits", "The Claude soft cap can't be above the hard cap.");
    }
    db.run("UPDATE plans SET name = ?, active = ?, limits = ? WHERE id = ?", next.name, next.active ? 1 : 0, JSON.stringify(next.limits), p.id);
    db.audit(me.id, "plan.updated", p.id, cur, next);
    return c.json({ ok: true, plan: { id: p.id, ...next } });
  });

  return r;
}
