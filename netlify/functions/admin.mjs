// Admin panel API: usage stats, users, warmer control. Requires role "admin".
import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { requireAdmin, entitlement } from "../lib/entitlement.mjs";
import { listUsers } from "../lib/users.mjs";
import { listEvents, eventDetails } from "../lib/events.mjs";
import { getUser, findUserByLogin, createUser, saveUser } from "../lib/users.mjs";
import { openStore } from "../lib/store.mjs";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { cfg } from "../lib/config.mjs";
import { fullUniverse, sp500WarmingOn } from "../lib/universe.mjs";
import { dispatchWarm, warmStatus, warmCoverage, warmSettings } from "../lib/warmer.mjs";
import { pendingResets } from "../lib/users.mjs";
import { createAccessCode, listAccessCodes, deactivateAccessCode } from "../lib/coupons.mjs";
import { xlsx } from "../lib/xlsx.mjs";

async function recentMessages() {
  const store = await openStore("contact");
  const keys = (await store.list("msg:")).sort().reverse().slice(0, 50);
  return (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean);
}
import { mailConfigured } from "../lib/mail.mjs";

const PRICE_IN = 4 / 1e6, PRICE_OUT = 20 / 1e6; // claude-opus-5-5 list prices per token

export default handler(async (req, context) => {
  await requireAdmin(req);
  const action = param(context, "action");

  if (action === "stats") {
    const days = 30;
    const [allEvents, allUsers, jobs] = await Promise.all([listEvents(days), listUsers(), openStore("jobs")]);
    // Developer/admin accounts are excluded from every usage figure.
    const adminNames = new Set(allUsers.filter((u) => u.role === "admin").map((u) => u.username));
    const users = allUsers.filter((u) => u.role !== "admin");
    const events = allEvents.filter((e) => !adminNames.has(e.user));
    const now = Date.now();
    const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
    const byDay = {};
    for (let i = days - 1; i >= 0; i--) byDay[dayKey(now - i * 86400000)] = { views: 0, demo: 0, logins: 0, signups: 0, searches: 0, ai: 0, users: new Set() };
    const bySymbol = {}, lastSeen = {}, lastLoc = {}, visitors = new Set();
    const geo = { countries: {}, places: {} };
    let cost = 0, generations = 0, translations = 0;
    for (const e of events) {
      const d = byDay[e.day]; if (!d) continue;
      if (e.action === "view") { d.views++; bySymbol[e.detail] = (bySymbol[e.detail] || 0) + 1; }
      else if (e.action === "demo_view") d.demo++;
      else if (e.action === "login") d.logins++;
      else if (e.action === "signup") d.signups++;
      else if (e.action === "search") d.searches++;
      else if (e.action === "ai_generate") { d.ai++; generations++; const [, inp, out] = e.detail.split("_"); cost += Number(inp || 0) * PRICE_IN + Number(out || 0) * PRICE_OUT; }
      else if (e.action === "ai_deep") { d.ai++; generations++; const [, inp, out] = e.detail.split("_"); cost += Number(inp || 0) * PRICE_IN + Number(out || 0) * PRICE_OUT; }
      else if (e.action === "ai_translate") { translations++; cost += 0.03; }
      if (e.user && !e.anon && e.user !== "system") { d.users.add(e.user); if (!lastSeen[e.user]) { lastSeen[e.user] = e.ts; lastLoc[e.user] = { country: e.country, region: e.region, city: e.city }; } }
      if (e.user && e.user.startsWith("v_")) visitors.add(e.user);
      if (!["ai_generate", "ai_deep", "ai_translate", "ai_sector"].includes(e.action) && e.user !== "system") {
        const c = (geo.countries[e.country] ||= { events: 0, views: 0, visitors: new Set(), members: new Set() });
        c.events++; if (e.action === "view" || e.action === "page" || e.action === "demo_view" || e.action === "teaser_page" || e.action === "sector_view") c.views++;
        if (e.anon) { if (e.user && e.user !== "anon") c.visitors.add(e.user); } else c.members.add(e.user);
        if (e.city || e.region) { const k = `${e.country}|${e.region || ""}|${e.city || ""}`; const t = (geo.places[k] ||= { country: e.country, region: e.region, city: e.city, events: 0, who: new Set() }); t.events++; t.who.add(e.user); }
      }
    }
    const series = Object.entries(byDay).map(([day, d]) => ({ day, views: d.views, demo: d.demo, logins: d.logins, signups: d.signups, searches: d.searches, ai: d.ai, activeUsers: d.users.size }));
    const activeIn = (ms) => new Set(events.filter((e) => now - e.ts < ms && e.user && !e.anon && e.user !== "system").map((e) => e.user)).size;
    const states = {};
    for (const u of users) { const st = entitlement(u).state; states[st] = (states[st] || 0) + 1; }
    const warm = (await warmStatus()).last;
    const coverage = await warmCoverage();
    const universe = await fullUniverse(); // coverage is always measured against the S&P 500
    const langs = [...new Set(["en", ...cfg.locales()])]; langs.push(...langs.map((l) => `deep-${l}`));
    const covCounts = Object.fromEntries(langs.map((l) => [l, universe.filter((sym) => coverage[sym]?.ready?.[l]).length]));
    const pending = universe.filter((sym) => !langs.every((l) => coverage[sym]?.ready?.[l]));
    const untouched = universe.filter((sym) => !coverage[sym]).length; // never visited by the warmer yet
    const todayKey = dayKey(now);
    const todayAi = allEvents.filter((e) => e.day === todayKey && ["ai_generate", "ai_deep", "ai_sector"].includes(e.action));
    const costToday = todayAi.reduce((a, e) => { const [, inp, out] = e.detail.split("_"); return a + Number(inp || 0) * PRICE_IN + Number(out || 0) * PRICE_OUT; }, 0) + allEvents.filter((e) => e.day === todayKey && e.action === "ai_translate").length * 0.03;
    return json({
      generatedAt: new Date().toISOString(),
      totals: { users: users.length, states, signups7d: users.filter((u) => now - u.createdAt < 7 * 86400000).length, signups30d: users.filter((u) => now - u.createdAt < 30 * 86400000).length, activeToday: activeIn(86400000), active7d: activeIn(7 * 86400000), active30d: activeIn(30 * 86400000), views30d: series.reduce((a, d) => a + d.views, 0), demo30d: series.reduce((a, d) => a + d.demo, 0), aiGenerations30d: generations, aiTranslations30d: translations, aiCostUsd30d: Math.round(cost * 100) / 100 },
      series,
      topSymbols: Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([symbol, views]) => ({ symbol, views })),
      recent: events.slice(0, 150).map(({ key, ...e }) => e),
      visitors30d: visitors.size,
      geo: {
        countries: Object.entries(geo.countries).map(([code, c]) => ({ code, events: c.events, views: c.views, visitors: c.visitors.size, members: c.members.size })).sort((a, b) => b.events - a.events),
        places: Object.values(geo.places).map((t) => ({ country: t.country, region: t.region, city: t.city, events: t.events, people: t.who.size })).sort((a, b) => b.events - a.events).slice(0, 40),
      },
      warm: { universe: universe.length, sp500On: sp500WarmingOn(), perRun: warmSettings().perRun, settings: warmSettings(), last: warm, langs, coverage: covCounts, pending, untouched, done: universe.length - pending.length, generatedToday: todayAi.length, costToday: Math.round(costToday * 100) / 100, current: warm?.running ? [].concat(warm.current || []).join(", ") : null },
      contact: await recentMessages(),
      mail: { configured: mailConfigured(), pendingResets: (await pendingResets()).map((r) => ({ username: r.username, email: r.email, link: `${cfg.siteUrl().replace(/\/$/, "")}/#/reset/${r.token}`, expiresAt: r.expiresAt })) },
      coupons: await listAccessCodes(),
      users: allUsers.slice(0, 200).map((u) => ({ username: u.username, email: u.email, createdAt: u.createdAt, state: entitlement(u).state, status: u.subscription?.status || null, role: u.role || null, locale: u.locale || null, lastSeen: lastSeen[u.username] || null, location: lastLoc[u.username] || null, events30d: events.filter((e) => e.user === u.username).length })),
    });
  }

  // Daily activity series for up to a year. Past days are rolled up once and stored
  // (rollup:YYYYMMDD in the jobs store); today is always counted live. At most 45 missing
  // rollups are computed per call; the response says when more remain.
  if (action === "series") {
    const days = Math.min(366, Math.max(1, Number(query(req).get("days") || 30)));
    const jobs = await openStore("jobs");
    const adminNames = new Set((await listUsers()).filter((u) => u.role === "admin").map((u) => u.username));
    const fold = (evs) => { const d = { views: 0, demo: 0, logins: 0, signups: 0, searches: 0, ai: 0, users: new Set(), visitors: new Set() }; for (const e of evs) { if (adminNames.has(e.user)) continue; if (e.action === "view") d.views++; else if (e.action === "demo_view" || e.action === "teaser_page") d.demo++; else if (e.action === "login") d.logins++; else if (e.action === "signup") d.signups++; else if (e.action === "search") d.searches++; else if (["ai_generate", "ai_deep", "ai_sector"].includes(e.action)) d.ai++; if (e.user && !e.anon && e.user !== "system") d.users.add(e.user); else if (e.user && e.user.startsWith("v_")) d.visitors.add(e.user); } return { views: d.views, demo: d.demo, logins: d.logins, signups: d.signups, searches: d.searches, ai: d.ai, activeUsers: d.users.size, visitors: d.visitors.size }; };
    const now = Date.now(); const out = []; let computed = 0, incomplete = false;
    const todayKey = new Date(now).toISOString().slice(0, 10);
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
      const k = `rollup:${day.replace(/-/g, "")}`;
      let rec = day === todayKey ? null : await jobs.get(k);
      if (!rec) {
        if (day !== todayKey && computed >= 45) { incomplete = true; out.push({ day, pending: true }); continue; }
        const store = await openStore("events");
        const keys = await store.list(`ev:${day.replace(/-/g, "")}:`);
        rec = fold(keys.map((key) => { const [, , ms, , user, action, detail] = key.split(":"); return { ts: Number(ms), user, action, detail, anon: !user || user === "anon" || user.startsWith("v_") }; }));
        if (day !== todayKey) { await jobs.set(k, rec); computed++; }
      }
      out.push({ day, ...rec });
    }
    return json({ days, series: out, incomplete });
  }

  // Access log: every recorded event for the last `days` days (max 30), filtered by user, action or country.
  if (action === "events") {
    const q = query(req);
    const days = Math.min(30, Math.max(1, Number(q.get("days") || 7)));
    const f = { user: (q.get("user") || "").toLowerCase(), action: q.get("action") || "", country: (q.get("country") || "").toUpperCase() };
    const all = (await listEvents(days)).filter((e) => (!f.user || String(e.user).toLowerCase().includes(f.user)) && (!f.action || e.action === f.action) && (!f.country || e.country === f.country));
    const offset = Math.max(0, Number(q.get("offset") || 0)), limit = Math.min(500, Math.max(1, Number(q.get("limit") || 200)));
    const page = all.slice(offset, offset + limit);
    const withDetails = q.get("details") === "1" ? await eventDetails(page, limit) : page;
    return json({ days, total: all.length, offset, events: withDetails.map(({ key, ...e }) => e), actions: [...new Set(all.map((e) => e.action))].sort() });
  }
  // One member's (or anonymous visitor's) activity over the last 90 days.
  if (action === "user") {
    const name = String(query(req).get("username") || "").trim();
    if (!name) throw new HttpError(400, "username required");
    const u = name.startsWith("v_") ? null : await findUserByLogin(name);
    const uname = u ? u.username : name;
    const events = (await listEvents(90)).filter((e) => e.user === uname);
    const count = (fn) => { const m = {}; for (const e of events) { const k = fn(e); if (k) m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, n })); };
    const details = await eventDetails(events, 400);
    return json({
      user: u ? { username: u.username, email: u.email, createdAt: u.createdAt, locale: u.locale || null, role: u.role || null, plan: u.plan || null, trialEndsAt: u.trialEndsAt || null, coupons: u.coupons || [], subscription: u.subscription ? { status: u.subscription.status, renewsAt: u.subscription.renewsAt, endsAt: u.subscription.endsAt, cardBrand: u.subscription.cardBrand, cardLastFour: u.subscription.cardLastFour } : null, entitlement: entitlement(u) } : { username: uname, anonymous: true },
      firstSeen: events.length ? events[events.length - 1].ts : null, lastSeen: events.length ? events[0].ts : null, total: events.length,
      daysActive: new Set(events.map((e) => e.day)).size,
      tickers: count((e) => (e.action === "view" || e.action === "teaser" || e.action === "teaser_page" || e.action === "demo_view") ? e.detail : null).slice(0, 40),
      tabs: count((e) => e.action === "tab" ? e.detail.split("_").slice(1).join("_") || e.detail : null),
      actions: count((e) => e.action),
      sectors: count((e) => e.action === "sector_view" || e.action === "sector_report" ? e.detail : null),
      searches: count((e) => e.action === "search" ? e.detail : null).slice(0, 30),
      locations: count((e) => [e.city, e.region, e.country !== "ZZ" ? e.country : null].filter(Boolean).join(", ") || "unknown"),
      devices: (() => { const m = {}; for (const e of details) { if (!e.ua) continue; const k = /(iPhone|iPad|Android)/.test(e.ua) ? "mobile" : "desktop"; m[k] = (m[k] || 0) + 1; } return Object.entries(m).map(([key, n]) => ({ key, n })); })(),
      timeline: details.slice(0, 400).map(({ key, ua, ...e }) => ({ ...e, device: ua ? (/iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "other") : null })),
    });
  }

  if (action === "warm" && req.method === "POST") {
    return json(await dispatchWarm({ full: query(req).get("full") === "1" }));
  }
  // Force-rebuild one ticker's bundle and drop its AI records so the next warmer run regenerates them.
  if (action === "rebuild" && req.method === "POST") {
    const symbol = normalizeSymbol(query(req).get("symbol"));
    const bundle = await stockBundle(symbol, { force: true });
    const store = await openStore("summaries");
    const keys = (await store.list("")).filter((k) => k.includes(`:${symbol}:`));
    for (const k of keys) await store.delete(k);
    return json({ symbol, reportingCurrency: bundle.company.reportingCurrency, fxToUsd: bundle.company.fxToUsd, peForward: bundle.valuation.peForward, deleted: keys });
  }

  // Drop one ticker's translated AI records (digest and deep dive) in one language so the next
  // warmer run translates them again from the unchanged English.
  if (action === "retranslate" && req.method === "POST") {
    const symbol = normalizeSymbol(query(req).get("symbol"));
    const lang = String(query(req).get("lang") || "ja");
    if (lang === "en") throw new HttpError(400, "lang must not be en");
    const store = await openStore("summaries");
    const keys = (await store.list("")).filter((k) => { const p = k.split(":"); return p.includes(symbol) && p.includes(lang) && !k.startsWith("sector:"); });
    for (const k of keys) await store.delete(k);
    return json({ symbol, lang, deleted: keys });
  }

  // GET /api/admin/users.xlsx: every member with status, billing, usage and location, plus access codes.
  if (action === "users.xlsx") {
    const [users, events, codes] = await Promise.all([listUsers(), listEvents(90), listAccessCodes()]);
    const jst = (ts) => ts ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)) : "";
    const byUser = {};
    for (const e of events) { if (!e.user || e.anon) continue; const u = (byUser[e.user] ||= { n: 0, n30: 0, first: e.ts, last: 0, loc: null, days: new Set(), tickers: {} }); u.n++; if (Date.now() - e.ts < 30 * 86400000) u.n30++; u.first = Math.min(u.first, e.ts); if (e.ts > u.last) { u.last = e.ts; u.loc = [e.city, e.region, e.country !== "ZZ" ? e.country : null].filter(Boolean).join(", "); } u.days.add(e.day); if (e.action === "view") u.tickers[e.detail] = (u.tickers[e.detail] || 0) + 1; }
    const header = ["Username", "Email", "Role", "Plan", "Status", "Signed up (JST)", "Language", "Free until (JST)", "Subscription", "Provider", "Renews", "Ends", "Card", "Cancelled at period end", "Codes used", "Events 90d", "Events 30d", "Days active 90d", "First seen (JST)", "Last seen (JST)", "Last location", "Top tickers", "Note"];
    const rows = users.map((u) => { const a = byUser[u.username] || {}; const ent = entitlement(u); const sub = u.subscription || {}; const top = Object.entries(a.tickers || {}).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(", ");
      return [u.username, u.email, u.role || "", u.plan || "", ent.state, jst(u.createdAt), u.locale || "", u.trialEndsAt ? jst(u.trialEndsAt) : "", sub.status || "", sub.provider || "", sub.renewsAt ? jst(Date.parse(sub.renewsAt)) : "", sub.endsAt ? jst(Date.parse(sub.endsAt)) : "", sub.cardBrand ? `${sub.cardBrand} ${sub.cardLastFour || ""}`.trim() : "", sub.status === "cancelled" ? "yes" : "", (u.coupons || []).map((c) => `${c.code} (${c.months}m)`).join(", "), a.n || 0, a.n30 || 0, a.days ? a.days.size : 0, a.first ? jst(a.first) : "", a.last ? jst(a.last) : "", a.loc || "", top, u.note || ""]; });
    const codeRows = codes.map((c) => [c.code, c.months, c.uses, c.maxUses || "", c.expiresAt ? jst(c.expiresAt) : "", c.active ? "yes" : "no", c.note || "", jst(c.createdAt)]);
    const buf = xlsx([{ name: "Users", rows: [header, ...rows] }, { name: "Access codes", rows: [["Code", "Months", "Uses", "Max uses", "Expires (JST)", "Active", "Note", "Created (JST)"], ...codeRows] }]);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(buf, { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="kabukaizu-users-${stamp}.xlsx"`, "cache-control": "no-store" } });
  }

  // Create a complimentary member (family, friends, press): never billed, no trial clock.
  // POST /api/admin/member  body {username, email, password, note?}
  // An email is optional: without one the account gets a local placeholder (no password resets by mail).
  if (action === "member" && req.method === "POST") {
    let body = {}; try { body = await req.json(); } catch {}
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim() || `${username.toLowerCase()}@${cfg.brand().id || "site"}.local`;
    const user = await createUser({ username, email, password: body.password, locale: cfg.defaultLocale() });
    user.plan = "free"; user.note = String(body.note || "").slice(0, 120) || "complimentary";
    await saveUser(user);
    return json({ user: { username: user.username, email: user.email, plan: user.plan, entitlement: entitlement(user) } }, 201);
  }
  // Change (or remove) a member's email: POST /api/admin/member-email body {username, email} (empty email = placeholder).
  if (action === "member-email" && req.method === "POST") {
    let body = {}; try { body = await req.json(); } catch {}
    const user = await findUserByLogin(String(body.username || "").trim());
    if (!user) throw new HttpError(404, "not_found");
    const email = String(body.email || "").trim().toLowerCase() || `${user.username.toLowerCase()}@${cfg.brand().id || "site"}.local`;
    const users = await openStore("users");
    if (email !== user.email) {
      const r = await users.set(`email:${email}`, { id: user.id }, { onlyIfNew: true });
      if (!r.modified) throw new HttpError(409, "email_taken");
      await users.delete(`email:${user.email}`).catch(() => {});
      user.email = email; await saveUser(user);
    }
    return json({ user: { username: user.username, email: user.email } });
  }

  // Access codes (free months, no card): list, create or update, deactivate.
  if (action === "coupons") return json({ coupons: await listAccessCodes() });
  if (action === "coupon" && req.method === "POST") {
    const q = query(req);
    if (q.get("deactivate") === "1") return json({ coupon: await deactivateAccessCode(q.get("code")) });
    const expires = q.get("expires") ? Date.parse(q.get("expires")) : null;
    return json({ coupon: await createAccessCode({ code: q.get("code"), months: q.get("months"), maxUses: q.get("max") || 0, expiresAt: Number.isFinite(expires) ? expires : null, note: q.get("note") || "" }) });
  }

  // Drop one sector's AI report (every language, this period) so the next entitled view regenerates it.
  if (action === "polish" && req.method === "POST") {
    // Rewrites finding shorthand (Q/T/V) and untranslated labels in every stored sector report or deep dive, in the background.
    const kind = String(query(req).get("kind") || "sector"); if (!["sector", "deep"].includes(kind)) throw new HttpError(400, "kind must be sector or deep");
    const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/polish-background`;
    const payload = kind === "deep" ? { kind, all: true } : { kind, id: String(query(req).get("id") || "all"), lang: String(query(req).get("lang") || "all") };
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": cfg.internalSecret() }, body: JSON.stringify(payload) });
    if (!res.ok && res.status !== 202) throw new HttpError(502, `trigger failed: HTTP ${res.status}`);
    return json({ ok: true, started: true });
  }
  if (action === "sector-rebuild" && req.method === "POST") {
    const id = String(query(req).get("id") || "").toLowerCase();
    const lang = String(query(req).get("lang") || ""); // optional: drop only that language's translation
    if (!id) throw new HttpError(400, "id required");
    const summaries = await openStore("summaries");
    const keys = (await summaries.list("sector:")).filter((k) => k.includes(`:${id}:`) && (!lang || k.includes(`:${id}:${lang}:`)));
    for (const k of keys) await summaries.delete(k);
    const jobs = await openStore("jobs");
    const jobKeys = (await jobs.list("job:sector:")).filter((k) => k.includes(`:${id}:`) && (!lang || k.includes(`:${id}:${lang}:`)));
    for (const k of jobKeys) await jobs.delete(k);
    return json({ id, deleted: keys, jobsCleared: jobKeys });
  }

  throw new HttpError(404, "not_found");
});

export const config = { path: "/api/admin/:action" };
